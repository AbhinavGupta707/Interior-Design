"""Bounded COLMAP text and little-endian binary sparse-model parsers."""

import struct
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, TextIO

from ..common.alignment import Vec3
from ..common.errors import ReconstructionError
from ..common.workspace import safe_workspace_path
from .models import (
    CAMERA_MODEL_BY_ID,
    CAMERA_MODEL_BY_NAME,
    Camera,
    Image,
    Point2D,
    Point3D,
    SparseModel,
    TrackElement,
    finite_number,
)


@dataclass(frozen=True, slots=True)
class ParserLimits:
    maximum_file_bytes: int = 536_870_912
    maximum_line_bytes: int = 1_048_576
    maximum_cameras: int = 10_000
    maximum_images: int = 10_000
    maximum_points3d: int = 5_000_000
    maximum_observations: int = 50_000_000


class _BinaryReader:
    def __init__(self, handle: BinaryIO, limits: ParserLimits) -> None:
        self.handle = handle
        self.limits = limits
        self.consumed = 0

    def read(self, size: int, format_string: str) -> tuple[int | float, ...]:
        if size < 0 or self.consumed + size > self.limits.maximum_file_bytes:
            raise ReconstructionError("RESOURCE_LIMIT", "binary COLMAP file exceeds its ceiling")
        data = self.handle.read(size)
        if len(data) != size:
            raise ReconstructionError(
                "COLMAP_OUTPUT_TRUNCATED", "binary COLMAP output is truncated"
            )
        self.consumed += size
        try:
            return struct.unpack("<" + format_string, data)
        except struct.error as error:
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "binary COLMAP record is malformed"
            ) from error

    def read_name(self) -> str:
        result = bytearray()
        for _ in range(513):
            value = self.read(1, "c")[0]
            assert isinstance(value, bytes)
            if value == b"\x00":
                try:
                    return result.decode("utf-8")
                except UnicodeDecodeError as error:
                    raise ReconstructionError(
                        "COLMAP_OUTPUT_INVALID", "image name is not UTF-8"
                    ) from error
            result.extend(value)
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "image name is not terminated")

    def require_eof(self) -> None:
        if self.handle.read(1) != b"":
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "binary COLMAP file has trailing data"
            )


def _regular_file(path: Path, limits: ParserLimits) -> None:
    if path.is_symlink() or not path.is_file():
        raise ReconstructionError("UNSAFE_PATH", "COLMAP output file is not regular")
    if path.stat().st_size > limits.maximum_file_bytes:
        raise ReconstructionError("RESOURCE_LIMIT", "COLMAP output file exceeds its ceiling")


def _validate_name(name: str) -> str:
    if not name or "\\" in name or "\x00" in name:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "image name is invalid")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ReconstructionError("UNSAFE_PATH", "COLMAP image name contains path traversal")
    if len(name.encode("utf-8")) > 512:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP image name is too long")
    return name


def _bounded_lines(handle: TextIO, limits: ParserLimits) -> list[str]:
    lines: list[str] = []
    while True:
        line = handle.readline(limits.maximum_line_bytes + 1)
        if not line:
            return lines
        if len(line.encode("utf-8")) > limits.maximum_line_bytes:
            raise ReconstructionError("RESOURCE_LIMIT", "COLMAP text line exceeds its ceiling")
        lines.append(line.rstrip("\r\n"))


def _data_lines(path: Path, limits: ParserLimits) -> list[str]:
    _regular_file(path, limits)
    try:
        with path.open("r", encoding="utf-8", errors="strict", newline="") as handle:
            return [
                line for line in _bounded_lines(handle, limits) if line and not line.startswith("#")
            ]
    except UnicodeDecodeError as error:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP text is not UTF-8") from error


def _integer(value: str, *, minimum: int, maximum: int) -> int:
    try:
        result = int(value, 10)
    except ValueError as error:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP integer is malformed") from error
    if not minimum <= result <= maximum:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP integer is out of bounds")
    return result


