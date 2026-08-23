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
    RepeatabilityEvidence,
    RepeatabilityVerdict,
    ResourcePeaks,
    RightsEvidence,
    RunEvidence,
    RuntimeEvidence,
    RuntimeVerdict,
    WorkstationEvidence,
)
from inference_worker.reconstruction.blackwell_v2.exposure import (
    CAPABILITY_STATUS,
    PRODUCTION_ROUTING_ENABLED,
    require_production_routing,
)

SHA = "a" * 64
COMMIT = "b" * 40


def _rights() -> RightsEvidence:
    return RightsEvidence(
        basis="creator-owned-synthetic",
        service_processing_allowed=True,
        training_allowed=False,
        customer_data_used=False,
        provider_data_used=False,
    )


def _runtime(code_path: str = "native-sm_120") -> RuntimeEvidence:
    return RuntimeEvidence(
        RuntimeVerdict.PASSED,
        "NVIDIA GeForce RTX 5080",
        "595.79",
        "12.0",
        "sm_120",
        "integer-kernel-result-120",
        "non-trivial-component-work",
        code_path,
    )


def _algorithm(component: AlgorithmComponent) -> AlgorithmEvidence:
    if component is AlgorithmComponent.COLMAP_SPARSE:
        metrics = (("registeredImages", 10), ("sparsePoints", 3394))
    elif component is AlgorithmComponent.COLMAP_DENSE:
        metrics = (
            ("depthMaps", 20),
            ("fusedPoints", 46862),
            ("payloadValidated", True),
        )
    elif component is AlgorithmComponent.OPEN3D_TSDF:
        metrics = (("vertices", 2160), ("triangles", 4134), ("backend", "legacy-cpu"))
    else:
        metrics = (("optimizerSteps", 24), ("heldOutPsnrDb", 35.25))
    return AlgorithmEvidence(component, AlgorithmVerdict.PASSED, metrics)


def _run(
    run_id: str,
    algorithms: tuple[AlgorithmEvidence, ...],
    code_path: str = "native-sm_120",
) -> RunEvidence:
    return RunEvidence(
        run_id=run_id,
        source_commit=COMMIT,
        image=HashedObject("component-image", SHA, 1234),
        dependency_locks=(HashedObject("dependency-lock", SHA, 456),),
        config_sha256=SHA,
        rights=_rights(),
        inputs=(HashedObject("fixture-manifest", SHA, 123),),
        outputs=(HashedObject("validated-output", SHA, 456),),
        runtime=_runtime(code_path),
        algorithms=algorithms,
        resources=ResourcePeaks(
            1000,
            1024,
            81,
            2048,
            "docker-stats and nvidia-smi sampled at 100ms",
        ),
        warnings=(),
        failures=(),
    )


def _evidence() -> WorkstationEvidence:
    colmap_algorithms = (
        _algorithm(AlgorithmComponent.COLMAP_SPARSE),
        _algorithm(AlgorithmComponent.COLMAP_DENSE),
    )
    runs = (
        _run("colmap-1", colmap_algorithms, "compute_90-ptx-jit-upstream-workaround"),
        _run("colmap-2", colmap_algorithms, "compute_90-ptx-jit-upstream-workaround"),
        _run("open3d-1", (_algorithm(AlgorithmComponent.OPEN3D_TSDF),)),
        _run("open3d-2", (_algorithm(AlgorithmComponent.OPEN3D_TSDF),)),
        _run("gsplat-1", (_algorithm(AlgorithmComponent.DIRECT_GSPLAT),)),
        _run("gsplat-2", (_algorithm(AlgorithmComponent.DIRECT_GSPLAT),)),
    )
    return WorkstationEvidence(
        recorded_at="2026-08-23",
        source_commit=COMMIT,
        authority={
            "appearance": "non-dimensional-appearance",
            "canonicalMutationAllowed": False,
            "geometry": "proposal-only",
        },
        package={"manifestSha256": SHA},
        host={"gpu": "NVIDIA GeForce RTX 5080"},
        accepted_stack={"colmap": "4.1.1"},
        compatibility_spike={"selected": "cuda132-colmap411"},
        rights=_rights(),
        fixtures={"colmap": {"generatorSha256": SHA}},
        runs=runs,
        repeatability=tuple(
            RepeatabilityEvidence(
                component,
                RepeatabilityVerdict.PASSED,
                "two fresh runs within the named tolerance",
                {"runCount": 2},
            )
            for component in AlgorithmComponent
        ),
        runtime_verdict=RuntimeVerdict.PASSED,
        algorithm_verdicts=tuple(
            (component, AlgorithmVerdict.PASSED) for component in AlgorithmComponent
        ),
        repeatability_verdict=RepeatabilityVerdict.PASSED,
        physical_capture_verdict=FieldVerdict.DEFERRED_NOT_RUN,
        representative_accuracy_verdict=FieldVerdict.DEFERRED_NOT_RUN,
        diagnostic_attempts=(),
        cleanup={"complete": True},
        deferred_limitations=("Physical iOS capture is deferred-not-run.",),
    )


