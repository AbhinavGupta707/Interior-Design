from dataclasses import replace
from pathlib import Path

import pytest
from inference_worker.reconstruction.blackwell_v2.colmap_commands import (
    ColmapV2Config,
    dense_commands,
    flattened_option_names,
    sparse_commands,
)
from inference_worker.reconstruction.blackwell_v2.container_invocation import (
    ContainerInvocation,
)
from inference_worker.reconstruction.blackwell_v2.evidence import (
    AlgorithmComponent,
    AlgorithmEvidence,
    AlgorithmVerdict,
    FieldVerdict,
    HashedObject,
    RepeatabilityVerdict,
    ResourcePeaks,
    RunEvidence,
    RuntimeEvidence,
    RuntimeVerdict,
)

SHA = "a" * 64


def _algorithms() -> tuple[AlgorithmEvidence, ...]:
    return (
        AlgorithmEvidence(
            AlgorithmComponent.COLMAP_SPARSE,
            AlgorithmVerdict.PASSED,
            (("registeredImages", 8), ("sparsePoints", 3994)),
        ),
        AlgorithmEvidence(
            AlgorithmComponent.COLMAP_DENSE,
            AlgorithmVerdict.PARTIAL,
            (("depthMaps", 16), ("fusedPoints", 0)),
            ("ZERO_FUSED_POINTS",),
        ),
        AlgorithmEvidence(
            AlgorithmComponent.OPEN3D_TSDF,
            AlgorithmVerdict.PASSED,
            (("vertices", 2160), ("triangles", 4134)),
        ),
        AlgorithmEvidence(
            AlgorithmComponent.DIRECT_GSPLAT,
            AlgorithmVerdict.PASSED,
            (("optimizerSteps", 3), ("heldOutPsnrDb", 17.25)),
        ),
    )


def _evidence() -> RunEvidence:
    return RunEvidence(
        run_id="c8-v2-test",
        source_commit="b" * 40,
        image_digest=f"sha256:{SHA}",
        dependency_lock_sha256=SHA,
        config_sha256=SHA,
        rights_basis="creator-owned-synthetic",
        service_processing_allowed=True,
        training_allowed=False,
        inputs=(HashedObject("frame-00", SHA, 123),),
        outputs=(HashedObject("appearance.ply", SHA, 456),),
        runtime=RuntimeEvidence(
            RuntimeVerdict.PASSED,
            "NVIDIA GeForce RTX 5080",
            "595.79",
            "12.0",
            "sm_120",
            "rasterize-backward-update",
        ),
        algorithms=_algorithms(),
        repeatability_verdict=RepeatabilityVerdict.PASSED,
        repeatability_basis="two fresh runs within an explicit metric tolerance",
        physical_capture_verdict=FieldVerdict.DEFERRED_NOT_RUN,
        representative_accuracy_verdict=FieldVerdict.DEFERRED_NOT_RUN,
        resources=ResourcePeaks(1000, 1024, 2048),
        warnings=("CERES_CUDA_BA_UNAVAILABLE",),
        failures=("COLMAP_DENSE_ZERO_FUSED_POINTS",),
        cleanup_complete=True,
    )


def test_evidence_keeps_verdicts_separate_and_hashes_canonical_json() -> None:
    evidence = _evidence()
    document = evidence.to_json()

    runtime = document["runtimeVerdict"]
    assert isinstance(runtime, dict)
    assert runtime["verdict"] == "passed"
    assert document["repeatabilityVerdict"] == "passed"
    assert document["physicalCaptureVerdict"] == "deferred-not-run"
    assert document["representativeAccuracyVerdict"] == "deferred-not-run"
    assert "verdict" not in document
    assert len(evidence.evidence_sha256) == 64


def test_synthetic_evidence_cannot_pass_a_field_gate() -> None:
    with pytest.raises(ValueError, match="synthetic evidence cannot pass physical"):
        replace(_evidence(), physical_capture_verdict=FieldVerdict.PASSED)


def test_dense_zero_fusion_cannot_be_reported_as_passed() -> None:
    with pytest.raises(ValueError, match="requires fused points"):
        AlgorithmEvidence(
            AlgorithmComponent.COLMAP_DENSE,
            AlgorithmVerdict.PASSED,
            (("depthMaps", 16), ("fusedPoints", 0)),
        )


def test_runtime_pass_requires_real_sm120_work() -> None:
    with pytest.raises(ValueError, match="real sm_120 work"):
        RuntimeEvidence(
            RuntimeVerdict.PASSED,
            "RTX 5080",
            "595.79",
            "12.0",
            "sm_120",
            "version-only",
        )


def test_colmap_313_commands_use_verified_option_namespace() -> None:
    commands = sparse_commands(ColmapV2Config())
    options = flattened_option_names(commands)

    assert "--FeatureMatching.max_num_matches" in options
    assert "--FeatureMatching.guided_matching" in options
    assert all(not option.startswith("--SiftMatching.") for option in options)
    assert "--FeatureExtraction.use_gpu" in options
    assert "--SiftExtraction.max_image_size" in options
    assert "--SiftExtraction.max_num_features" in options


def test_dense_command_is_explicit_cuda_patch_match_then_fusion() -> None:
    commands = dense_commands(ColmapV2Config())

    assert tuple(command[0] for command in commands) == (
        "image_undistorter",
        "patch_match_stereo",
        "stereo_fusion",
    )
    assert "--PatchMatchStereo.gpu_index" in commands[1]


def test_container_invocation_is_digest_pinned_and_hardened(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    output_root = tmp_path / "output"
    input_root.mkdir()
    output_root.mkdir()
    invocation = ContainerInvocation(
        image_digest=f"sha256:{SHA}",
        input_root=input_root,
        output_root=output_root,
    )

    argv = invocation.argv()
    assert "--network" in argv and "none" in argv
    assert "--read-only" in argv
    assert "--cap-drop" in argv and "ALL" in argv
    assert "--gpus" in argv and "device=0" in argv
    assert argv[-1] == f"sha256:{SHA}"
    assert "/c8/work:rw,noexec,nosuid,nodev,size=12g" in argv


def test_container_invocation_rejects_unsafe_output_roots(tmp_path: Path) -> None:
    input_root = tmp_path / "input"
    output_root = tmp_path / "output"
    input_root.mkdir()
    output_root.mkdir()
    (output_root / "existing.txt").write_text("occupied")
    with pytest.raises(ValueError, match="output root must be empty"):
        ContainerInvocation(f"sha256:{SHA}", input_root, output_root)

    nested_output = input_root / "nested-output"
    nested_output.mkdir()
    with pytest.raises(ValueError, match="must be independent"):
        ContainerInvocation(f"sha256:{SHA}", input_root, nested_output)


def test_container_invocation_rejects_tags(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="exact sha256"):
        ContainerInvocation(
            image_digest="c8-v2:latest",
            input_root=tmp_path,
            output_root=tmp_path,
        )
