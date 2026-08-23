from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import cast

SHA256 = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = REPOSITORY_ROOT / "ml/reconstruction/windows-nvidia-v2"
EVIDENCE_PATH = (
    REPOSITORY_ROOT / "docs/evaluation/reconstruction/c8-v2-blackwell-evidence-2026-08-19.json"
)
INFERENCE_SOURCE = REPOSITORY_ROOT / "services/inference-worker/src"
sys.path.insert(0, str(INFERENCE_SOURCE))

from inference_worker.reconstruction.blackwell_v2.evidence import (  # noqa: E402
    AlgorithmComponent,
    AlgorithmVerdict,
    FieldVerdict,
    RepeatabilityVerdict,
    RuntimeVerdict,
    WorkstationEvidence,
)


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast("dict[str, object]", value)


def _sha256(value: object) -> str:
    assert isinstance(value, str)
    assert SHA256.fullmatch(value)
    return value.removeprefix("sha256:")


def test_blackwell_package_manifest_covers_and_hashes_every_package_input() -> None:
    manifest = _mapping(
        json.loads((PACKAGE_ROOT / "package-manifest.json").read_text(encoding="utf-8"))
    )
    files = _mapping(manifest["files"])
    expected_names = {
        path.name
        for path in PACKAGE_ROOT.iterdir()
        if path.is_file() and path.name != "package-manifest.json"
    }
    assert set(files) == expected_names
    for name, expected_sha256 in files.items():
        assert isinstance(expected_sha256, str)
        actual_sha256 = hashlib.sha256((PACKAGE_ROOT / name).read_bytes()).hexdigest()
        assert actual_sha256 == expected_sha256


def test_counted_blackwell_evidence_round_trips_through_v3_contract() -> None:
    document = _mapping(json.loads(EVIDENCE_PATH.read_text(encoding="utf-8")))
    evidence = WorkstationEvidence.from_json(document)

    assert evidence.to_json() == document
    assert evidence.schema_version == "c8-blackwell-evidence-v3"
    assert evidence.record_kind == "c8-blackwell-workstation-envelope-v3"
    assert evidence.source_commit == "ebf6cb173b73cc75e7b983f90a9d867a4f13f5e0"
    assert evidence.exposure_status == "acceptance-only"
    assert evidence.production_routing_enabled is False
    assert evidence.runtime_verdict is RuntimeVerdict.PASSED
    assert evidence.repeatability_verdict is RepeatabilityVerdict.PASSED
    assert evidence.physical_capture_verdict is FieldVerdict.DEFERRED_NOT_RUN
    assert evidence.representative_accuracy_verdict is FieldVerdict.DEFERRED_NOT_RUN

    assert dict(evidence.algorithm_verdicts) == {
        AlgorithmComponent.COLMAP_SPARSE: AlgorithmVerdict.PASSED,
        AlgorithmComponent.COLMAP_DENSE: AlgorithmVerdict.PASSED,
        AlgorithmComponent.OPEN3D_TSDF: AlgorithmVerdict.PASSED,
        AlgorithmComponent.DIRECT_GSPLAT: AlgorithmVerdict.PASSED,
    }
    assert len(evidence.runs) == 6
    assert len({run.run_id for run in evidence.runs}) == 6
    assert all(run.runtime.verdict is RuntimeVerdict.PASSED for run in evidence.runs)
    assert all(run.runtime.compute_capability == "12.0" for run in evidence.runs)
    assert all(
        run.runtime.native_probe_compiled_architecture == "sm_120"
        for run in evidence.runs
    )
    assert all(run.outputs and run.inputs and run.dependency_locks for run in evidence.runs)
    assert all(not run.failures for run in evidence.runs)


