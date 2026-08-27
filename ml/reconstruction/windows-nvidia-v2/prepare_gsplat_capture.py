#!/usr/bin/env python3
"""Derive a bounded gsplat input from a verified selection and COLMAP sparse proposal."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import cast

from capture_benchmark import (
    as_object,
    canonical_bytes,
    load_selection,
    private_write,
    sha256_file,
    world_to_camera,
)
from PIL import Image  # type: ignore[import-not-found]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-root", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    parser.add_argument("--segment-id", required=True)
    parser.add_argument("--points3d", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--steps", type=int, default=100)
    args = parser.parse_args()
    export_root = Path(args.export_root)
    _, _, selection = load_selection(export_root, Path(args.selection))
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
        image_name = f"{frame['sampleId']}.png"
        destination = images_root / image_name
        image.save(destination, format="PNG", compress_level=9)
        destination.chmod(0o600)
        intrinsics = as_object(frame["cameraIntrinsicsMicropixels"], "intrinsics")
        source_width = cast("int", intrinsics["imageWidthPixels"])
        source_height = cast("int", intrinsics["imageHeightPixels"])
        sx, sy = width / source_width, height / source_height
        world_to_camera_matrix, _ = world_to_camera(frame)
        frames.append(
            {
                "frameId": frame["sampleId"],
                "height": height,
                "imageName": image_name,
                "imageSha256": sha256_file(destination),
                "intrinsics": [
                    cast("int", intrinsics["fx"]) / 1e6 * sx,
                    0.0,
                    cast("int", intrinsics["cx"]) / 1e6 * sx,
                    0.0,
                    cast("int", intrinsics["fy"]) / 1e6 * sy,
                    cast("int", intrinsics["cy"]) / 1e6 * sy,
                    0.0,
                    0.0,
                    1.0,
                ],
                "width": width,
                "worldToCamera": world_to_camera_matrix,
            }
        )
    points_path = Path(args.points3d)
    if points_path.is_symlink() or not points_path.is_file():
        raise ValueError("COLMAP points3D text must be a regular proposal artifact")
    gaussians: list[dict[str, object]] = []
    for line in points_path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) < 8:
            raise ValueError("COLMAP points3D record is malformed")
        xyz = [float(value) for value in fields[1:4]]
        rgb = [int(value) / 255 for value in fields[4:7]]
        if not all(math.isfinite(value) for value in xyz) or not all(
            0 <= value <= 1 for value in rgb
        ):
            raise ValueError("COLMAP proposal contains non-finite points or invalid colours")
        gaussians.append({"opacity": 0.5, "rgb": rgb, "scale": 0.02, "xyz": xyz})
        if len(gaussians) == 100000:
            break
    if len(gaussians) < 3:
        raise ValueError("COLMAP sparse proposal has too few initial points")
    manifest = {
        "coordinateSystem": "right-handed-local",
        "frames": frames,
        "initialGaussians": gaussians,
        "learningRate": 0.01,
        "rights": {
            "basis": "user-authorised",
            "serviceProcessingAllowed": True,
            "trainingAllowed": False,
        },
        "schemaVersion": "c8-direct-gsplat-input-v2",
        "seed": 0,
        "steps": args.steps,
        "translationUnit": "arbitrary-units",
    }
    private_write(output / "appearance-input.json", canonical_bytes(manifest) + b"\n")
    preparation = {
        "authority": "appearance-only-proposal",
        "cohort": args.cohort,
        "points3dSha256": sha256_file(points_path),
        "schemaVersion": "c14-9-gsplat-preparation-v1",
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
        "sourceTranslation": "metres-from-arkit-or-colmap-similarity-not-independent-truth",
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
