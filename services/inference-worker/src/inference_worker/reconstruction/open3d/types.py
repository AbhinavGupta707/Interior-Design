"""Strict known-pose RGB-D inputs and deterministic TSDF configuration."""

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from ..common.errors import ReconstructionError
from ..common.hashing import JsonObject, sha256_json, validate_sha256

Matrix4 = tuple[
    tuple[float, float, float, float],
    tuple[float, float, float, float],
    tuple[float, float, float, float],
    tuple[float, float, float, float],
]


def _finite(value: float) -> float:
    if not math.isfinite(value):
        raise ReconstructionError("NON_FINITE_GEOMETRY", "RGB-D calibration is non-finite")
    if abs(value) > 1_000_000_000_000:
        raise ReconstructionError("GEOMETRY_OVERFLOW", "RGB-D calibration exceeds its bound")
    return value


@dataclass(frozen=True, slots=True)
class PinholeIntrinsics:
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    source_sha256: str
    validation_status: Literal["validated"] = "validated"

    def __post_init__(self) -> None:
        if self.validation_status != "validated":
            raise ReconstructionError("RGBD_INTRINSICS_INVALID", "intrinsics are not validated")
        validate_sha256(self.source_sha256, name="intrinsics source sha256")
        if not 1 <= self.width <= 100_000 or not 1 <= self.height <= 100_000:
            raise ReconstructionError("RGBD_INTRINSICS_INVALID", "intrinsic dimensions are invalid")
        if self.width * self.height > 50_000_000:
            raise ReconstructionError("RESOURCE_LIMIT", "RGB-D frame exceeds the C8 pixel ceiling")
        for value in (self.fx, self.fy, self.cx, self.cy):
            _finite(value)
        if self.fx <= 0 or self.fy <= 0:
            raise ReconstructionError("RGBD_INTRINSICS_INVALID", "focal lengths must be positive")
        if not 0 <= self.cx <= self.width or not 0 <= self.cy <= self.height:
            raise ReconstructionError(
                "RGBD_INTRINSICS_INVALID", "principal point is outside the image"
            )

    def to_json(self) -> JsonObject:
        return {
            "cx": self.cx,
            "cy": self.cy,
            "fx": self.fx,
            "fy": self.fy,
            "height": self.height,
            "sourceSha256": self.source_sha256,
            "validationStatus": self.validation_status,
            "width": self.width,
        }


@dataclass(frozen=True, slots=True)
class KnownPose:
    """A validated right-handed world-to-camera rigid transform."""

    world_to_camera: Matrix4
    source_sha256: str
    validation_status: Literal["validated"] = "validated"
    convention: Literal["world-to-camera"] = "world-to-camera"

    def __post_init__(self) -> None:
        if self.validation_status != "validated" or self.convention != "world-to-camera":
            raise ReconstructionError("RGBD_POSE_INVALID", "pose contract is invalid")
        validate_sha256(self.source_sha256, name="pose source sha256")
        for row in self.world_to_camera:
            for value in row:
                _finite(value)
        if (
            any(abs(self.world_to_camera[3][index]) > 1e-9 for index in range(3))
            or abs(self.world_to_camera[3][3] - 1.0) > 1e-9
        ):
            raise ReconstructionError("RGBD_POSE_INVALID", "pose is not homogeneous")
        rotation = tuple(row[:3] for row in self.world_to_camera[:3])
        for first in range(3):
            for second in range(3):
                dot = sum(rotation[first][index] * rotation[second][index] for index in range(3))
                expected = 1.0 if first == second else 0.0
                if abs(dot - expected) > 1e-5:
                    raise ReconstructionError(
                        "RGBD_POSE_INVALID", "pose rotation is not orthonormal"
                    )
        determinant = (
            rotation[0][0] * (rotation[1][1] * rotation[2][2] - rotation[1][2] * rotation[2][1])
            - rotation[0][1] * (rotation[1][0] * rotation[2][2] - rotation[1][2] * rotation[2][0])
            + rotation[0][2] * (rotation[1][0] * rotation[2][1] - rotation[1][1] * rotation[2][0])
        )
        if abs(determinant - 1.0) > 1e-5:
            raise ReconstructionError("RGBD_POSE_INVALID", "pose rotation changes handedness")

    def to_json(self) -> JsonObject:
        return {
            "convention": self.convention,
            "sourceSha256": self.source_sha256,
            "validationStatus": self.validation_status,
            "worldToCamera": [list(row) for row in self.world_to_camera],
        }


