from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import cast

SHA256 = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = REPOSITORY_ROOT / "ml/reconstruction/windows-nvidia-v2"
EVIDENCE_PATH = (
    REPOSITORY_ROOT / "docs/evaluation/reconstruction/c8-v2-blackwell-evidence-2026-08-19.json"
)


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _number(value: object) -> int | float:
    assert isinstance(value, (int, float)) and not isinstance(value, bool)
    return value


def _sha256(value: object) -> str:
    assert isinstance(value, str)
    assert SHA256.fullmatch(value)
    return value


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


def test_counted_blackwell_evidence_preserves_separate_verdicts_and_hashes() -> None:
    document = _mapping(json.loads(EVIDENCE_PATH.read_text(encoding="utf-8")))

    assert document["schemaVersion"] == "c8-blackwell-evidence-v2"
    assert document["recordKind"] == "c8-blackwell-workstation-envelope-v2"
    assert document["sourceCommit"] == "e7ecb026afdc43c7bc33691687737f91dd287f02"

    package = _mapping(document["package"])
    _sha256(package["manifestSha256"])
    _sha256(package["appearanceLockSha256"])
    _sha256(package["open3dLockSha256"])
    assert _mapping(package["v1Package"]) == {
        "executionVerdict": "not-run",
        "unchangedFromBase": True,
    }

    rights = _mapping(document["rights"])
    assert rights["basis"] == "creator-owned-synthetic"
    assert rights["serviceProcessingAllowed"] is True
    assert rights["trainingAllowed"] is False
    assert rights["customerDataUsed"] is False
    assert rights["providerDataUsed"] is False

    compatibility = _mapping(document["compatibilitySpike"])
    cuda130 = _mapping(compatibility["cuda130"])
    cuda132 = _mapping(compatibility["cuda132"])
    assert (
        cuda130["compiledArchitecture"]
        == cuda132["compiledArchitecture"]
        == "sm_120"
    )
    assert cuda130["kernelPayload"] == 120
    assert cuda132["kernelPayload"] == 132

    verdicts = _mapping(document["verdicts"])
    assert verdicts["runtimeVerdict"] == "passed"
    assert verdicts["repeatabilityVerdict"] == "passed"
    assert verdicts["physicalCaptureVerdict"] == "deferred-not-run"
    assert verdicts["representativeAccuracyVerdict"] == "deferred-not-run"
    assert _mapping(verdicts["algorithmVerdict"]) == {
        "colmapSparse": "passed",
        "colmapDense": "partial",
        "open3dTsdf": "passed",
        "directGsplatSynthetic": "passed",
    }

    components = _mapping(document["components"])
    assert set(components) == {"colmap", "open3d", "directGsplat"}
    for component in components.values():
        component_record = _mapping(component)
        _sha256(component_record["imageDigest"])
        assert _number(component_record["imageSizeBytes"]) > 0
        assert component_record["runtimeVerdict"] == "passed"
        sm120 = _mapping(component_record["sm120Probe"])
        assert sm120 == {
            "compiledArchitecture": "sm_120",
            "computeCapability": "12.0",
            "kernelResult": 120,
        }

    colmap = _mapping(components["colmap"])
    sparse_run_1 = _mapping(colmap["sparseRun1"])
    sparse_run_2 = _mapping(colmap["sparseRun2"])
    assert sparse_run_1["registeredImages"] == sparse_run_2["registeredImages"] == 8
    assert _number(sparse_run_1["sparsePoints"]) > 0
    assert _number(sparse_run_2["sparsePoints"]) > 0
    dense = _mapping(colmap["dense"])
    assert dense["algorithmVerdict"] == "partial"
    assert dense["safeCode"] == "COLMAP_DENSE_ZERO_FUSED_POINTS"
    assert dense["depthMapCount"] == dense["normalMapCount"] == 16
    assert dense["geometricFusedPoints"] == dense["photometricFusedPoints"] == 0
    _sha256(dense["mapSetSha256"])
    assert _mapping(colmap["repeatability"])["verdict"] == "passed"

    open3d = _mapping(components["open3d"])
    open3d_run_1 = _mapping(open3d["run1"])
    open3d_run_2 = _mapping(open3d["run2"])
    for metric in ("cudaChecksum", "pointCount", "vertexCount", "triangleCount"):
        assert open3d_run_1[metric] == open3d_run_2[metric]
    assert _mapping(open3d["repeatability"])["verdict"] == "passed"

    direct_gsplat = _mapping(components["directGsplat"])
    assert direct_gsplat["capabilityStatus"] == "experimental"
    gsplat_run_1 = _mapping(direct_gsplat["run1"])
    gsplat_run_2 = _mapping(direct_gsplat["run2"])
    assert gsplat_run_1["optimizerSteps"] == gsplat_run_2["optimizerSteps"] == 24
    repeatability = _mapping(direct_gsplat["repeatability"])
    assert _number(repeatability["observedHeldOutPsnrDeltaDb"]) <= _number(
        repeatability["heldOutPsnrAbsoluteToleranceDb"]
    )
    assert repeatability["verdict"] == "passed"
    for run in (gsplat_run_1, gsplat_run_2):
        for output in _mapping(run["outputs"]).values():
            _sha256(_mapping(output)["sha256"])

    fixtures = _mapping(document["fixtures"])
    colmap_fixture = _mapping(fixtures["colmap"])
    _sha256(colmap_fixture["canonicalImageSetSha256"])
    assert colmap_fixture["generatorRetained"] is False
    appearance_fixture = _mapping(fixtures["appearance"])
    _sha256(appearance_fixture["manifestSha256"])
    _sha256(appearance_fixture["generatorSha256"])

    cleanup = _mapping(document["cleanup"])
    assert cleanup["complete"] is True
    assert cleanup["temporaryInputDirectoriesRemaining"] == 0
    assert cleanup["c8ContainersRemaining"] == 0
    assert cleanup["taggedC8ImagesRemaining"] == 0
    assert cleanup["additionalWorktreesCreated"] == 0