def _float(value: str) -> float:
    try:
        result = float(value)
    except ValueError as error:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP float is malformed") from error
    return finite_number(result)


def _unique_insert[T](target: dict[int, T], identifier: int, value: T) -> None:
    if identifier in target:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP identifiers are duplicated")
    target[identifier] = value


def _read_cameras_text(path: Path, limits: ParserLimits) -> dict[int, Camera]:
    cameras: dict[int, Camera] = {}
    for line in _data_lines(path, limits):
        fields = line.split()
        if len(fields) < 5:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "camera record is incomplete")
        camera_id = _integer(fields[0], minimum=1, maximum=2_147_483_647)
        model = CAMERA_MODEL_BY_NAME.get(fields[1])
        if model is None or len(fields) != 4 + model.parameter_count:
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "camera model or parameters are invalid"
            )
        camera = Camera(
            camera_id=camera_id,
            model=model,
            width=_integer(fields[2], minimum=1, maximum=100_000),
            height=_integer(fields[3], minimum=1, maximum=100_000),
            parameters=tuple(_float(value) for value in fields[4:]),
        )
        _unique_insert(cameras, camera_id, camera)
        if len(cameras) > limits.maximum_cameras:
            raise ReconstructionError("RESOURCE_LIMIT", "camera count exceeds its ceiling")
    return cameras


def _read_images_text(path: Path, limits: ParserLimits) -> dict[int, Image]:
    _regular_file(path, limits)
    try:
        with path.open("r", encoding="utf-8", errors="strict", newline="") as handle:
            physical_lines = _bounded_lines(handle, limits)
    except UnicodeDecodeError as error:
        raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP text is not UTF-8") from error
    images: dict[int, Image] = {}
    index = 0
    observations_total = 0
    while index < len(physical_lines):
        header = physical_lines[index]
        index += 1
        if not header or header.startswith("#"):
            continue
        fields = header.split(maxsplit=9)
        if len(fields) != 10 or index >= len(physical_lines):
            raise ReconstructionError("COLMAP_OUTPUT_TRUNCATED", "image record is incomplete")
        observation_line = physical_lines[index]
        index += 1
        if observation_line.startswith("#"):
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "image observations are malformed")
        values = observation_line.split()
        if len(values) % 3 != 0:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "2D observations are malformed")
        observations_total += len(values) // 3
        if observations_total > limits.maximum_observations:
            raise ReconstructionError("RESOURCE_LIMIT", "observation count exceeds its ceiling")
        points: list[Point2D] = []
        for offset in range(0, len(values), 3):
            point_id = _integer(values[offset + 2], minimum=-1, maximum=9_223_372_036_854_775_807)
            points.append(
                Point2D(
                    x=_float(values[offset]),
                    y=_float(values[offset + 1]),
                    point3d_id=None if point_id == -1 else point_id,
                )
            )
        image_id = _integer(fields[0], minimum=1, maximum=2_147_483_647)
        image = Image(
            image_id=image_id,
            quaternion_wxyz=tuple(_float(value) for value in fields[1:5]),  # type: ignore[arg-type]
            translation_xyz=Vec3(*(_float(value) for value in fields[5:8])),
            camera_id=_integer(fields[8], minimum=1, maximum=2_147_483_647),
            name=_validate_name(fields[9]),
            points2d=tuple(points),
        )
        _unique_insert(images, image_id, image)
        if len(images) > limits.maximum_images:
            raise ReconstructionError("RESOURCE_LIMIT", "image count exceeds its ceiling")
    return images


