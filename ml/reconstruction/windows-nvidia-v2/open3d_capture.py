#!/usr/bin/env python3
"""Known-pose TSDF proposal from one verified Capture Envelope segment."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import resource
import time
from pathlib import Path
from typing import cast

import numpy as np  # type: ignore[import-not-found]
import open3d as o3d  # type: ignore[import-not-found]
from capture_benchmark import (
    as_object,
    canonical_bytes,
    load_selection,
    private_write,
    sha256_file,
    world_to_camera,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-root", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    parser.add_argument("--segment-id", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    export_root = Path(args.export_root)
    export_manifest, envelope, selection = load_selection(export_root, Path(args.selection))
    output = Path(args.output)
    if output.is_symlink() or not output.is_dir() or any(output.iterdir()):
        raise ValueError("output must be a new empty mounted directory")
    cohort = as_object(as_object(selection["cohorts"], "cohorts")[args.cohort], "cohort")
    segment = next(
        as_object(raw, "segment")
        for raw in cast("list[object]", cohort["segments"])
        if as_object(raw, "segment")["segmentId"] == args.segment_id
    )
    frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
    depth_sources = [
        as_object(raw, "depth") for raw in cast("list[object]", envelope["depthSources"])
    ]
    depth_paths = {
        cast("str", entry["sourceId"]): cast("str", entry["path"])
        for raw in cast("list[object]", export_manifest["files"])
        for entry in [as_object(raw, "export file")]
        if entry.get("kind") == "depth-original"
    }
    if not o3d.core.cuda.is_available():
        raise RuntimeError("OPEN3D_CUDA_UNAVAILABLE")
    cuda_device = o3d.core.Device("CUDA:0")
    probe = o3d.core.Tensor(np.eye(32, dtype=np.float32), device=cuda_device)
    cuda_checksum = float(probe.matmul(probe).sum().cpu().numpy())
    volume = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=0.02,
        sdf_trunc=0.08,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
    )
    used: list[dict[str, object]] = []
    total_depth_value_count = 0
    total_nonfinite_depth_count = 0
    total_nonpositive_depth_count = 0
    started = time.perf_counter()
    for frame in frames:
        source = next(
            (item for item in depth_sources if frame["sampleId"] in item["sampleIds"]), None
        )
        if source is None:
            continue
        sample_index = cast("list[str]", source["sampleIds"]).index(cast("str", frame["sampleId"]))
        depth_width = cast("int", source["widthPixels"])
        depth_height = cast("int", source["heightPixels"])
        dtype = np.dtype("<f2" if source["format"] == "float16-metres-little-endian" else "<f4")
        count = depth_width * depth_height
        declared_path = depth_paths.get(cast("str", source["artifactId"]))
        if declared_path is None:
            raise ValueError("exact bound depth is absent from the verified export")
        depth_path = export_root.joinpath(*Path(declared_path).parts)
        depth = (
            np.fromfile(
                depth_path, dtype=dtype, count=count, offset=sample_index * count * dtype.itemsize
            )
            .astype(np.float32)
            .reshape(depth_height, depth_width)
        )
        finite = np.isfinite(depth)
        nonfinite = int((~finite).sum())
        nonpositive = int((finite & (depth <= 0)).sum())
        positive = int((finite & (depth > 0)).sum())
        total_depth_value_count += depth.size
        total_nonfinite_depth_count += nonfinite
        total_nonpositive_depth_count += nonpositive
        depth[~finite | (depth <= 0)] = 0
        image_path = export_root.joinpath(*Path(cast("str", frame["imagePath"])).parts)
        color_array = np.asarray(o3d.io.read_image(str(image_path)))
        if color_array.ndim != 3 or color_array.shape[2] < 3:
            raise ValueError("RGB source could not be decoded as colour")
        color_array = color_array[:, :, :3].astype(np.uint8)
        intrinsics = as_object(frame["cameraIntrinsicsMicropixels"], "intrinsics")
        width = cast("int", intrinsics["imageWidthPixels"])
        height = cast("int", intrinsics["imageHeightPixels"])
        if color_array.shape[:2] != (height, width):
            raise ValueError("RGB raster dimensions disagree with retained intrinsics")
        if depth.shape != (height, width):
            rows = np.minimum((np.arange(height) * depth_height // height), depth_height - 1)
            columns = np.minimum((np.arange(width) * depth_width // width), depth_width - 1)
            depth = depth[rows[:, None], columns[None, :]]
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(color_array),
            o3d.geometry.Image(depth),
            depth_scale=1.0,
            depth_trunc=10.0,
            convert_rgb_to_intensity=False,
        )
        intrinsic = o3d.camera.PinholeCameraIntrinsic(
            width,
            height,
            cast("int", intrinsics["fx"]) / 1e6,
            cast("int", intrinsics["fy"]) / 1e6,
            cast("int", intrinsics["cx"]) / 1e6,
            cast("int", intrinsics["cy"]) / 1e6,
        )
        matrix, _ = world_to_camera(frame)
        extrinsic = np.asarray(matrix, dtype=np.float64).reshape(4, 4)
        volume.integrate(rgbd, intrinsic, extrinsic)
        used.append(
            {
                "depthArtifactId": source["artifactId"],
                "depthSampleIndex": sample_index,
                "depthValueCount": count,
                "finitePositiveDepthCount": positive,
                "nonfiniteDepthCount": nonfinite,
                "nonpositiveDepthCount": nonpositive,
                "sampleId": frame["sampleId"],
            }
        )
    if not used:
        raise RuntimeError("NO_EXACT_BOUND_DEPTH_FRAMES")
    points = volume.extract_point_cloud()
    mesh = volume.extract_triangle_mesh()
    point_values = np.asarray(points.points)
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    if len(point_values) == 0 or not np.isfinite(point_values).all():
        raise RuntimeError("OPEN3D_CAPTURE_OUTPUT_INVALID")
    o3d.io.write_point_cloud(
        str(output / "capture-points.ply"), points, write_ascii=False, compressed=False
    )
    if (
        len(vertices)
        and len(triangles)
        and np.isfinite(vertices).all()
        and np.isfinite(triangles).all()
    ):
        o3d.io.write_triangle_mesh(
            str(output / "capture-mesh.ply"), mesh, write_ascii=False, compressed=False
        )
    result = {
        "authority": "proposal-only",
        "cohort": args.cohort,
        "cudaTensorProbe": {"checksum": cuda_checksum, "device": str(cuda_device)},
        "depthBindingDenominator": {
            "eligibleFrameCount": len(frames),
            "integratedFrameCount": len(used),
            "missingExactDepthFrameCount": len(frames) - len(used),
            "totalDepthValueCount": total_depth_value_count,
            "totalFinitePositiveDepthCount": (
                total_depth_value_count
                - total_nonfinite_depth_count
                - total_nonpositive_depth_count
            ),
            "totalNonfiniteDepthCount": total_nonfinite_depth_count,
            "totalNonpositiveDepthCount": total_nonpositive_depth_count,
        },
        "durationMilliseconds": round((time.perf_counter() - started) * 1000),
        "frameCount": len(used),
        "open3d": importlib.metadata.version("open3d"),
        "peakHostMemoryBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "pointCount": len(point_values),
        "schemaVersion": "c14-9-open3d-capture-result-v1",
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
        "suppliedDepthUnit": "metres-not-independently-validated",
        "triangleCount": len(triangles),
        "usedFrames": used,
        "vertexCount": len(vertices),
    }
    private_write(output / "capture-open3d-result.json", canonical_bytes(result) + b"\n")
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
