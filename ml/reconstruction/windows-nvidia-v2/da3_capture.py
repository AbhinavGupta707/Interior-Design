#!/usr/bin/env python3
"""Run one offline, proposal-only DA3 evaluation scope on an independent segment."""

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

SCHEMA_INPUT = "c14-10-da3-input-v1"
SCHEMA_RESULT = "c14-10-da3-result-v1"
CANDIDATES = {
    "da3-large-1.1": "da3-large",
    "da3-small": "da3-small",
}


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def safe_existing_directory(path: Path, label: str) -> Path:
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise ValueError(f"{label} must be an absolute real directory")
    resolved = path.resolve()
    if resolved != path:
        raise ValueError(f"{label} must be normalized")
    return path


def empty_output(path: Path) -> Path:
    path = safe_existing_directory(path, "output")
    if any(path.iterdir()):
        raise ValueError("output directory must be empty")
    return path


def private_write(path: Path, payload: bytes) -> None:
    if path.exists() or path.is_symlink():
        raise ValueError(f"refusing to replace output: {path.name}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def load_input(root: Path) -> tuple[dict[str, Any], list[Path]]:
    manifest_path = root / "da3-input.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("DA3 input manifest must be a regular file")
    payload = manifest_path.read_bytes()
    manifest = json.loads(payload)
    if not isinstance(manifest, dict) or payload != canonical_bytes(manifest) + b"\n":
        raise ValueError("DA3 input manifest must be exact canonical JSON")
    expected_keys = {
        "authority",
        "cohort",
        "frames",
        "heldOutPolicy",
        "schemaVersion",
        "segmentId",
        "selectionSha256",
        "sourceCoordinateSystem",
        "sourceUnit",
    }
    if set(manifest) != expected_keys or manifest.get("schemaVersion") != SCHEMA_INPUT:
        raise ValueError("DA3 input manifest schema is invalid")
    if manifest.get("authority") != "proposal-only-learned-input-copy":
        raise ValueError("DA3 input authority is invalid")
    frames = manifest.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("DA3 input requires at least one frame")
    image_paths: list[Path] = []
    seen: set[str] = set()
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("DA3 frame must be an object")
        expected_frame_keys = {
            "cameraIntrinsics",
            "heightPixels",
            "imageName",
            "imageSha256",
            "sampleId",
            "widthPixels",
            "worldToCamera",
        }
        if set(frame) != expected_frame_keys:
            raise ValueError("DA3 frame schema is invalid")
        name = frame.get("imageName")
        if not isinstance(name, str) or Path(name).name != name or name in seen:
            raise ValueError("DA3 image name is invalid or duplicated")
        seen.add(name)
        image = root / "images" / name
        if image.is_symlink() or not image.is_file() or image.resolve().parent != (root / "images"):
            raise ValueError("DA3 image must be a confined regular file")
        expected_hash = frame.get("imageSha256")
        if not isinstance(expected_hash, str) or sha256_file(image) != expected_hash:
            raise ValueError("DA3 image hash mismatch")
        with Image.open(image) as decoded:
            if decoded.size != (frame["widthPixels"], frame["heightPixels"]):
                raise ValueError("DA3 image dimensions do not match immutable intrinsics")
        intrinsics = frame.get("cameraIntrinsics")
        matrix = frame.get("worldToCamera")
        if (
            not isinstance(intrinsics, list)
            or len(intrinsics) != 4
            or not all(
                isinstance(value, (int, float)) and math.isfinite(value) for value in intrinsics
            )
            or not isinstance(matrix, list)
            or len(matrix) != 16
            or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in matrix)
        ):
            raise ValueError("DA3 camera evidence is invalid")
        image_paths.append(image)
    return manifest, image_paths


def camera_centres(extrinsics: np.ndarray) -> np.ndarray:
    values = np.asarray(extrinsics, dtype=np.float64)
    if values.ndim != 3 or values.shape[1:] not in {(3, 4), (4, 4)}:
        raise ValueError("predicted extrinsics have an invalid shape")
    rotation = values[:, :3, :3]
    translation = values[:, :3, 3]
    return -np.einsum("nij,nj->ni", np.swapaxes(rotation, 1, 2), translation)


def source_extrinsics(frames: list[dict[str, Any]]) -> np.ndarray:
    return np.asarray([frame["worldToCamera"] for frame in frames], dtype=np.float64).reshape(
        -1, 4, 4
    )


