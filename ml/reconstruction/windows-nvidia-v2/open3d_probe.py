"""Execute separate Open3D CUDA-tensor and known-pose CPU-TSDF acceptance."""

from __future__ import annotations

import importlib.metadata
import json
import resource
import time

import numpy as np  # type: ignore[import-not-found]
import open3d as o3d  # type: ignore[import-not-found]


def main() -> None:
    if not o3d.core.cuda.is_available():
        raise RuntimeError("OPEN3D_CUDA_UNAVAILABLE")

    total_started = time.perf_counter()
    cuda_started = time.perf_counter()
    device = o3d.core.Device("CUDA:0")
    left = o3d.core.Tensor(
        np.arange(4096, dtype=np.float32).reshape(64, 64), device=device
    )
    right = o3d.core.Tensor(np.eye(64, dtype=np.float32), device=device)
    product = left.matmul(right)
    cuda_checksum = float(product.sum().cpu().numpy())
    cuda_duration_ms = round((time.perf_counter() - cuda_started) * 1000)

    # ScalableTSDFVolume is the legacy CPU pipeline. It does not inherit the CUDA
    # tensor's device merely because both operations execute in one process.
    tsdf_started = time.perf_counter()
    width = 64
    height = 48
    color_data = np.zeros((height, width, 3), dtype=np.uint8)
    color_data[..., 0] = 96
    color_data[..., 1] = 160
    color_data[..., 2] = 224
    depth_data = np.full((height, width), 1000, dtype=np.uint16)
    color = o3d.geometry.Image(color_data)
    depth = o3d.geometry.Image(depth_data)
    rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
        color,
        depth,
        depth_scale=1000.0,
        depth_trunc=3.0,
        convert_rgb_to_intensity=False,
    )
    intrinsic = o3d.camera.PinholeCameraIntrinsic(
        width, height, 60.0, 60.0, 31.5, 23.5
    )
    volume = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=0.02,
        sdf_trunc=0.08,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
    )
    for x_offset in (-0.02, 0.0, 0.02):
        extrinsic = np.eye(4, dtype=np.float64)
        extrinsic[0, 3] = x_offset
        volume.integrate(rgbd, intrinsic, extrinsic)

    points = volume.extract_point_cloud()
    mesh = volume.extract_triangle_mesh()
    point_values = np.asarray(points.points)
    vertex_values = np.asarray(mesh.vertices)
    triangle_values = np.asarray(mesh.triangles)
    if (
        len(point_values) == 0
        or len(vertex_values) == 0
        or len(triangle_values) == 0
        or not np.isfinite(cuda_checksum)
        or not np.isfinite(point_values).all()
        or not np.isfinite(vertex_values).all()
        or not np.isfinite(triangle_values).all()
    ):
        raise RuntimeError("OPEN3D_ALGORITHM_OUTPUT_INVALID")
    tsdf_duration_ms = round((time.perf_counter() - tsdf_started) * 1000)

    print(
        json.dumps(
            {
                "authority": "proposal-only",
                "cpuTsdf": {
                    "backend": "legacy-cpu",
                    "durationMilliseconds": tsdf_duration_ms,
                    "knownPose": True,
                    "pointCount": len(point_values),
                    "triangleCount": len(triangle_values),
                    "vertexCount": len(vertex_values),
                },
                "cudaTensorProbe": {
                    "backend": "CUDA",
                    "checksum": cuda_checksum,
                    "device": str(device),
                    "durationMilliseconds": cuda_duration_ms,
                    "matrixShape": [64, 64],
                },
                "open3d": importlib.metadata.version("open3d"),
                "peakHostMemoryBytes": (
                    resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
                ),
                "schemaVersion": "c8-open3d-acceptance-v3",
                "suppliedDepthUnit": "metre-not-independently-validated",
                "totalDurationMilliseconds": round(
                    (time.perf_counter() - total_started) * 1000
                ),
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