def test_counted_payloads_and_runtime_paths_support_honest_verdicts() -> None:
    evidence = WorkstationEvidence.from_json(
        json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
    )
    by_id = {run.run_id: run for run in evidence.runs}

    colmap_runs = [
        by_id["colmap-4.1.1-selected-r1"],
        by_id["colmap-4.1.1-selected-r2"],
    ]
    for run in colmap_runs:
        algorithms = {item.component: item for item in run.algorithms}
        sparse = dict(algorithms[AlgorithmComponent.COLMAP_SPARSE].metrics)
        dense = dict(algorithms[AlgorithmComponent.COLMAP_DENSE].metrics)
        assert sparse["registeredImages"] == 10
        assert sparse["sparsePoints"] == 3362
        assert sparse["sparseBackend"] == "cpu-deterministic"
        assert dense["depthMaps"] == dense["normalMaps"] == 20
        assert isinstance(dense["fusedPoints"], int) and dense["fusedPoints"] > 46_000
        assert dense["payloadValidated"] is True
        assert dense["plyFormat"] == "binary_little_endian"
        fused = next(item for item in run.outputs if item.identifier == "output/fused.ply")
        assert fused.byte_size > 1_200_000
        _sha256(fused.sha256)
        assert "compute_90 PTX" in run.runtime.component_code_path
        assert "CUDA PatchMatchStereo" in run.runtime.component_workload

    open3d_runs = [by_id["open3d-0.19.0-r1"], by_id["open3d-0.19.0-r2"]]
    for run in open3d_runs:
        metrics = dict(run.algorithms[0].metrics)
        assert metrics["backend"] == "legacy-cpu"
        assert metrics["cudaTensorBackend"] == "CUDA"
        assert metrics["vertices"] == 2160
        assert metrics["triangles"] == 4134
        assert metrics["cudaTensorChecksum"] == 8_386_560.0
        assert "separately" in run.runtime.component_workload
        assert "TSDF is legacy-cpu" in run.runtime.component_code_path

    appearance_runs = [
        by_id["direct-gsplat-1.5.3-r1"],
        by_id["direct-gsplat-1.5.3-r2"],
    ]
    for run in appearance_runs:
        metrics = dict(run.algorithms[0].metrics)
        assert metrics["optimizerSteps"] == 24
        assert metrics["exportVertices"] == 6
        assert metrics["exportPayloadValidated"] is True
        assert metrics["exportFormat"] == "ascii"
        assert "20 native sm_120 cubins" in run.runtime.component_code_path


def test_provenance_comparison_cleanup_and_deferrals_are_explicit() -> None:
    document = _mapping(json.loads(EVIDENCE_PATH.read_text(encoding="utf-8")))
    accepted = _mapping(document["acceptedStack"])
    colmap = _mapping(accepted["colmap"])
    assert colmap["version"] == "4.1.1"
    assert colmap["commit"] == "a0d785fba74b2664f31edc4a29026a8b27c00f67"
    _sha256(colmap["sourceArchiveSha256"])
    assert accepted["pytorch"] == "2.13.0+cu132"
    assert accepted["open3d"] == "0.19.0"
    assert accepted["gsplat"] == "1.5.3"

    package = _mapping(document["package"])
    assert _mapping(package["v1Package"]) == {
        "executionVerdict": "not-run",
        "unchangedFromBase": True,
    }
    assert package["aptRepositorySnapshotPinned"] is False
    acceptance_result = _mapping(package["acceptanceResult"])
    _sha256(acceptance_result["sha256"])
    assert isinstance(acceptance_result["byteSize"], int)
    assert acceptance_result["byteSize"] > 0
    for commands in _mapping(package["commandEvidence"]).values():
        assert isinstance(commands, list) and commands
        for command in commands:
            item = _mapping(command)
            assert item["exitCode"] == 0
            _sha256(item["argvSha256"])
            _sha256(item["logSha256"])

    attempts = document["diagnosticAttempts"]
    assert isinstance(attempts, list) and len(attempts) == 2
    comparison = _mapping(attempts[0])
    assert comparison["candidate"] == "COLMAP 3.13.0"
    assert comparison["outcome"] == "partial"
    assert _mapping(_mapping(comparison["dense"])["ply"])["vertexCount"] == 0

    fixtures = _mapping(document["fixtures"])
    colmap_fixture = _mapping(fixtures["colmap"])
    assert colmap_fixture["generatorRetained"] is True
    assert colmap_fixture["cameraCount"] == 10
    _sha256(colmap_fixture["generatorSha256"])

    cleanup = _mapping(document["cleanup"])
    assert cleanup["complete"] is True
    assert cleanup["temporaryInputDirectoriesRemaining"] == 0
    assert cleanup["c8ContainersRemaining"] == 0
    assert cleanup["taggedC8ImagesRemaining"] == 0
    assert cleanup["globalDockerPruneUsed"] is False
    assert cleanup["additionalWorktreesCreated"] == 0

    limitations = document["deferredLimitations"]
    assert isinstance(limitations, list)
    joined = "\n".join(cast("list[str]", limitations))
    assert "physical iOS" in joined
    assert "representative-home" in joined
    assert "No phone, customer or provider data" in joined
    assert "acceptance-only" in joined
