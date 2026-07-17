"""COLMAP fixed argv, CUDA eligibility, components and safe merge tests."""

from pathlib import Path
from typing import cast

import pytest
from inference_worker.reconstruction.colmap.commands import (
    DenseCapability,
    DenseConfig,
    SparseConfig,
    assess_dense_eligibility,
    build_dense_eligibility_manifest,
    dense_commands,
    merge_commands,
    sparse_commands,
)
from inference_worker.reconstruction.colmap.components import plan_model_merge
from inference_worker.reconstruction.colmap.parser import read_sparse_model
from inference_worker.reconstruction.common.errors import ReconstructionError

from .test_parser import write_text_model


def test_sparse_argv_is_fixed_cpu_only_and_contains_no_shell_or_request_values() -> None:
    commands = sparse_commands(SparseConfig(matcher="sequential", threads=2))
    flat = [argument for command in commands for argument in command]
    assert commands[0][0] == "feature_extractor"
    assert "--FeatureExtraction.use_gpu" in flat
    assert flat[flat.index("--FeatureExtraction.use_gpu") + 1] == "0"
    assert flat[flat.index("--FeatureMatching.use_gpu") + 1] == "0"
    assert not any("http" in argument or ";" in argument or "$(" in argument for argument in flat)
    with pytest.raises(ValueError):
        SparseConfig(matcher=cast("object", "sequential --evil"))  # type: ignore[arg-type]


def test_cuda_dense_requires_every_capability_and_one_sparse_component() -> None:
    ineligible = assess_dense_eligibility(DenseCapability(False, False, 0, False, 1, 2))
    assert ineligible.eligible is False
    assert set(ineligible.safe_codes) == {
        "COLMAP_NOT_INSTALLED",
        "CUDA_NOT_AVAILABLE",
        "NVIDIA_DEVICE_NOT_AVAILABLE",
        "COLMAP_CUDA_UNVERIFIED",
        "SPARSE_MODEL_INSUFFICIENT",
        "DISCONNECTED_COMPONENTS",
    }
    with pytest.raises(ReconstructionError, match="CUDA_DENSE_INELIGIBLE"):
        dense_commands(DenseConfig(), ineligible)

    eligible = assess_dense_eligibility(DenseCapability(True, True, 1, True, 20, 1))
    commands = dense_commands(DenseConfig(), eligible)
    assert eligible.eligible is True
    assert [command[0] for command in commands] == [
        "image_undistorter",
        "patch_match_stereo",
        "stereo_fusion",
        "poisson_mesher",
    ]


def test_cuda_dense_eligibility_manifest_is_hash_bound_and_never_execution_evidence() -> None:
    capability = DenseCapability(True, True, 1, True, 20, 1)
    config = DenseConfig(maximum_image_size=1_600)
    manifest = build_dense_eligibility_manifest(
        capability,
        config,
        source_manifest_sha256="a" * 64,
        tool_manifest_sha256="b" * 64,
    )

    payload = manifest.to_json()
    assert payload["eligible"] is True
    assert payload["executionStatus"] == "eligible-not-run"
    assert payload["requiresCuda"] is True
    assert payload["configSha256"] == config.config_sha256
    assert payload["manifestSha256"] == manifest.manifest_sha256
    assert manifest == build_dense_eligibility_manifest(
        capability,
        config,
        source_manifest_sha256="a" * 64,
        tool_manifest_sha256="b" * 64,
    )

    abstention = build_dense_eligibility_manifest(
        DenseCapability(False, False, 0, False, 1, 2),
        config,
        source_manifest_sha256="a" * 64,
        tool_manifest_sha256="b" * 64,
    )
    assert abstention.to_json()["executionStatus"] == "abstained-not-run"
    assert abstention.manifest_sha256 != manifest.manifest_sha256


def test_model_merge_is_refused_without_shared_registered_images(tmp_path: Path) -> None:
    write_text_model(tmp_path / "left")
    write_text_model(tmp_path / "right", first_name="frame-other.jpg")
    right_images = (tmp_path / "right/images.txt").read_text(encoding="utf-8")
    right_images = right_images.replace("frame-000001.jpg", "frame-other-2.jpg")
    (tmp_path / "right/images.txt").write_text(right_images, encoding="utf-8")
    left = read_sparse_model(tmp_path, "left")
    right = read_sparse_model(tmp_path, "right")

    with pytest.raises(ReconstructionError, match="MODEL_MERGE_NO_OVERLAP"):
        plan_model_merge(
            left,
            right,
            left_relative_model="left",
            right_relative_model="right",
            output_relative_model="merged",
        )


def test_overlap_proof_builds_merger_followed_by_global_bundle_adjustment(
    tmp_path: Path,
) -> None:
    write_text_model(tmp_path / "left")
    write_text_model(tmp_path / "right")
    left = read_sparse_model(tmp_path, "left")
    right = read_sparse_model(tmp_path, "right")
    plan = plan_model_merge(
        left,
        right,
        left_relative_model="left",
        right_relative_model="right",
        output_relative_model="merged",
    )
    commands = merge_commands(plan)
    assert len(plan.shared_image_keys) == 2
    assert commands[0][0] == "model_merger"
    assert commands[1][0] == "bundle_adjuster"

    with pytest.raises(ReconstructionError, match="UNSAFE_PATH"):
        plan_model_merge(
            left,
            right,
            left_relative_model="../left",
            right_relative_model="right",
            output_relative_model="merged",
        )
