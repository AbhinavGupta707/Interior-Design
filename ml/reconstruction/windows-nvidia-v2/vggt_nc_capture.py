#!/usr/bin/env python3
# mypy: disable-error-code="import-not-found"
"""Offline, proposal-only VGGT and headless VGGT-SLAM research evaluator."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import resource
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

INPUT_SCHEMA = "c14-10-da3-input-v1"
RESULT_SCHEMA = "c14-10-vggt-nc-result-v1"
WEIGHT_BYTES = 5_026_367_224


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def safe_directory(path: Path, label: str) -> Path:
    if not path.is_absolute() or path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError(f"{label} must be an absolute normalized real directory")
    return path


def private_write(path: Path, payload: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def load_input(root: Path, frame_limit: int | None) -> tuple[dict[str, Any], list[Path]]:
    path = root / "da3-input.json"
    manifest = json.loads(path.read_bytes())
    if (
        manifest.get("schemaVersion") != INPUT_SCHEMA
        or manifest.get("authority") != "proposal-only-learned-input-copy"
    ):
        raise ValueError("input authority or schema is invalid")
    frames = manifest.get("frames")
    if not isinstance(frames, list) or len(frames) != 165:
        raise ValueError("this checkpoint requires the retained 165-frame input")
    selected = frames if frame_limit is None else frames[:frame_limit]
    images: list[Path] = []
    for frame in selected:
        name = frame.get("imageName")
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError("image name is not confined")
        image = root / "images" / name
        if image.is_symlink() or not image.is_file() or image.resolve().parent != root / "images":
            raise ValueError("image is not a confined regular file")
        if sha256_file(image) != frame.get("imageSha256"):
            raise ValueError("image hash mismatch")
        images.append(image)
    return manifest, images


def verify_model(root: Path, expected: argparse.Namespace) -> Path:
    weight = root / "model.safetensors"
    readme = root / "README.md"
    config = root / "config.json"
    for path in (weight, readme, config):
        if path.is_symlink() or not path.is_file():
            raise ValueError("model snapshot is incomplete")
    if weight.stat().st_size != WEIGHT_BYTES or sha256_file(weight) != expected.weight_sha256:
        raise ValueError("model weight identity mismatch")
    if (
        sha256_file(readme) != expected.model_readme_sha256
        or sha256_file(config) != expected.model_config_sha256
    ):
        raise ValueError("model metadata identity mismatch")
    if "license: cc-by-nc-4.0" not in readme.read_text(encoding="utf-8").lower():
        raise ValueError("non-commercial model-card marker is absent")
    return weight


def camera_centres(extrinsics: np.ndarray) -> np.ndarray:
    values = np.asarray(extrinsics, dtype=np.float64)
    rotation = values[:, :3, :3]
    translation = values[:, :3, 3]
    return -np.einsum("nij,nj->ni", np.swapaxes(rotation, 1, 2), translation)


def source_centres(frames: list[dict[str, Any]]) -> np.ndarray:
    return camera_centres(np.asarray([item["worldToCamera"] for item in frames]).reshape(-1, 4, 4))


def umeyama(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    source_mean, target_mean = source.mean(0), target.mean(0)
    source_zero, target_zero = source - source_mean, target - target_mean
    variance = float(np.sum(source_zero * source_zero) / len(source))
    left, singular, right_t = np.linalg.svd(target_zero.T @ source_zero / len(source))
    sign = np.ones(3)
    if np.linalg.det(left @ right_t) < 0:
        sign[-1] = -1
    rotation = left @ np.diag(sign) @ right_t
    scale = float(np.sum(singular * sign) / variance)
    translation = target_mean - scale * rotation @ source_mean
    aligned = scale * (source @ rotation.T) + translation
    residual = float(np.sqrt(np.mean(np.sum((aligned - target) ** 2, axis=1))))
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("camera alignment is degenerate")
    return rotation, translation, scale, residual


def camera_diagnostics(
    extrinsics: np.ndarray, frames: list[dict[str, Any]]
) -> dict[str, float | str]:
    proposal_centres = camera_centres(extrinsics)
    reference_extrinsics = np.asarray([item["worldToCamera"] for item in frames]).reshape(-1, 4, 4)
    reference_centres = camera_centres(reference_extrinsics)
    rotation, translation, scale, residual = umeyama(proposal_centres, reference_centres)
    aligned_centres = scale * (proposal_centres @ rotation.T) + translation
    point_errors = np.linalg.norm(aligned_centres - reference_centres, axis=1)
    proposal_steps = np.diff(aligned_centres, axis=0)
    reference_steps = np.diff(reference_centres, axis=0)
    valid = (np.linalg.norm(proposal_steps, axis=1) > 1e-9) & (
        np.linalg.norm(reference_steps, axis=1) > 1e-9
    )
    cosines = np.sum(proposal_steps[valid] * reference_steps[valid], axis=1) / (
        np.linalg.norm(proposal_steps[valid], axis=1)
        * np.linalg.norm(reference_steps[valid], axis=1)
    )
    direction_angles = np.degrees(np.arccos(np.clip(cosines, -1.0, 1.0)))
    proposal_rotations = np.asarray(extrinsics)[:, :3, :3].transpose(0, 2, 1)
    reference_rotations = reference_extrinsics[:, :3, :3].transpose(0, 2, 1)
    aligned_rotations = np.einsum("ij,njk->nik", rotation, proposal_rotations)
    relative = np.einsum("nij,nkj->nik", aligned_rotations, reference_rotations)
    orientation_angles = np.degrees(
        np.arccos(np.clip((np.trace(relative, axis1=1, axis2=2) - 1.0) / 2.0, -1.0, 1.0))
    )
    return {
        "authority": "agreement-to-retained-arkit-prior-not-independent-accuracy",
        "similarityScale": scale,
        "positionRmseMetresNotIndependentlyValidated": residual,
        "positionMedianMetresNotIndependentlyValidated": float(np.median(point_errors)),
        "positionP95MetresNotIndependentlyValidated": float(np.quantile(point_errors, 0.95)),
        "stepDirectionMedianDegrees": float(np.median(direction_angles)),
        "orientationMedianDegrees": float(np.median(orientation_angles)),
        "alignedPathLengthRatio": float(
            np.sum(np.linalg.norm(proposal_steps, axis=1))
            / np.sum(np.linalg.norm(reference_steps, axis=1))
        ),
    }


def occupied_voxel_fraction(points: np.ndarray, resolution: int = 32) -> float:
    low = np.quantile(points, 0.01, axis=0)
    high = np.quantile(points, 0.99, axis=0)
    span = np.maximum(high - low, 1e-9)
    cells = np.floor((points - low) / span * resolution).astype(np.int64)
    cells = np.clip(cells, 0, resolution - 1)
    occupied = len(np.unique(cells, axis=0))
    return float(occupied / resolution**3)


def cap_cloud(
    parts: list[tuple[np.ndarray, np.ndarray]], max_points: int
) -> tuple[np.ndarray, np.ndarray]:
    points = np.concatenate([item[0].reshape(-1, 3) for item in parts])
    colours = np.concatenate([item[1].reshape(-1, 3) for item in parts])
    finite = np.all(np.isfinite(points), axis=1)
    points, colours = points[finite], colours[finite]
    if len(points) > max_points:
        stride = math.ceil(len(points) / max_points)
        points, colours = points[::stride][:max_points], colours[::stride][:max_points]
    if not len(points):
        raise ValueError("candidate produced no finite points")
    return points.astype(np.float32), colours.astype(np.uint8)


def write_ply(path: Path, points: np.ndarray, colours: np.ndarray) -> None:
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(points)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    ).encode()
    records = np.empty(
        len(points),
        dtype=[
            ("x", "<f4"),
            ("y", "<f4"),
            ("z", "<f4"),
            ("red", "u1"),
            ("green", "u1"),
            ("blue", "u1"),
        ],
    )
    records["x"], records["y"], records["z"] = points.T
    records["red"], records["green"], records["blue"] = colours.T
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(header)
        records.tofile(handle)


def render(
    points: np.ndarray, colours: np.ndarray, frame: dict[str, Any], target: Path, output: Path
) -> dict[str, Any]:
    width, height = int(frame["widthPixels"]), int(frame["heightPixels"])
    w2c = np.asarray(frame["worldToCamera"]).reshape(4, 4)
    camera = points @ w2c[:3, :3].T + w2c[:3, 3]
    valid = np.all(np.isfinite(camera), axis=1) & (camera[:, 2] > 1e-6)
    camera, visible = camera[valid], colours[valid]
    fx, fy, cx, cy = frame["cameraIntrinsics"]
    columns = np.rint(fx * camera[:, 0] / camera[:, 2] + cx).astype(int)
    rows = np.rint(fy * camera[:, 1] / camera[:, 2] + cy).astype(int)
    inside = (columns >= 0) & (columns < width) & (rows >= 0) & (rows < height)
    columns, rows, depths, visible = (
        columns[inside],
        rows[inside],
        camera[inside, 2],
        visible[inside],
    )
    pixels = rows * width + columns
    order = np.argsort(depths, kind="stable")
    _, first = np.unique(pixels[order], return_index=True)
    chosen = order[first]
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[rows[chosen], columns[chosen]] = visible[chosen]
    Image.fromarray(image).save(output, format="PNG", optimize=False)
    os.chmod(output, 0o600)
    with Image.open(target) as handle:
        truth = np.asarray(handle.convert("RGB"), dtype=np.float64)
    mse = float(np.mean(((image.astype(np.float64) - truth) / 255.0) ** 2))
    return {
        "coverageFraction": float(len(first) / (width * height)),
        "coveredPixelCount": int(len(first)),
        "fullFrameMse": mse,
        "fullFramePsnrDb": float(-10 * math.log10(mse)) if mse else float("inf"),
        "renderSha256": sha256_file(output),
    }


def load_model(weight: Path) -> Any:
    import torch
    from safetensors.torch import load_file
    from vggt.models.vggt import VGGT

    model = VGGT()
    model.load_state_dict(load_file(str(weight), device="cpu"), strict=True)
    model.point_head = None
    model.track_head = None
    return model.eval().to(torch.bfloat16).to("cuda:0")


def enforce_vram_ceiling(limit_bytes: int) -> None:
    import torch

    peak = int(torch.cuda.max_memory_allocated(0))
    if peak > limit_bytes:
        raise RuntimeError(f"task VRAM ceiling exceeded: {peak} > {limit_bytes}")


def direct(
    model: Any, paths: list[Path], max_points: int, task_vram_limit_bytes: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    import torch
    from vggt.utils.geometry import unproject_depth_map_to_point_map
    from vggt.utils.load_fn import load_and_preprocess_images
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri

    images = load_and_preprocess_images([str(path) for path in paths]).to("cuda:0")
    # VGGT owns its mixed-precision boundary internally. An additional outer autocast changes
    # CameraHead LayerNorm inputs to BF16 while its normalization path remains Float.
    with torch.no_grad():
        prediction = model(images)
    enforce_vram_ceiling(task_vram_limit_bytes)
    extrinsic, intrinsic = pose_encoding_to_extri_intri(prediction["pose_enc"], images.shape[-2:])
    depth = prediction["depth"].squeeze(0)
    confidence = prediction["depth_conf"].squeeze(0)
    # The upstream geometry helper is NumPy-only. VGGT returns BF16 depth on CUDA, which NumPy
    # cannot represent; make the evaluator boundary explicit without changing model inference.
    depth_numpy = depth.float().cpu().numpy()
    extrinsic_numpy = extrinsic.squeeze(0).float().cpu().numpy()
    intrinsic_numpy = intrinsic.squeeze(0).float().cpu().numpy()
    points = unproject_depth_map_to_point_map(depth_numpy, extrinsic_numpy, intrinsic_numpy)
    colours = (images.permute(0, 2, 3, 1).float().cpu().numpy() * 255).astype(np.uint8)
    threshold = torch.quantile(confidence.float(), 0.25)
    mask = (confidence >= threshold).cpu().numpy()
    cloud, rgb = cap_cloud([(points[mask], colours[mask])], max_points)
    return cloud, rgb, extrinsic_numpy


def hybrid(
    model: Any,
    paths: list[Path],
    max_points: int,
    submap_size: int,
    task_vram_limit_bytes: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    from vggt_slam.solver import Solver

    solver = Solver(init_conf_threshold=25.0)
    start = 0
    while start < len(paths):
        end = min(len(paths), start + submap_size)
        chunk_start = max(0, start - 1) if start else 0
        names = [str(path) for path in paths[chunk_start:end]]
        prediction = solver.run_predictions(names, model, 0, None, None)
        enforce_vram_ceiling(task_vram_limit_bytes)
        solver.add_points(prediction)
        solver.graph.optimize()
        start = end
    parts: list[tuple[np.ndarray, np.ndarray]] = []
    cameras: list[np.ndarray] = []
    for submap_index, submap in enumerate(solver.map.ordered_submaps_by_key()):
        parts.append((submap.get_points_in_world_frame(solver.graph), submap.get_points_colors()))
        poses = submap.get_all_poses_world(solver.graph)
        cameras.extend(poses[1:] if submap_index else poses)
    cloud, rgb = cap_cloud(parts, max_points)
    camera_to_world = np.asarray(cameras)
    world_to_camera = np.linalg.inv(camera_to_world)
    return cloud, rgb, world_to_camera


def execute(args: argparse.Namespace) -> None:
    import torch

    started = time.monotonic()
    input_root = safe_directory(Path(args.input), "input")
    model_root = safe_directory(Path(args.model), "model")
    output = safe_directory(Path(args.output), "output")
    if any(output.iterdir()):
        raise ValueError("output directory must be empty")
    manifest, paths = load_input(input_root, args.frame_limit)
    weight = verify_model(model_root, args)
    if not torch.cuda.is_available() or torch.cuda.get_device_capability(0) != (12, 0):
        raise RuntimeError("frozen execution requires RTX 5080 compute capability 12.0")
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.cuda.reset_peak_memory_stats(0)
    model = load_model(weight)
    enforce_vram_ceiling(args.task_vram_limit_bytes)
    if args.candidate_id == "vggt-1b-nc-direct":
        points, colours, extrinsics = direct(
            model, paths, args.max_points, args.task_vram_limit_bytes
        )
    else:
        points, colours, extrinsics = hybrid(
            model,
            paths,
            args.max_points,
            args.submap_size,
            args.task_vram_limit_bytes,
        )
    centres = camera_centres(extrinsics)
    if len(centres) != len(paths) or not np.all(np.isfinite(centres)):
        raise ValueError("candidate did not produce one finite camera per input frame")
    cloud_path = output / "proposal-points.ply"
    write_ply(cloud_path, points, colours)
    cameras_path = output / "proposal-cameras.json"
    private_write(
        cameras_path,
        canonical_bytes({"cameraCentres": centres.tolist(), "worldToCamera": extrinsics.tolist()})
        + b"\n",
    )
    held_out: dict[str, Any] | str = "NOT RUN"
    if args.held_out and len(paths) == 165:
        training_paths = paths[:-1]
        if args.candidate_id == "vggt-1b-nc-direct":
            train_points, train_colours, train_extrinsics = direct(
                model,
                training_paths,
                args.max_points,
                args.task_vram_limit_bytes,
            )
        else:
            train_points, train_colours, train_extrinsics = hybrid(
                model,
                training_paths,
                args.max_points,
                args.submap_size,
                args.task_vram_limit_bytes,
            )
        predicted = camera_centres(train_extrinsics)
        rotation, translation, scale, residual = umeyama(
            predicted, source_centres(manifest["frames"][:-1])
        )
        aligned = scale * (train_points.astype(np.float64) @ rotation.T) + translation
        held_out = render(
            aligned.astype(np.float32),
            train_colours,
            manifest["frames"][-1],
            paths[-1],
            output / "held-out-render.png",
        )
        held_out.update(
            {
                "alignmentRole": "proposal-to-arkit-similarity-not-accuracy",
                "cameraAlignmentResidualMetresNotIndependentlyValidated": residual,
                "trainingFrameCount": 164,
            }
        )
    torch.cuda.synchronize(0)
    bounds = {
        "min": points.min(0).astype(float).tolist(),
        "max": points.max(0).astype(float).tolist(),
    }
    artifacts = {path.name: sha256_file(path) for path in output.iterdir()}
    result = {
        "schemaVersion": RESULT_SCHEMA,
        "candidateId": args.candidate_id,
        "authority": "strictly-private-non-commercial-research-proposal-only",
        "commercialUse": "PROHIBITED_REEVALUATION_REQUIRED",
        "sourceCommit": args.source_commit,
        "slamSourceCommit": args.slam_source_commit,
        "modelRevision": args.model_revision,
        "weightSha256": args.weight_sha256,
        "inputManifestSha256": sha256_file(input_root / "da3-input.json"),
        "selectionSha256": manifest["selectionSha256"],
        "segmentId": manifest["segmentId"],
        "sourceViewCount": len(paths),
        "registeredViewCount": len(centres),
        "finitePointCount": len(points),
        "proposalBounds": bounds,
        "cameraConsistency": camera_diagnostics(extrinsics, manifest["frames"][: len(paths)]),
        "selfNormalisedOccupiedVoxelFraction32NotAccuracy": occupied_voxel_fraction(points),
        "heldOutAppearance": held_out,
        "dimensionalAccuracy": "NOT RUN",
        "representativeAccuracy": "NOT RUN",
        "productionAuthority": "none",
        "runIndex": args.run_index,
        "seed": args.seed,
        "submapSize": args.submap_size,
        "peakTaskVramBytes": int(torch.cuda.max_memory_allocated(0)),
        "peakHostMaxRssBytes": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024),
        "wallSeconds": time.monotonic() - started,
        "artifacts": artifacts,
    }
    result_path = output / "candidate-result.json"
    private_write(result_path, canonical_bytes(result) + b"\n")
    print(
        json.dumps(
            {"candidateId": args.candidate_id, "resultSha256": sha256_file(result_path)},
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument(
        "--candidate-id", choices=("vggt-1b-nc-direct", "vggt-slam-2-nc-no-loop"), required=True
    )
    value.add_argument("--input", required=True)
    value.add_argument("--model", required=True)
    value.add_argument("--output", required=True)
    value.add_argument("--source-commit", required=True)
    value.add_argument("--slam-source-commit", required=True)
    value.add_argument("--model-revision", required=True)
    value.add_argument("--weight-sha256", required=True)
    value.add_argument("--model-readme-sha256", required=True)
    value.add_argument("--model-config-sha256", required=True)
    value.add_argument("--run-index", type=int, choices=(1, 2), required=True)
    value.add_argument("--frame-limit", type=int, choices=(4, 16, 48, 165))
    value.add_argument("--submap-size", type=int, default=16, choices=(8, 16))
    value.add_argument("--max-points", type=int, default=500_000)
    value.add_argument("--task-vram-limit-bytes", type=int, required=True)
    value.add_argument("--seed", type=int, default=0)
    value.add_argument("--held-out", action="store_true")
    value.set_defaults(function=execute)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
