"""Isolated Open3D runner.

The parent adapter supplies no argv. This process reads and writes only fixed
workspace-relative names and emits one bounded safe status object.
"""

import json
import sys
from pathlib import Path
from typing import Any

INPUT_NAME = "open3d-input.json"
POINT_OUTPUT_NAME = "open3d-points.ply"
MESH_OUTPUT_NAME = "open3d-mesh.ply"
MAXIMUM_INPUT_BYTES = 10_485_760


def _load_input() -> dict[str, Any]:
    path = Path(INPUT_NAME)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAXIMUM_INPUT_BYTES:
        raise ValueError
    value: object = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError
    return value


def _safe_output(code: str, **counts: int) -> None:
    payload = {"code": code, **counts}
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), sort_keys=True))
    sys.stdout.flush()


def main() -> int:
    if len(sys.argv) != 1:
        _safe_output("OPEN3D_RUNNER_ARGUMENTS_INVALID")
        return 64
    try:
        import numpy as np  # type: ignore[import-not-found]
        import open3d as o3d  # type: ignore[import-not-found]

        payload = _load_input()
        if set(payload) != {"frames", "intrinsics", "outputTransform", "schemaVersion", "tsdf"}:
            raise ValueError
        if payload["schemaVersion"] != "c8-open3d-runner-input-v1":
            raise ValueError
        intrinsics = payload["intrinsics"]
        tsdf = payload["tsdf"]
        frames = payload["frames"]
        transform = payload["outputTransform"]
        if (
            not isinstance(intrinsics, dict)
            or not isinstance(tsdf, dict)
            or not isinstance(frames, list)
        ):
            raise ValueError
        intrinsic = o3d.camera.PinholeCameraIntrinsic(
            int(intrinsics["width"]),
            int(intrinsics["height"]),
            float(intrinsics["fx"]),
            float(intrinsics["fy"]),
            float(intrinsics["cx"]),
            float(intrinsics["cy"]),
        )
        color_type = (
            o3d.pipelines.integration.TSDFVolumeColorType.RGB8
            if bool(tsdf["integrateColor"])
            else o3d.pipelines.integration.TSDFVolumeColorType.NoColor
        )
        volume = o3d.pipelines.integration.ScalableTSDFVolume(
            voxel_length=int(tsdf["voxelLengthMicrometres"]) / 1_000_000.0,
            sdf_trunc=int(tsdf["sdfTruncationMicrometres"]) / 1_000_000.0,
            color_type=color_type,
        )
        for frame in frames:
            if not isinstance(frame, dict) or set(frame) != {"color", "depth", "worldToCamera"}:
                raise ValueError
            color = o3d.io.read_image(str(frame["color"]))
            depth = o3d.io.read_image(str(frame["depth"]))
            color_array = np.asarray(color)
            depth_array = np.asarray(depth)
            if tuple(color_array.shape[:2]) != (
                int(intrinsics["height"]),
                int(intrinsics["width"]),
            ):
                raise ValueError
            if tuple(depth_array.shape[:2]) != (
                int(intrinsics["height"]),
                int(intrinsics["width"]),
            ):
                raise ValueError
            rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
                color,
                depth,
                depth_scale=float(tsdf["depthScaleUnitsPerMetre"]),
                depth_trunc=int(tsdf["depthTruncationMicrometres"]) / 1_000_000.0,
                convert_rgb_to_intensity=False,
            )
            volume.integrate(rgbd, intrinsic, np.asarray(frame["worldToCamera"], dtype=np.float64))
        points = volume.extract_point_cloud()
        mesh = volume.extract_triangle_mesh()
        output_transform = np.asarray(transform, dtype=np.float64)
        points.transform(output_transform)
        mesh.transform(output_transform)
        mesh.compute_vertex_normals()
        if len(points.points) == 0 or len(mesh.vertices) == 0:
            _safe_output("OPEN3D_GEOMETRY_EMPTY")
            return 2
        if not o3d.io.write_point_cloud(
            POINT_OUTPUT_NAME, points, write_ascii=False, compressed=False
        ):
            raise RuntimeError
        if not o3d.io.write_triangle_mesh(
            MESH_OUTPUT_NAME, mesh, write_ascii=False, compressed=False
        ):
            raise RuntimeError
        _safe_output(
            "OPEN3D_OK",
            meshTriangleCount=len(mesh.triangles),
            meshVertexCount=len(mesh.vertices),
            pointCount=len(points.points),
        )
        return 0
    except ModuleNotFoundError:
        _safe_output("OPEN3D_NOT_INSTALLED")
        return 69
    except Exception:  # noqa: BLE001 - redact all provider details at the process boundary
        _safe_output("OPEN3D_EXECUTION_FAILED")
        return 70


if __name__ == "__main__":
    raise SystemExit(main())