def _read_points_text(path: Path, limits: ParserLimits) -> dict[int, Point3D]:
    points: dict[int, Point3D] = {}
    observations = 0
    for line in _data_lines(path, limits):
        fields = line.split()
        if len(fields) < 8 or (len(fields) - 8) % 2 != 0:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "3D point record is malformed")
        point_id = _integer(fields[0], minimum=1, maximum=9_223_372_036_854_775_807)
        track = tuple(
            TrackElement(
                image_id=_integer(fields[offset], minimum=1, maximum=2_147_483_647),
                point2d_index=_integer(fields[offset + 1], minimum=0, maximum=4_999_999),
            )
            for offset in range(8, len(fields), 2)
        )
        observations += len(track)
        if observations > limits.maximum_observations:
            raise ReconstructionError("RESOURCE_LIMIT", "track count exceeds its ceiling")
        point = Point3D(
            point3d_id=point_id,
            xyz=Vec3(*(_float(value) for value in fields[1:4])),
            rgb=tuple(_integer(value, minimum=0, maximum=255) for value in fields[4:7]),  # type: ignore[arg-type]
            reprojection_error=_float(fields[7]),
            track=track,
        )
        _unique_insert(points, point_id, point)
        if len(points) > limits.maximum_points3d:
            raise ReconstructionError("RESOURCE_LIMIT", "3D point count exceeds its ceiling")
    return points


def _read_cameras_binary(path: Path, limits: ParserLimits) -> dict[int, Camera]:
    _regular_file(path, limits)
    cameras: dict[int, Camera] = {}
    with path.open("rb") as handle:
        reader = _BinaryReader(handle, limits)
        count = int(reader.read(8, "Q")[0])
        if count > limits.maximum_cameras:
            raise ReconstructionError("RESOURCE_LIMIT", "camera count exceeds its ceiling")
        for _ in range(count):
            camera_id, model_id, width, height = reader.read(24, "iiQQ")
            model = CAMERA_MODEL_BY_ID.get(int(model_id))
            if model is None:
                raise ReconstructionError("COLMAP_OUTPUT_INVALID", "camera model ID is unsupported")
            parameters = tuple(
                float(value)
                for value in reader.read(8 * model.parameter_count, "d" * model.parameter_count)
            )
            camera = Camera(int(camera_id), model, int(width), int(height), parameters)
            _unique_insert(cameras, camera.camera_id, camera)
        reader.require_eof()
    return cameras


def _read_images_binary(path: Path, limits: ParserLimits) -> dict[int, Image]:
    _regular_file(path, limits)
    images: dict[int, Image] = {}
    observations_total = 0
    with path.open("rb") as handle:
        reader = _BinaryReader(handle, limits)
        count = int(reader.read(8, "Q")[0])
        if count > limits.maximum_images:
            raise ReconstructionError("RESOURCE_LIMIT", "image count exceeds its ceiling")
        for _ in range(count):
            values = reader.read(64, "idddddddi")
            name = _validate_name(reader.read_name())
            point_count = int(reader.read(8, "Q")[0])
            observations_total += point_count
            if observations_total > limits.maximum_observations:
                raise ReconstructionError("RESOURCE_LIMIT", "observation count exceeds its ceiling")
            points: list[Point2D] = []
            for _point in range(point_count):
                x, y, point_id = reader.read(24, "ddq")
                points.append(
                    Point2D(float(x), float(y), None if int(point_id) == -1 else int(point_id))
                )
            image = Image(
                image_id=int(values[0]),
                quaternion_wxyz=tuple(float(item) for item in values[1:5]),  # type: ignore[arg-type]
                translation_xyz=Vec3(*(float(item) for item in values[5:8])),
                camera_id=int(values[8]),
                name=name,
                points2d=tuple(points),
            )
            _unique_insert(images, image.image_id, image)
        reader.require_eof()
    return images