@dataclass(frozen=True, slots=True)
class RgbdFrame:
    color_path: Path = field(repr=False)
    depth_path: Path = field(repr=False)
    color_sha256: str
    depth_sha256: str
    width: int
    height: int
    timestamp_microseconds: int
    pose: KnownPose
    color_media_type: Literal["image/jpeg", "image/png"] = "image/png"
    depth_media_type: Literal["image/png"] = "image/png"

    def __post_init__(self) -> None:
        if self.color_media_type not in {"image/jpeg", "image/png"}:
            raise ReconstructionError("UNSUPPORTED_INPUT", "RGB media type is unsupported")
        if self.depth_media_type != "image/png":
            raise ReconstructionError("UNSUPPORTED_INPUT", "depth media type is unsupported")
        validate_sha256(self.color_sha256, name="color sha256")
        validate_sha256(self.depth_sha256, name="depth sha256")
        if self.color_sha256 == self.depth_sha256:
            raise ReconstructionError(
                "RGBD_SOURCE_MISMATCH", "color and depth sources are identical"
            )
        if not 1 <= self.width <= 100_000 or not 1 <= self.height <= 100_000:
            raise ReconstructionError("RGBD_FRAME_MISMATCH", "RGB-D frame dimensions are invalid")
        if self.width * self.height > 50_000_000:
            raise ReconstructionError("RESOURCE_LIMIT", "RGB-D frame exceeds the C8 pixel ceiling")
        if not 0 <= self.timestamp_microseconds <= 86_400_000_000:
            raise ReconstructionError("RGBD_FRAME_MISMATCH", "RGB-D timestamp is invalid")

    @property
    def frame_key_sha256(self) -> str:
        return sha256_json(
            {
                "colorSha256": self.color_sha256,
                "depthSha256": self.depth_sha256,
                "poseSha256": self.pose.source_sha256,
                "timestampMicroseconds": self.timestamp_microseconds,
            }
        )


@dataclass(frozen=True, slots=True)
class KnownPoseRgbdInput:
    frames: tuple[RgbdFrame, ...]
    intrinsics: PinholeIntrinsics
    source_manifest_sha256: str
    privacy_status: Literal["accepted"] = "accepted"
    training_use_consent: Literal["denied"] = "denied"

    def __post_init__(self) -> None:
        if self.privacy_status != "accepted":
            raise ReconstructionError("PRIVACY_REVIEW_REQUIRED", "privacy review is not accepted")
        if self.training_use_consent != "denied":
            raise ReconstructionError("TRAINING_USE_FORBIDDEN", "training use must remain denied")
        validate_sha256(self.source_manifest_sha256, name="source manifest sha256")
        if not 1 <= len(self.frames) <= 10_000:
            raise ReconstructionError("INVALID_FRAME_COUNT", "RGB-D frame count is invalid")
        timestamps = [frame.timestamp_microseconds for frame in self.frames]
        frame_keys = [frame.frame_key_sha256 for frame in self.frames]
        if len(set(timestamps)) != len(timestamps) or len(set(frame_keys)) != len(frame_keys):
            raise ReconstructionError(
                "DUPLICATE_FRAME", "RGB-D frames or timestamps are duplicated"
            )
        for frame in self.frames:
            if (frame.width, frame.height) != (self.intrinsics.width, self.intrinsics.height):
                raise ReconstructionError(
                    "RGBD_FRAME_MISMATCH", "frame and intrinsics dimensions disagree"
                )


@dataclass(frozen=True, slots=True)
class TsdfConfig:
    voxel_length_micrometres: int = 10_000
    sdf_truncation_micrometres: int = 40_000
    depth_scale_units_per_metre: int = 1_000
    depth_truncation_micrometres: int = 4_000_000
    integrate_color: bool = True

    def __post_init__(self) -> None:
        integer_values = (
            self.voxel_length_micrometres,
            self.sdf_truncation_micrometres,
            self.depth_scale_units_per_metre,
            self.depth_truncation_micrometres,
        )
        if (
            any(type(value) is not int for value in integer_values)
            or type(self.integrate_color) is not bool
        ):
            raise ValueError("TSDF parameters have invalid types")
        if not 1_000 <= self.voxel_length_micrometres <= 100_000:
            raise ValueError("TSDF voxel length is invalid")
        if not self.voxel_length_micrometres <= self.sdf_truncation_micrometres <= 1_000_000:
            raise ValueError("TSDF SDF truncation is invalid")
        if not 1 <= self.depth_scale_units_per_metre <= 1_000_000:
            raise ValueError("TSDF depth scale is invalid")
        if not 100_000 <= self.depth_truncation_micrometres <= 100_000_000:
            raise ValueError("TSDF depth truncation is invalid")

    def to_json(self) -> JsonObject:
        return {
            "depthScaleUnitsPerMetre": self.depth_scale_units_per_metre,
            "depthTruncationMicrometres": self.depth_truncation_micrometres,
            "integrateColor": self.integrate_color,
            "sdfTruncationMicrometres": self.sdf_truncation_micrometres,
            "voxelLengthMicrometres": self.voxel_length_micrometres,
        }

    @property
    def config_sha256(self) -> str:
        return sha256_json(self.to_json())
