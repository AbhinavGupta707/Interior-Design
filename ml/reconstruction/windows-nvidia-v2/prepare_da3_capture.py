#!/usr/bin/env python3
"""Prepare an immutable, segment-scoped DA3 input without changing source bytes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath
from typing import Any, cast

from capture_benchmark import (
    as_object,
    canonical_bytes,
    colmap_image_name,
    load_selection,
    private_copy,
    private_write,
    safe_root,
    selected_segment,
    sha256_file,
    world_to_camera,
)


def prepare(args: argparse.Namespace) -> None:
    export_root = Path(args.export_root)
    _, _, selection = load_selection(
        export_root,
        Path(args.selection),
        physical_root_alias=args.physical_root_alias,
    )
    segment = selected_segment(selection, args.cohort, args.segment_id)
    frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
    if not frames:
        raise ValueError("DA3 requires at least one selected RGB frame")
    output = safe_root(Path(args.output), create=True)
    images = output / "images"
    images.mkdir(mode=0o700)
    records: list[dict[str, Any]] = []
    for frame in frames:
        source = export_root.joinpath(*PurePosixPath(cast("str", frame["imagePath"])).parts)
        name = colmap_image_name(frame)
        destination = images / name
        private_copy(source, destination)
        if sha256_file(destination) != frame["imageSha256"]:
            raise ValueError("derived DA3 input copy changed immutable RGB bytes")
        intrinsics = as_object(frame["cameraIntrinsicsMicropixels"], "intrinsics")
        world_to_camera_matrix, _ = world_to_camera(frame)
        records.append(
            {
                "cameraIntrinsics": [
                    cast("int", intrinsics[key]) / 1_000_000 for key in ("fx", "fy", "cx", "cy")
                ],
                "heightPixels": intrinsics["imageHeightPixels"],
                "imageName": name,
                "imageSha256": frame["imageSha256"],
                "sampleId": frame["sampleId"],
                "worldToCamera": world_to_camera_matrix,
                "widthPixels": intrinsics["imageWidthPixels"],
            }
        )
    manifest = {
        "authority": "proposal-only-learned-input-copy",
        "cohort": args.cohort,
        "frames": records,
        "heldOutPolicy": "last-frame-when-four-or-more",
        "schemaVersion": "c14-10-da3-input-v1",
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
        "sourceCoordinateSystem": "arkit-segment-converted-to-opencv-world-to-camera",
        "sourceUnit": "metres-from-arkit-not-independently-validated",
    }
    manifest_path = output / "da3-input.json"
    private_write(manifest_path, canonical_bytes(manifest) + b"\n")
    print(
        json.dumps(
            {
                "frameCount": len(records),
                "manifestSha256": sha256_file(manifest_path),
                "output": str(output),
            },
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--export-root", required=True)
    value.add_argument("--selection", required=True)
    value.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    value.add_argument("--segment-id", required=True)
    value.add_argument("--output", required=True)
    value.add_argument("--physical-root-alias")
    value.set_defaults(function=prepare)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