def _read_points_binary(path: Path, limits: ParserLimits) -> dict[int, Point3D]:
    _regular_file(path, limits)
    points: dict[int, Point3D] = {}
    observations = 0
    with path.open("rb") as handle:
        reader = _BinaryReader(handle, limits)
        count = int(reader.read(8, "Q")[0])
        if count > limits.maximum_points3d:
            raise ReconstructionError("RESOURCE_LIMIT", "3D point count exceeds its ceiling")
        for _ in range(count):
            values = reader.read(43, "QdddBBBd")
            track_count = int(reader.read(8, "Q")[0])
            observations += track_count
            if observations > limits.maximum_observations or track_count > 10_000:
                raise ReconstructionError("RESOURCE_LIMIT", "point track count exceeds its ceiling")
            track = tuple(
                TrackElement(*(int(item) for item in reader.read(8, "ii")))
                for _element in range(track_count)
            )
            point = Point3D(
                point3d_id=int(values[0]),
                xyz=Vec3(float(values[1]), float(values[2]), float(values[3])),
                rgb=(int(values[4]), int(values[5]), int(values[6])),
                reprojection_error=float(values[7]),
                track=track,
            )
            _unique_insert(points, point.point3d_id, point)
        reader.require_eof()
    return points


def read_sparse_model(
    workspace: Path,
    relative_model_directory: str,
    *,
    limits: ParserLimits | None = None,
) -> SparseModel:
    """Read one model below a trusted workspace, preferring complete binary output."""

    limits = limits or ParserLimits()
    directory = safe_workspace_path(workspace, relative_model_directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ReconstructionError("UNSAFE_PATH", "COLMAP model directory is invalid")
    binary_paths = tuple(directory / name for name in ("cameras.bin", "images.bin", "points3D.bin"))
    text_paths = tuple(directory / name for name in ("cameras.txt", "images.txt", "points3D.txt"))
    binary_present = tuple(path.exists() for path in binary_paths)
    text_present = tuple(path.exists() for path in text_paths)
    if any(binary_present) and not all(binary_present):
        raise ReconstructionError("COLMAP_OUTPUT_TRUNCATED", "binary sparse model is incomplete")
    if all(binary_present):
        return SparseModel(
            cameras=_read_cameras_binary(binary_paths[0], limits),
            images=_read_images_binary(binary_paths[1], limits),
            points3d=_read_points_binary(binary_paths[2], limits),
            source_format="binary",
        )
    if any(text_present) and not all(text_present):
        raise ReconstructionError("COLMAP_OUTPUT_TRUNCATED", "text sparse model is incomplete")
    if all(text_present):
        return SparseModel(
            cameras=_read_cameras_text(text_paths[0], limits),
            images=_read_images_text(text_paths[1], limits),
            points3d=_read_points_text(text_paths[2], limits),
            source_format="text",
        )
    raise ReconstructionError("COLMAP_OUTPUT_MISSING", "sparse model files are absent")


def discover_sparse_model_directories(workspace: Path, relative_root: str) -> tuple[str, ...]:
    root = safe_workspace_path(workspace, relative_root)
    if root.is_symlink() or not root.is_dir():
        raise ReconstructionError("COLMAP_OUTPUT_MISSING", "sparse model root is absent")
    direct_files = {path.name for path in root.iterdir() if path.is_file()}
    if {"cameras.bin", "images.bin", "points3D.bin"}.issubset(direct_files) or {
        "cameras.txt",
        "images.txt",
        "points3D.txt",
    }.issubset(direct_files):
        return (relative_root,)
    directories: list[tuple[int, str]] = []
    for child in root.iterdir():
        if child.is_symlink():
            raise ReconstructionError("UNSAFE_PATH", "sparse model root contains a symlink")
        if child.is_dir():
            if not child.name.isdecimal():
                raise ReconstructionError(
                    "COLMAP_OUTPUT_INVALID", "model directory name is invalid"
                )
            directories.append((int(child.name), f"{relative_root}/{child.name}"))
    if len(directories) > 1_000:
        raise ReconstructionError("RESOURCE_LIMIT", "model component count exceeds its ceiling")
    return tuple(value for _, value in sorted(directories))
