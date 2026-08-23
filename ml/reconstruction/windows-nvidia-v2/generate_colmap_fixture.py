#!/usr/bin/env python3
"""Generate deterministic creator-owned COLMAP views and a known-pose text model."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

WIDTH = 480
HEIGHT = 360
FOCAL = 430.0
CX = (WIDTH - 1) / 2
CY = (HEIGHT - 1) / 2
CAMERA_COUNT = 10
Vec3 = tuple[float, float, float]

# depth, x-min, x-max, y-min, y-max, material. Nearest bounded planes occlude the back wall.
PLANES = (
    (4.1, -1.65, -0.20, -0.85, 0.70, 2),
    (5.1, 0.45, 1.75, -1.00, 0.45, 3),
    (7.0, -5.00, 5.00, -3.50, 3.50, 1),
)


@dataclass(frozen=True, slots=True)
class Camera:
    identifier: int
    name: str
    center: Vec3


@dataclass(frozen=True, slots=True)
class SurfacePoint:
    xyz: Vec3
    material: int


def _camera(identifier: int) -> Camera:
    fraction = (identifier - 1) / (CAMERA_COUNT - 1)
    return Camera(
        identifier=identifier,
        name=f"view-{identifier - 1:02d}.ppm",
        center=(
            -1.20 + 2.40 * fraction,
            0.14 * math.sin(fraction * math.pi * 2),
            0.0,
        ),
    )


def _surface(camera: Camera, ray_x: float, ray_y: float) -> SurfacePoint | None:
    for depth, x_min, x_max, y_min, y_max, material in PLANES:
        x = camera.center[0] + ray_x * depth
        y = camera.center[1] + ray_y * depth
        if x_min <= x <= x_max and y_min <= y <= y_max:
            return SurfacePoint((x, y, depth), material)
    return None


def _texture(point: Vec3, material: int) -> tuple[int, int, int]:
    x, y, _depth = point
    fine_x = math.floor((x + 11.0) * 13.0)
    fine_y = math.floor((y + 13.0) * 13.0)
    coarse = (math.floor((x + 10.0) * 2.5) + math.floor((y + 10.0) * 2.5)) & 1
    hashed = (
        (fine_x * 73856093) ^ (fine_y * 19349663) ^ (material * 83492791)
    ) & 0xFFFFFFFF
    palettes = ((0, 0, 0), (156, 139, 119), (181, 91, 69), (68, 129, 181))
    base = palettes[material]
    checker = 30 if coarse else -22
    border = 30 if fine_x % 17 == 0 or fine_y % 19 == 0 else 0
    values = []
    for channel, shift in enumerate((0, 6, 12)):
        grain = ((hashed >> shift) & 31) - 15
        values.append(max(0, min(255, base[channel] + checker + grain + border)))
    return (values[0], values[1], values[2])


def _render(camera: Camera, path: Path) -> None:
    payload = bytearray(f"P6\n{WIDTH} {HEIGHT}\n255\n".encode("ascii"))
    for pixel_y in range(HEIGHT):
        ray_y = (pixel_y + 0.5 - CY) / FOCAL
        for pixel_x in range(WIDTH):
            ray_x = (pixel_x + 0.5 - CX) / FOCAL
            surface = _surface(camera, ray_x, ray_y)
            payload.extend(
                _texture(surface.xyz, surface.material) if surface else (10, 14, 22)
            )
    path.write_bytes(payload)


def _project(camera: Camera, point: Vec3) -> tuple[float, float]:
    return (
        FOCAL * (point[0] - camera.center[0]) / point[2] + CX,
        FOCAL * (point[1] - camera.center[1]) / point[2] + CY,
    )


def _is_visible(camera: Camera, point: SurfacePoint) -> bool:
    pixel_x, pixel_y = _project(camera, point.xyz)
    if not (3 <= pixel_x < WIDTH - 3 and 3 <= pixel_y < HEIGHT - 3):
        return False
    ray_x = (point.xyz[0] - camera.center[0]) / point.xyz[2]
    ray_y = (point.xyz[1] - camera.center[1]) / point.xyz[2]
    hit = _surface(camera, ray_x, ray_y)
    return (
        hit is not None
        and hit.material == point.material
        and abs(hit.xyz[2] - point.xyz[2]) < 1e-9
    )


def _candidate_points() -> tuple[SurfacePoint, ...]:
    points: list[SurfacePoint] = []
    for depth, x_min, x_max, y_min, y_max, material in PLANES:
        x_steps = 28 if material == 1 else 10
        y_steps = 18 if material == 1 else 9
        for row in range(y_steps):
            y = y_min + (y_max - y_min) * (row + 0.5) / y_steps
            for column in range(x_steps):
                x = x_min + (x_max - x_min) * (column + 0.5) / x_steps
                points.append(SurfacePoint((x, y, depth), material))
    return tuple(points)


def _write_model(cameras: tuple[Camera, ...], root: Path) -> int:
    observations: dict[int, list[tuple[float, float, int]]] = {
        camera.identifier: [] for camera in cameras
    }
    tracks: list[tuple[int, SurfacePoint, tuple[tuple[int, int], ...]]] = []
    for point in _candidate_points():
        visible = tuple(camera for camera in cameras if _is_visible(camera, point))
        if len(visible) < 2:
            continue
        point_id = len(tracks) + 1
        point_track: list[tuple[int, int]] = []
        for camera in visible:
            point2d_index = len(observations[camera.identifier])
            pixel_x, pixel_y = _project(camera, point.xyz)
            observations[camera.identifier].append((pixel_x, pixel_y, point_id))
            point_track.append((camera.identifier, point2d_index))
        tracks.append((point_id, point, tuple(point_track)))

    root.mkdir()
    (root / "cameras.txt").write_text(
        "# Camera list with one line of data per camera:\n"
        "# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n"
        f"1 PINHOLE {WIDTH} {HEIGHT} {FOCAL:.17g} {FOCAL:.17g} {CX:.17g} {CY:.17g}\n",
        encoding="ascii",
    )
    image_lines = ["# Image list with two lines of data per image:"]
    for camera in cameras:
        tx, ty = -camera.center[0], -camera.center[1]
        image_lines.append(
            f"{camera.identifier} 1 0 0 0 {tx:.17g} {ty:.17g} 0 1 {camera.name}"
        )
        image_lines.append(
            " ".join(
                f"{pixel_x:.17g} {pixel_y:.17g} {point_id}"
                for pixel_x, pixel_y, point_id in observations[camera.identifier]
            )
        )
    (root / "images.txt").write_text("\n".join(image_lines) + "\n", encoding="ascii")

    point_lines = ["# 3D point list with one line of data per point:"]
    for point_id, point, track in tracks:
        xyz = " ".join(f"{value:.17g}" for value in point.xyz)
        rgb = " ".join(str(value) for value in _texture(point.xyz, point.material))
        track_text = " ".join(
            f"{image_id} {point2d_index}" for image_id, point2d_index in track
        )
        point_lines.append(f"{point_id} {xyz} {rgb} 0 {track_text}")
    (root / "points3D.txt").write_text(
        "\n".join(point_lines) + "\n", encoding="ascii"
    )
    return len(tracks)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("one empty output root is required")
    root = Path(sys.argv[1]).resolve()
    if root.is_symlink() or (root.exists() and any(root.iterdir())):
        raise ValueError("fixture output must be an empty non-symlink directory")
    root.mkdir(parents=True, exist_ok=True)
    images_root = root / "images"
    images_root.mkdir()

    cameras = tuple(_camera(identifier) for identifier in range(1, CAMERA_COUNT + 1))
    for camera in cameras:
        _render(camera, images_root / camera.name)
    point_track_count = _write_model(cameras, root / "known-model")

    generated = sorted(path for path in root.rglob("*") if path.is_file())
    file_hashes = {
        path.relative_to(root).as_posix(): _sha256(path) for path in generated
    }
    manifest = {
        "authority": "proposal-only",
        "cameraCount": len(cameras),
        "creator": "project-owned deterministic ray renderer",
        "files": file_hashes,
        "generatorSha256": _sha256(Path(__file__)),
        "height": HEIGHT,
        "pointTrackCount": point_track_count,
        "rights": {
            "basis": "creator-owned-synthetic",
            "customerDataUsed": False,
            "providerDataUsed": False,
            "serviceProcessingAllowed": True,
            "trainingAllowed": False,
        },
        "schemaVersion": "c8-colmap-fixture-v2",
        "width": WIDTH,
    }
    manifest_bytes = json.dumps(
        manifest, allow_nan=False, separators=(",", ":"), sort_keys=True
    ).encode()
    (root / "fixture-manifest.json").write_bytes(manifest_bytes)
    print(manifest_bytes.decode())


if __name__ == "__main__":
    main()