def umeyama(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    if source.shape != target.shape or source.ndim != 2 or source.shape[0] < 3:
        raise ValueError(
            "similarity alignment requires at least three corresponding camera centres"
        )
    source_mean = source.mean(axis=0)
    target_mean = target.mean(axis=0)
    source_zero = source - source_mean
    target_zero = target - target_mean
    variance = float(np.sum(source_zero * source_zero) / len(source))
    if variance <= 1e-12:
        raise ValueError("predicted camera centres are degenerate")
    covariance = target_zero.T @ source_zero / len(source)
    left, singular, right_t = np.linalg.svd(covariance)
    sign = np.ones(3)
    if np.linalg.det(left @ right_t) < 0:
        sign[-1] = -1
    rotation = left @ np.diag(sign) @ right_t
    scale = float(np.sum(singular * sign) / variance)
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("camera similarity scale is invalid")
    translation = target_mean - scale * (rotation @ source_mean)
    aligned = scale * (source @ rotation.T) + translation
    residual = float(np.sqrt(np.mean(np.sum((aligned - target) ** 2, axis=1))))
    return rotation, translation, scale, residual


def unproject(
    prediction: Any,
    *,
    max_points: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    depth = np.asarray(prediction.depth, dtype=np.float64)
    confidence = np.asarray(prediction.conf, dtype=np.float64)
    intrinsics = np.asarray(prediction.intrinsics, dtype=np.float64)
    extrinsics = np.asarray(prediction.extrinsics, dtype=np.float64)
    images = np.asarray(prediction.processed_images, dtype=np.uint8)
    if (
        depth.ndim != 3
        or confidence.shape != depth.shape
        or images.shape[:3] != depth.shape
        or intrinsics.shape != (len(depth), 3, 3)
        or extrinsics.shape not in {(len(depth), 3, 4), (len(depth), 4, 4)}
    ):
        raise ValueError("DA3 prediction arrays are inconsistent")
    finite_depth = np.isfinite(depth) & (depth > 0)
    finite_confidence = np.isfinite(confidence)
    valid = finite_depth & finite_confidence
    if not np.any(valid):
        raise ValueError("DA3 prediction contains no valid depth")
    threshold = float(np.percentile(confidence[valid], 40.0))
    retained = valid & (confidence >= threshold)
    per_view_cap = max(1, max_points // len(depth))
    point_parts: list[np.ndarray] = []
    colour_parts: list[np.ndarray] = []
    retained_by_view: list[int] = []
    for index in range(len(depth)):
        flat = np.flatnonzero(retained[index])
        retained_by_view.append(int(len(flat)))
        if len(flat) > per_view_cap:
            stride = math.ceil(len(flat) / per_view_cap)
            flat = flat[::stride][:per_view_cap]
        rows, columns = np.unravel_index(flat, depth[index].shape)
        z = depth[index, rows, columns]
        intrinsic = intrinsics[index]
        camera = np.column_stack(
            (
                (columns - intrinsic[0, 2]) * z / intrinsic[0, 0],
                (rows - intrinsic[1, 2]) * z / intrinsic[1, 1],
                z,
            )
        )
        world_to_camera = extrinsics[index]
        rotation = world_to_camera[:3, :3]
        translation = world_to_camera[:3, 3]
        world = (camera - translation) @ rotation
        finite = np.all(np.isfinite(world), axis=1)
        point_parts.append(world[finite])
        colour_parts.append(images[index, rows[finite], columns[finite]])
    points = np.concatenate(point_parts, axis=0).astype(np.float32)
    colours = np.concatenate(colour_parts, axis=0).astype(np.uint8)
    if not len(points):
        raise ValueError("DA3 unprojection contains no finite points")
    bounds_min = points.min(axis=0).astype(float).tolist()
    bounds_max = points.max(axis=0).astype(float).tolist()
    diagonal = float(np.linalg.norm(points.max(axis=0) - points.min(axis=0)))
    return (
        points,
        colours,
        {
            "confidenceThreshold40thPercentile": threshold,
            "finiteDepthSampleCount": int(np.count_nonzero(finite_depth)),
            "retainedByView": retained_by_view,
            "retainedPointCount": int(len(points)),
            "proposalBoundsMax": bounds_max,
            "proposalBoundsMin": bounds_min,
            "proposalBoundsDiagonal": diagonal,
        },
    )


def write_binary_ply(path: Path, points: np.ndarray, colours: np.ndarray) -> None:
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {len(points)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        "end_header\n"
    ).encode("ascii")
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
    if path.exists():
        raise ValueError("refusing to replace point cloud")
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(header)
        records.tofile(handle)
        handle.flush()
        os.fsync(handle.fileno())


def render_held_out(
    points: np.ndarray,
    colours: np.ndarray,
    frame: dict[str, Any],
    target_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    width, height = int(frame["widthPixels"]), int(frame["heightPixels"])
    world_to_camera = np.asarray(frame["worldToCamera"], dtype=np.float64).reshape(4, 4)
    camera = points.astype(np.float64) @ world_to_camera[:3, :3].T + world_to_camera[:3, 3]
    positive = np.isfinite(camera).all(axis=1) & (camera[:, 2] > 1e-6)
    camera = camera[positive]
    visible_colours = colours[positive]
    fx, fy, cx, cy = (float(value) for value in frame["cameraIntrinsics"])
    columns = np.rint(fx * camera[:, 0] / camera[:, 2] + cx).astype(np.int64)
    rows = np.rint(fy * camera[:, 1] / camera[:, 2] + cy).astype(np.int64)
    inside = (columns >= 0) & (columns < width) & (rows >= 0) & (rows < height)
    columns, rows = columns[inside], rows[inside]
    depths, visible_colours = camera[inside, 2], visible_colours[inside]
    pixels = rows * width + columns
    order = np.argsort(depths, kind="stable")
    sorted_pixels = pixels[order]
    _, first = np.unique(sorted_pixels, return_index=True)
    selected = order[first]
    render = np.zeros((height, width, 3), dtype=np.uint8)
    render[rows[selected], columns[selected]] = visible_colours[selected]
    Image.fromarray(render, mode="RGB").save(output_path, format="PNG", optimize=False)
    os.chmod(output_path, 0o600)
    with Image.open(target_path) as target_image:
        target = np.asarray(target_image.convert("RGB"), dtype=np.float64)
    difference = (render.astype(np.float64) - target) / 255.0
    mse = float(np.mean(difference * difference))
    psnr = float("inf") if mse == 0 else float(-10.0 * math.log10(mse))
    return {
        "coveredPixelCount": int(len(first)),
        "coverageFraction": float(len(first) / (width * height)),
        "fullFrameMse": mse,
        "fullFramePsnrDb": psnr,
        "heldOutImageSha256": frame["imageSha256"],
        "renderSha256": sha256_file(output_path),
    }


def run(args: argparse.Namespace) -> None:
    import torch

    started = time.monotonic()
    candidate_model_name = CANDIDATES.get(args.candidate_id)
    if candidate_model_name is None:
        raise ValueError("candidate ID is not frozen")
    input_root = safe_existing_directory(Path(args.input), "input")
    model_root = safe_existing_directory(Path(args.model), "model")
    output_root = empty_output(Path(args.output))
    manifest, image_paths = load_input(input_root)
    frames = manifest["frames"]
    model_file = model_root / "model.safetensors"
    config_file = model_root / "config.json"
    for required in (model_file, config_file):
        if required.is_symlink() or not required.is_file():
            raise ValueError("model directory is incomplete")
    if sha256_file(model_file) != args.weight_sha256:
        raise ValueError("model weight hash does not match the frozen candidate")
    config = json.loads(config_file.read_bytes())
    if config.get("model_name") != candidate_model_name:
        raise ValueError("model config does not match candidate ID")
    if not torch.cuda.is_available() or torch.cuda.get_device_capability(0) != (12, 0):
        raise RuntimeError("DA3 counted execution requires the frozen RTX 5080 compute-12.0 path")
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.use_deterministic_algorithms(True)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats(0)

    from depth_anything_3.api import DepthAnything3

    model = DepthAnything3.from_pretrained(str(model_root))
    model = model.to(device=torch.device("cuda:0")).eval()
    full_prediction = model.inference(
        [str(path) for path in image_paths],
        process_res=args.process_res,
        process_res_method="upper_bound_resize",
        use_ray_pose=False,
    )
    points, colours, geometry = unproject(full_prediction, max_points=args.max_points)
    centres = camera_centres(np.asarray(full_prediction.extrinsics))
    registered = int(np.count_nonzero(np.all(np.isfinite(centres), axis=1)))
    if registered != len(image_paths):
        raise ValueError("DA3 did not emit a finite camera for every selected image")
    cloud_path = output_root / "proposal-points.ply"
    write_binary_ply(cloud_path, points, colours)
    camera_record = {
        "cameraCentres": centres.astype(float).tolist(),
        "extrinsics": np.asarray(full_prediction.extrinsics, dtype=float).tolist(),
        "intrinsics": np.asarray(full_prediction.intrinsics, dtype=float).tolist(),
    }
    camera_path = output_root / "proposal-cameras.json"
    private_write(camera_path, canonical_bytes(camera_record) + b"\n")

    held_out: dict[str, Any] | None = None
    if len(image_paths) >= 4:
        training_prediction = model.inference(
            [str(path) for path in image_paths[:-1]],
            process_res=args.process_res,
            process_res_method="upper_bound_resize",
            use_ray_pose=False,
        )
        training_points, training_colours, _ = unproject(
            training_prediction,
            max_points=args.max_points,
        )
        predicted_centres = camera_centres(np.asarray(training_prediction.extrinsics))
        reference_centres = camera_centres(source_extrinsics(frames[:-1]))
        rotation, translation, scale, residual = umeyama(predicted_centres, reference_centres)
        aligned_points = scale * (training_points.astype(np.float64) @ rotation.T) + translation
        render_path = output_root / "held-out-render.png"
        held_out = render_held_out(
            aligned_points.astype(np.float32),
            training_colours,
            frames[-1],
            image_paths[-1],
            render_path,
        )
        held_out.update(
            {
                "alignmentRole": "proposal-to-arkit-similarity-not-accuracy",
                "cameraAlignmentResidualMetresNotIndependentlyValidated": residual,
                "cameraAlignmentScaleNotIndependentlyValidated": scale,
                "trainingFrameCount": len(image_paths) - 1,
            }
        )
    del model
    torch.cuda.synchronize(0)
    peak_vram = int(torch.cuda.max_memory_allocated(0))
    wall_seconds = time.monotonic() - started
    artifacts = {
        "proposal-cameras.json": sha256_file(camera_path),
        "proposal-points.ply": sha256_file(cloud_path),
    }
    render_path = output_root / "held-out-render.png"
    if render_path.exists():
        artifacts[render_path.name] = sha256_file(render_path)
    config_hash = hashlib.sha256(
        canonical_bytes(
            {
                "candidateId": args.candidate_id,
                "maxPoints": args.max_points,
                "processRes": args.process_res,
                "seed": args.seed,
                "sourceCommit": args.source_commit,
                "weightSha256": args.weight_sha256,
            }
        )
    ).hexdigest()
    result = {
        "artifacts": artifacts,
        "candidateId": args.candidate_id,
        "cohort": manifest["cohort"],
        "configSha256": config_hash,
        "deterministicControls": {
            "cublasWorkspaceConfig": ":4096:8",
            "cudnnBenchmark": False,
            "deterministicAlgorithms": True,
            "seed": args.seed,
            "tf32": False,
        },
        "dimensionalAccuracy": "NOT RUN",
        "geometry": geometry,
        "heldOutAppearance": held_out,
        "inputManifestSha256": sha256_file(input_root / "da3-input.json"),
        "modelConfigSha256": sha256_file(config_file),
        "peakHostMaxRssBytes": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024),
        "peakTaskVramBytes": peak_vram,
        "productionAuthority": "none-proposal-only",
        "registeredViewCount": registered,
        "representativeAccuracy": "NOT RUN",
        "runIndex": args.run_index,
        "schemaVersion": SCHEMA_RESULT,
        "segmentId": manifest["segmentId"],
        "selectionSha256": manifest["selectionSha256"],
        "sourceCommit": args.source_commit,
        "sourceViewCount": len(image_paths),
        "weightSha256": args.weight_sha256,
        "wallSeconds": wall_seconds,
    }
    result_path = output_root / "candidate-result.json"
    private_write(result_path, canonical_bytes(result) + b"\n")
    print(
        json.dumps(
            {
                "candidateId": args.candidate_id,
                "resultSha256": sha256_file(result_path),
                "runIndex": args.run_index,
                "segmentId": manifest["segmentId"],
            },
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--candidate-id", choices=tuple(CANDIDATES), required=True)
    value.add_argument("--input", required=True)
    value.add_argument("--model", required=True)
    value.add_argument("--output", required=True)
    value.add_argument("--run-index", type=int, choices=(1, 2), required=True)
    value.add_argument("--source-commit", required=True)
    value.add_argument("--weight-sha256", required=True)
    value.add_argument("--process-res", type=int, default=504, choices=(336, 392, 448, 504))
    value.add_argument("--max-points", type=int, default=500_000)
    value.add_argument("--seed", type=int, default=0)
    value.set_defaults(function=run)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
