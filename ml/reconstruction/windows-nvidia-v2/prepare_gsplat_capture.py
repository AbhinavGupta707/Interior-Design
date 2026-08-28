#!/usr/bin/env python3
"""Derive bounded gsplat input from one verified selection and one COLMAP model."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, cast

from capture_benchmark import (
    as_object,
    canonical_bytes,
    colmap_image_name,
    load_selection,
    private_write,
    sha256_file,
)
from PIL import Image  # type: ignore[import-not-found]


def regular_model_file(root: Path, name: str) -> Path:
    path = root / name
    if root.is_symlink() or not root.is_dir() or path.is_symlink() or not path.is_file():
        raise ValueError("COLMAP text model must be a real directory of regular files")
    if path.resolve().parent != root.resolve():
        raise ValueError("COLMAP model file escapes its root")
    return path


def finite_float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("COLMAP model contains a non-finite number")
    return result


def quaternion_matrix(values: list[float], translation: list[float]) -> list[float]:
    w, x, y, z = values
    length = math.sqrt(w * w + x * x + y * y + z * z)
    if not 0.99 <= length <= 1.01:
        raise ValueError("COLMAP camera quaternion is not normalized")
    w, x, y, z = w / length, x / length, y / length, z / length
    return [
        1 - 2 * (y * y + z * z),
        2 * (x * y - z * w),
        2 * (x * z + y * w),
        translation[0],
        2 * (x * y + z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z - x * w),
        translation[1],
        2 * (x * z - y * w),
        2 * (y * z + x * w),
        1 - 2 * (x * x + y * y),
        translation[2],
        0.0,
        0.0,
        0.0,
        1.0,
    ]


def parse_cameras(path: Path) -> dict[int, tuple[int, int, list[float]]]:
    cameras: dict[int, tuple[int, int, list[float]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) != 8 or fields[1] != "PINHOLE":
            raise ValueError("gsplat requires an exact PINHOLE COLMAP text model")
        camera_id = int(fields[0])
        width, height = int(fields[2]), int(fields[3])
        parameters = [finite_float(value) for value in fields[4:]]
        if (
            camera_id <= 0
            or camera_id in cameras
            or not 1 <= width <= 100_000
            or not 1 <= height <= 100_000
            or parameters[0] <= 0
            or parameters[1] <= 0
        ):
            raise ValueError("COLMAP camera declaration is invalid")
        cameras[camera_id] = (width, height, parameters)
    if not cameras:
        raise ValueError("COLMAP model has no cameras")
    return cameras


def parse_images(path: Path, expected_names: set[str]) -> dict[str, tuple[int, list[float]]]:
    images: dict[str, tuple[int, list[float]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) < 10 or fields[9] not in expected_names:
            continue
        name = fields[9]
        if name in images:
            raise ValueError("COLMAP model repeats a selected image")
        quaternion = [finite_float(value) for value in fields[1:5]]
        translation = [finite_float(value) for value in fields[5:8]]
        images[name] = (int(fields[8]), quaternion_matrix(quaternion, translation))
    if set(images) != expected_names:
        raise ValueError("COLMAP model images do not exactly match the immutable selection")
    return images


def parse_points(path: Path) -> list[dict[str, object]]:
    gaussians: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) < 8:
            raise ValueError("COLMAP points3D record is malformed")
        xyz = [finite_float(value) for value in fields[1:4]]
        rgb_values = [int(value) for value in fields[4:7]]
        if any(value < 0 or value > 255 for value in rgb_values):
            raise ValueError("COLMAP point colour is invalid")
        gaussians.append(
            {
                "opacity": 0.5,
                "rgb": [value / 255 for value in rgb_values],
                "scale": 0.02,
                "xyz": xyz,
            }
        )
        if len(gaussians) == 100_000:
            break
    if len(gaussians) < 3:
        raise ValueError("COLMAP sparse proposal has too few initial points")
    return gaussians


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-root", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    parser.add_argument("--segment-id", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--steps", type=int, default=100)
    args = parser.parse_args()
    export_root = Path(args.export_root)
    export_manifest, _, selection = load_selection(
        export_root,
        Path(args.selection),
        physical_root_alias="export",
    )
    output = Path(args.output)
    if output.is_symlink() or not output.is_dir() or any(output.iterdir()):
        raise ValueError("output must be a new empty mounted directory")
    images_root = output / "images"
    images_root.mkdir(mode=0o700)
    cohort = as_object(as_object(selection["cohorts"], "cohorts")[args.cohort], "cohort")
    segment = next(
        as_object(raw, "segment")
        for raw in cast("list[object]", cohort["segments"])
        if as_object(raw, "segment")["segmentId"] == args.segment_id
    )
    source_frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
    if len(source_frames) < 3:
        raise ValueError("gsplat requires at least three calibrated selected views")
    model_root = Path(args.model)
    camera_path = regular_model_file(model_root, "cameras.txt")
    model_image_path = regular_model_file(model_root, "images.txt")
    points_path = regular_model_file(model_root, "points3D.txt")
    cameras = parse_cameras(camera_path)
    names_by_sample = {
        cast("str", frame["sampleId"]): colmap_image_name(frame) for frame in source_frames
    }
    model_images = parse_images(model_image_path, set(names_by_sample.values()))
    gaussians = parse_points(points_path)
    frames: list[dict[str, object]] = []
    target_size: tuple[int, int] | None = None
    for frame in source_frames:
        source_path = export_root.joinpath(*Path(cast("str", frame["imagePath"])).parts)
        with Image.open(source_path) as source:
            source.load()
            image = source.convert("RGB")
        maximum = 2048
        scale = min(1.0, maximum / image.width, maximum / image.height)
        width, height = max(32, round(image.width * scale)), max(32, round(image.height * scale))
        if target_size is None:
            target_size = (width, height)
        if (width, height) != target_size:
            raise ValueError("selected capture frames do not share one derived raster size")
        if image.size != (width, height):
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        output_name = f"{frame['sampleId']}.png"
        destination = images_root / output_name
        image.save(destination, format="PNG", compress_level=9)
        destination.chmod(0o600)
        model_name = names_by_sample[cast("str", frame["sampleId"])]
        camera_id, world_to_camera = model_images[model_name]
        if camera_id not in cameras:
            raise ValueError("COLMAP image references an unknown camera")
        source_width, source_height, parameters = cameras[camera_id]
        if image.size != (source_width, source_height):
            raise ValueError("COLMAP camera raster disagrees with the selected immutable source")
        sx, sy = width / source_width, height / source_height
        fx, fy, cx, cy = parameters
        frames.append(
            {
                "frameId": frame["sampleId"],
                "height": height,
                "imageName": output_name,
                "imageSha256": sha256_file(destination),
                "intrinsics": [
                    fx * sx,
                    0.0,
                    cx * sx,
                    0.0,
                    fy * sy,
                    cy * sy,
                    0.0,
                    0.0,
                    1.0,
                ],
                "width": width,
                "worldToCamera": world_to_camera,
            }
        )
    rights_basis = (
        "creator-owned-synthetic"
        if export_manifest["inputClass"] == "benchmark-fixture"
        else "user-authorised"
    )
    manifest: dict[str, Any] = {
        "coordinateSystem": "right-handed-local",
        "frames": frames,
        "initialGaussians": gaussians,
        "learningRate": 0.01,
        "rights": {
            "basis": rights_basis,
            "serviceProcessingAllowed": True,
            "trainingAllowed": False,
        },
        "schemaVersion": "c8-direct-gsplat-input-v2",
        "seed": 0,
        "steps": args.steps,
        "translationUnit": "arbitrary-units",
    }
    private_write(output / "appearance-input.json", canonical_bytes(manifest) + b"\n")
    model_hashes = {
        "cameras.txt": sha256_file(camera_path),
        "images.txt": sha256_file(model_image_path),
        "points3D.txt": sha256_file(points_path),
    }
    preparation = {
        "authority": "appearance-only-proposal",
        "cohort": args.cohort,
        "modelFileSha256": model_hashes,
        "schemaVersion": "c14-9-gsplat-preparation-v2",
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
        "sourceCoordinateSystem": "same-colmap-text-model-cameras-and-points",
        "sourceTranslation": "colmap-model-arbitrary-scale-not-dimensional-truth",
    }
    private_write(output / "capture-preparation.json", canonical_bytes(preparation) + b"\n")
    print(
        json.dumps(
            {"frameCount": len(frames), "gaussianCount": len(gaussians), "output": str(output)},
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
