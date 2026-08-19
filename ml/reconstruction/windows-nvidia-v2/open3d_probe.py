"""Execute non-trivial Open3D CUDA and known-pose TSDF acceptance."""

from __future__ import annotations

import importlib.metadata
import json
import time

import numpy as np  # type: ignore[import-not-found]
import open3d as o3d  # type: ignore[import-not-found]


def main() -> None:
    if not o3d.core.cuda.is_available():
        raise RuntimeError("OPEN3D_CUDA_UNAVAILABLE")
    started = time.perf_counter()
    device = o3d.core.Device("CUDA:0")
    left = o3d.core.Tensor(np.arange(4096, dtype=np.float32).reshape(64, 64), device=device)
    right = o3d.core.Tensor(np.eye(64, dtype=np.float32), device=device)
    product = left.matmul(right)
    cuda_checksum = float(product.sum().cpu().numpy())

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
    intrinsic = o3d.camera.PinholeCameraIntrinsic(width, height, 60.0, 60.0, 31.5, 23.5)
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
    point_count = len(points.points)
    vertex_count = len(mesh.vertices)
    triangle_count = len(mesh.triangles)
    if (
        not np.isfinite(cuda_checksum)
        or point_count == 0
        or vertex_count == 0
        or triangle_count == 0
    ):
        raise RuntimeError("OPEN3D_ALGORITHM_OUTPUT_INVALID")
    print(
        json.dumps(
            {
                "authority": "proposal-only",
                "cudaChecksum": cuda_checksum,
                "device": str(device),
                "durationMilliseconds": round((time.perf_counter() - started) * 1000),
                "open3d": importlib.metadata.version("open3d"),
                "pointCount": point_count,
                "schemaVersion": "c8-open3d-acceptance-v2",
                "triangleCount": triangle_count,
                "vertexCount": vertex_count,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
