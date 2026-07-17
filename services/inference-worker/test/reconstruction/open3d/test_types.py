"""Validated-intrinsics, known-pose and RGB-D pairing adversarial tests."""

import hashlib
import math
from pathlib import Path

import pytest
from inference_worker.reconstruction.common.errors import ReconstructionError
from inference_worker.reconstruction.open3d.types import (
    KnownPose,
    KnownPoseRgbdInput,
    Matrix4,
    PinholeIntrinsics,
    RgbdFrame,
    TsdfConfig,
)

IDENTITY = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)


def _pose(matrix: Matrix4 = IDENTITY) -> KnownPose:
    return KnownPose(matrix, "a" * 64)


def _frame(
    tmp_path: Path,
    *,
    index: int = 0,
    width: int = 2,
    height: int = 2,
    timestamp: int = 0,
) -> RgbdFrame:
    color = tmp_path / f"color-{index}"
    depth = tmp_path / f"depth-{index}"
    color_bytes = f"synthetic-color-{index}".encode()
    depth_bytes = f"synthetic-depth-{index}".encode()
    color.write_bytes(color_bytes)
    depth.write_bytes(depth_bytes)
    return RgbdFrame(
        color_path=color,
        depth_path=depth,
        color_sha256=hashlib.sha256(color_bytes).hexdigest(),
        depth_sha256=hashlib.sha256(depth_bytes).hexdigest(),
        width=width,
        height=height,
        timestamp_microseconds=timestamp,
        pose=_pose(),
    )


@pytest.mark.parametrize(
    "fx,fy,cx,code",
    [
        (math.nan, 100.0, 1.0, "NON_FINITE_GEOMETRY"),
        (0.0, 100.0, 1.0, "RGBD_INTRINSICS_INVALID"),
        (100.0, 100.0, 3.0, "RGBD_INTRINSICS_INVALID"),
        (1e13, 100.0, 1.0, "GEOMETRY_OVERFLOW"),
    ],
)
def test_intrinsics_nan_overflow_and_invalid_values_fail_closed(
    fx: float, fy: float, cx: float, code: str
) -> None:
    with pytest.raises(ReconstructionError) as raised:
        PinholeIntrinsics(2, 2, fx, fy, cx, 1.0, "b" * 64)
    assert raised.value.safe_code == code


@pytest.mark.parametrize(
    "matrix",
    [
        (
            (2.0, 0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        ),
        (
            (-1.0, 0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        ),
        (
            (1.0, 0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (1.0, 0.0, 0.0, 1.0),
        ),
    ],
)
def test_non_rigid_reflected_or_non_homogeneous_pose_is_rejected(
    matrix: Matrix4,
) -> None:
    with pytest.raises(ReconstructionError, match="RGBD_POSE_INVALID"):
        _pose(matrix)


def test_rgbd_frame_intrinsic_dimension_and_duplicate_timestamp_mismatches(
    tmp_path: Path,
) -> None:
    intrinsics = PinholeIntrinsics(2, 2, 100, 100, 1, 1, "b" * 64)
    with pytest.raises(ReconstructionError, match="RGBD_FRAME_MISMATCH"):
        KnownPoseRgbdInput(
            frames=(_frame(tmp_path, width=3),),
            intrinsics=intrinsics,
            source_manifest_sha256="c" * 64,
        )
    with pytest.raises(ReconstructionError, match="DUPLICATE_FRAME"):
        KnownPoseRgbdInput(
            frames=(_frame(tmp_path, index=1, timestamp=5), _frame(tmp_path, index=2, timestamp=5)),
            intrinsics=intrinsics,
            source_manifest_sha256="c" * 64,
        )


def test_color_and_depth_hash_cannot_be_identical(tmp_path: Path) -> None:
    path = tmp_path / "same"
    path.write_bytes(b"synthetic")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(ReconstructionError, match="RGBD_SOURCE_MISMATCH"):
        RgbdFrame(path, path, digest, digest, 2, 2, 0, _pose())


def test_tsdf_parameters_are_integer_bounded_and_deterministically_hashed() -> None:
    config = TsdfConfig(
        voxel_length_micrometres=8_000,
        sdf_truncation_micrometres=32_000,
        depth_scale_units_per_metre=1_000,
        depth_truncation_micrometres=3_500_000,
    )
    assert config.to_json() == {
        "depthScaleUnitsPerMetre": 1_000,
        "depthTruncationMicrometres": 3_500_000,
        "integrateColor": True,
        "sdfTruncationMicrometres": 32_000,
        "voxelLengthMicrometres": 8_000,
    }
    assert config.config_sha256 == config.config_sha256
    with pytest.raises(ValueError):
        TsdfConfig(voxel_length_micrometres=100)
    with pytest.raises(ValueError):
        TsdfConfig(voxel_length_micrometres=True)


def test_privacy_and_training_literals_are_enforced_at_runtime(tmp_path: Path) -> None:
    frame = _frame(tmp_path)
    intrinsics = PinholeIntrinsics(2, 2, 100, 100, 1, 1, "b" * 64)
    with pytest.raises(ReconstructionError, match="PRIVACY_REVIEW_REQUIRED"):
        KnownPoseRgbdInput(
            frames=(frame,),
            intrinsics=intrinsics,
            source_manifest_sha256="c" * 64,
            privacy_status="review-required",  # type: ignore[arg-type]
        )
    with pytest.raises(ReconstructionError, match="TRAINING_USE_FORBIDDEN"):
        KnownPoseRgbdInput(
            frames=(frame,),
            intrinsics=intrinsics,
            source_manifest_sha256="c" * 64,
            training_use_consent="allowed",  # type: ignore[arg-type]
        )
