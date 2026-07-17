"""Immutable in-memory representation of bounded COLMAP sparse outputs."""

import math
from dataclasses import dataclass

from ..common.alignment import Vec3
from ..common.errors import ReconstructionError

MAXIMUM_ABSOLUTE_VALUE = 1_000_000_000_000_000.0


@dataclass(frozen=True, slots=True)
class CameraModel:
    model_id: int
    name: str
    parameter_count: int


CAMERA_MODELS = (
    CameraModel(0, "SIMPLE_PINHOLE", 3),
    CameraModel(1, "PINHOLE", 4),
    CameraModel(2, "SIMPLE_RADIAL", 4),
    CameraModel(3, "RADIAL", 5),
    CameraModel(4, "OPENCV", 8),
    CameraModel(5, "OPENCV_FISHEYE", 8),
    CameraModel(6, "FULL_OPENCV", 12),
    CameraModel(7, "FOV", 5),
    CameraModel(8, "SIMPLE_RADIAL_FISHEYE", 4),
    CameraModel(9, "RADIAL_FISHEYE", 5),
    CameraModel(10, "THIN_PRISM_FISHEYE", 12),
    CameraModel(11, "RAD_TAN_THIN_PRISM_FISHEYE", 16),
    CameraModel(12, "SIMPLE_DIVISION", 4),
    CameraModel(13, "DIVISION", 5),
    CameraModel(14, "SIMPLE_FISHEYE", 3),
    CameraModel(15, "FISHEYE", 4),
    CameraModel(16, "EUCM", 6),
)
CAMERA_MODEL_BY_ID = {model.model_id: model for model in CAMERA_MODELS}
CAMERA_MODEL_BY_NAME = {model.name: model for model in CAMERA_MODELS}


def finite_number(value: float, *, code: str = "NON_FINITE_GEOMETRY") -> float:
    if not math.isfinite(value):
        raise ReconstructionError(code, "COLMAP output contains a non-finite value")
    if abs(value) > MAXIMUM_ABSOLUTE_VALUE:
        raise ReconstructionError("GEOMETRY_OVERFLOW", "COLMAP value exceeds its bound")
    return value


@dataclass(frozen=True, slots=True)
class Camera:
    camera_id: int
    model: CameraModel
    width: int
    height: int
    parameters: tuple[float, ...]

    def __post_init__(self) -> None:
        if self.camera_id <= 0 or not 1 <= self.width <= 100_000 or not 1 <= self.height <= 100_000:
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "camera dimensions or ID are invalid"
            )
        if self.width * self.height > 50_000_000:
            raise ReconstructionError("RESOURCE_LIMIT", "camera exceeds the C8 pixel ceiling")
        if len(self.parameters) != self.model.parameter_count:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "camera parameter count is invalid")
        for parameter in self.parameters:
            finite_number(parameter)


@dataclass(frozen=True, slots=True)
class Point2D:
    x: float
    y: float
    point3d_id: int | None

    def __post_init__(self) -> None:
        finite_number(self.x)
        finite_number(self.y)
        if self.point3d_id is not None and self.point3d_id <= 0:
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "2D observation has an invalid point ID"
            )


@dataclass(frozen=True, slots=True)
class Image:
    image_id: int
    quaternion_wxyz: tuple[float, float, float, float]
    translation_xyz: Vec3
    camera_id: int
    name: str
    points2d: tuple[Point2D, ...]

    def __post_init__(self) -> None:
        if self.image_id <= 0 or self.camera_id <= 0:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "image or camera ID is invalid")
        for value in self.quaternion_wxyz:
            finite_number(value)
        norm = math.sqrt(sum(value * value for value in self.quaternion_wxyz))
        if not 0.999 <= norm <= 1.001:
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "camera quaternion is not normalized"
            )
        if not self.name or len(self.name.encode("utf-8")) > 512:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "image name is invalid")
        if len(self.points2d) > 5_000_000:
            raise ReconstructionError("RESOURCE_LIMIT", "image observation count is excessive")