def test_workstation_evidence_round_trips_exactly_and_hashes_canonical_json() -> None:
    evidence = _evidence()
    document = evidence.to_json()
    parsed = WorkstationEvidence.from_json(document)

    assert parsed.to_json() == document
    assert document["schemaVersion"] == "c8-blackwell-evidence-v3"
    assert document["exposure"] == {
        "productionRoutingEnabled": False,
        "status": "acceptance-only",
    }
    assert len(evidence.evidence_sha256) == 64


def test_component_run_reports_only_its_actual_algorithm_subset() -> None:
    run = _run("open3d-only", (_algorithm(AlgorithmComponent.OPEN3D_TSDF),))
    document = run.to_json()

    assert [item["component"] for item in document["algorithmVerdicts"]] == [
        "open3d-tsdf"
    ]
    assert RunEvidence.from_json(document).to_json() == document


def test_synthetic_evidence_cannot_pass_a_field_gate() -> None:
    with pytest.raises(ValueError, match="cannot pass physical"):
        replace(_evidence(), physical_capture_verdict=FieldVerdict.PASSED)


def test_dense_zero_fusion_or_unvalidated_payload_cannot_pass() -> None:
    with pytest.raises(ValueError, match="requires validated fused points"):
        AlgorithmEvidence(
            AlgorithmComponent.COLMAP_DENSE,
            AlgorithmVerdict.PASSED,
            (("depthMaps", 20), ("fusedPoints", 0), ("payloadValidated", True)),
        )
    with pytest.raises(ValueError, match="requires validated fused points"):
        AlgorithmEvidence(
            AlgorithmComponent.COLMAP_DENSE,
            AlgorithmVerdict.PASSED,
            (("depthMaps", 20), ("fusedPoints", 10), ("payloadValidated", False)),
        )


def test_runtime_pass_separates_native_probe_from_component_code_path() -> None:
    evidence = _runtime("compute_90-ptx-jit-upstream-workaround")

    assert evidence.native_probe_compiled_architecture == "sm_120"
    assert evidence.component_code_path == "compute_90-ptx-jit-upstream-workaround"
    with pytest.raises(ValueError, match="real native sm_120"):
        replace(evidence, native_probe_workload="version-only")


def test_colmap_411_commands_use_verified_option_namespace() -> None:
    sparse = sparse_commands(ColmapV2Config())
    dense = dense_commands(ColmapV2Config())
    options = flattened_option_names(sparse)

    assert "--FeatureMatching.max_num_matches" in options
    assert "--FeatureMatching.guided_matching" in options
    assert all(not option.startswith("--SiftMatching.") for option in options)
    assert "--FeatureExtraction.use_gpu" in options
    assert "--FeatureExtraction.max_image_size" in options
    assert "--SiftExtraction.max_num_features" in options
    assert "--SiftExtraction.max_image_size" not in options
    assert "--PatchMatchStereo.max_image_size" in dense[1]
    assert ColmapV2Config().to_json()["toolVersion"] == "4.1.1"


def test_dense_command_is_explicit_cuda_patch_match_then_fusion() -> None:
    commands = dense_commands(ColmapV2Config())

    assert tuple(command[0] for command in commands) == (
        "image_undistorter",
        "patch_match_stereo",
        "stereo_fusion",
    )
    assert "--PatchMatchStereo.gpu_index" in commands[1]


def test_c8_v2_is_fail_closed_acceptance_only() -> None:
    assert CAPABILITY_STATUS == "acceptance-only"
    assert PRODUCTION_ROUTING_ENABLED is False
    with pytest.raises(RuntimeError, match="C8_V2_ACCEPTANCE_ONLY"):
        require_production_routing()


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