@dataclass(frozen=True, slots=True)
class TrackElement:
    image_id: int
    point2d_index: int

    def __post_init__(self) -> None:
        if self.image_id <= 0 or self.point2d_index < 0:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "point track element is invalid")


@dataclass(frozen=True, slots=True)
class Point3D:
    point3d_id: int
    xyz: Vec3
    rgb: tuple[int, int, int]
    reprojection_error: float
    track: tuple[TrackElement, ...]

    def __post_init__(self) -> None:
        if self.point3d_id <= 0 or any(not 0 <= channel <= 255 for channel in self.rgb):
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "3D point ID or color is invalid")
        finite_number(self.reprojection_error)
        if self.reprojection_error < 0 or len(self.track) > 10_000:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "3D point error or track is invalid")


@dataclass(frozen=True, slots=True)
class SparseModel:
    cameras: dict[int, Camera]
    images: dict[int, Image]
    points3d: dict[int, Point3D]
    source_format: str

    def __post_init__(self) -> None:
        if self.source_format not in {"binary", "text"}:
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "sparse model format is invalid")
        if not self.cameras or not self.images:
            raise ReconstructionError(
                "COLMAP_OUTPUT_INVALID", "sparse model has no cameras or images"
            )
        if len(self.images) > 10_000 or len(self.cameras) > 10_000:
            raise ReconstructionError("RESOURCE_LIMIT", "sparse model exceeds the frame ceiling")
        if (
            any(key != camera.camera_id for key, camera in self.cameras.items())
            or any(key != image.image_id for key, image in self.images.items())
            or any(key != point.point3d_id for key, point in self.points3d.items())
        ):
            raise ReconstructionError("COLMAP_OUTPUT_INVALID", "COLMAP map key disagrees with ID")
        for image in self.images.values():
            if image.camera_id not in self.cameras:
                raise ReconstructionError(
                    "COLMAP_OUTPUT_INVALID", "image references a missing camera"
                )
            camera = self.cameras[image.camera_id]
            for observation in image.points2d:
                if not -1.0 <= observation.x <= camera.width + 1.0:
                    raise ReconstructionError(
                        "COLMAP_OUTPUT_INVALID", "2D observation x is out of bounds"
                    )
                if not -1.0 <= observation.y <= camera.height + 1.0:
                    raise ReconstructionError(
                        "COLMAP_OUTPUT_INVALID", "2D observation y is out of bounds"
                    )
                if (
                    observation.point3d_id is not None
                    and observation.point3d_id not in self.points3d
                ):
                    raise ReconstructionError(
                        "COLMAP_OUTPUT_INVALID", "observation references a missing point"
                    )
        for point in self.points3d.values():
            for element in point.track:
                tracked_image = self.images.get(element.image_id)
                if tracked_image is None or element.point2d_index >= len(tracked_image.points2d):
                    raise ReconstructionError(
                        "COLMAP_OUTPUT_INVALID", "point track references missing data"
                    )
                if tracked_image.points2d[element.point2d_index].point3d_id != point.point3d_id:
                    raise ReconstructionError(
                        "COLMAP_OUTPUT_INVALID", "point track is inconsistent"
                    )


def quaternion_rotation(
    quaternion: tuple[float, float, float, float],
) -> tuple[tuple[float, ...], ...]:
    w, x, y, z = quaternion
    return (
        (1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * z * x + 2 * w * y),
        (2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x),
        (2 * z * x - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y),
    )


def camera_center(image: Image) -> Vec3:
    rotation = quaternion_rotation(image.quaternion_wxyz)
    translation = image.translation_xyz
    return Vec3(
        -(
            rotation[0][0] * translation.x
            + rotation[1][0] * translation.y
            + rotation[2][0] * translation.z
        ),
        -(
            rotation[0][1] * translation.x
            + rotation[1][1] * translation.y
            + rotation[2][1] * translation.z
        ),
        -(
            rotation[0][2] * translation.x
            + rotation[1][2] * translation.y
            + rotation[2][2] * translation.z
        ),
    )
