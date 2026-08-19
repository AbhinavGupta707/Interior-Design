"""Strict, non-aggregate evidence model for C8 v2 workstation acceptance."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from ..common.hashing import JsonObject, sha256_json

EVIDENCE_SCHEMA_VERSION = "c8-blackwell-evidence-v2"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SAFE_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")


class RuntimeVerdict(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    NOT_RUN = "not-run"


class AlgorithmVerdict(StrEnum):
    PASSED = "passed"
    PARTIAL = "partial"
    FAILED = "failed"
    ABSTAINED = "abstained"
    NOT_RUN = "not-run"


class RepeatabilityVerdict(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    NOT_RUN = "not-run"


class FieldVerdict(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    DEFERRED_NOT_RUN = "deferred-not-run"


class AlgorithmComponent(StrEnum):
    COLMAP_SPARSE = "colmap-sparse"
    COLMAP_DENSE = "colmap-dense"
    OPEN3D_TSDF = "open3d-tsdf"
    DIRECT_GSPLAT = "direct-gsplat"


def _validate_sha256(value: str, name: str) -> None:
    if SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{name} must be a lowercase SHA-256")


@dataclass(frozen=True, slots=True)
class HashedObject:
    identifier: str
    sha256: str
    byte_size: int

    def __post_init__(self) -> None:
        if not self.identifier or len(self.identifier) > 160:
            raise ValueError("hashed object identifier is invalid")
        _validate_sha256(self.sha256, "hashed object")
        if self.byte_size < 0:
            raise ValueError("hashed object byte size is invalid")

    def to_json(self) -> JsonObject:
        return {
            "byteSize": self.byte_size,
            "identifier": self.identifier,
            "sha256": self.sha256,
        }


@dataclass(frozen=True, slots=True)
class ResourcePeaks:
    elapsed_milliseconds: int
    peak_gpu_memory_bytes: int
    peak_host_memory_bytes: int

    def __post_init__(self) -> None:
        if (
            self.elapsed_milliseconds <= 0
            or self.peak_gpu_memory_bytes < 0
            or self.peak_host_memory_bytes < 0
        ):
            raise ValueError("resource peaks are invalid")

    def to_json(self) -> JsonObject:
        return {
            "elapsedMilliseconds": self.elapsed_milliseconds,
            "peakGpuMemoryBytes": self.peak_gpu_memory_bytes,
            "peakHostMemoryBytes": self.peak_host_memory_bytes,
        }


@dataclass(frozen=True, slots=True)
class RuntimeEvidence:
    verdict: RuntimeVerdict
    device_name: str
    driver_version: str
    compute_capability: str
    compiled_architecture: str
    workload: str

    def __post_init__(self) -> None:
        values = (
            self.device_name,
            self.driver_version,
            self.compute_capability,
            self.compiled_architecture,
            self.workload,
        )
        if not all(value and len(value) <= 200 for value in values):
            raise ValueError("runtime evidence fields are invalid")
        if self.verdict is RuntimeVerdict.PASSED and (
            self.compute_capability != "12.0"
            or self.compiled_architecture != "sm_120"
            or self.workload == "version-only"
        ):
            raise ValueError("a runtime pass requires real sm_120 work")

    def to_json(self) -> JsonObject:
        return {
            "compiledArchitecture": self.compiled_architecture,
            "computeCapability": self.compute_capability,
            "deviceName": self.device_name,
            "driverVersion": self.driver_version,
            "verdict": self.verdict.value,
            "workload": self.workload,
        }


@dataclass(frozen=True, slots=True)
class AlgorithmEvidence:
    component: AlgorithmComponent
    verdict: AlgorithmVerdict
    metrics: tuple[tuple[str, int | float | str], ...]
    safe_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if len({name for name, _value in self.metrics}) != len(self.metrics):
            raise ValueError("algorithm metric names must be unique")
        if any(not name or len(name) > 100 for name, _value in self.metrics):
            raise ValueError("algorithm metric name is invalid")
        if any(SAFE_CODE_PATTERN.fullmatch(code) is None for code in self.safe_codes):
            raise ValueError("algorithm safe code is invalid")
        metric_names = {name for name, _value in self.metrics}
        if (
            self.component is AlgorithmComponent.COLMAP_SPARSE
            and self.verdict is AlgorithmVerdict.PASSED
            and not {"registeredImages", "sparsePoints"}.issubset(metric_names)
        ):
            raise ValueError("COLMAP sparse pass lacks required metrics")
        if (
            self.component is AlgorithmComponent.COLMAP_DENSE
            and self.verdict is AlgorithmVerdict.PASSED
        ):
            if not {"depthMaps", "fusedPoints"}.issubset(metric_names):
                raise ValueError("COLMAP dense pass lacks required metrics")
            fused = dict(self.metrics)["fusedPoints"]
            if not isinstance(fused, (int, float)) or fused <= 0:
                raise ValueError("COLMAP dense pass requires fused points")
        if (
            self.component is AlgorithmComponent.DIRECT_GSPLAT
            and self.verdict is AlgorithmVerdict.PASSED
            and not {"optimizerSteps", "heldOutPsnrDb"}.issubset(metric_names)
        ):
            raise ValueError("direct gsplat pass lacks required metrics")

    def to_json(self) -> JsonObject:
        return {
            "component": self.component.value,
            "metrics": {name: value for name, value in self.metrics},
            "safeCodes": list(self.safe_codes),
            "verdict": self.verdict.value,
        }


@dataclass(frozen=True, slots=True)
class RunEvidence:
    run_id: str
    source_commit: str
    image_digest: str
    dependency_lock_sha256: str
    config_sha256: str
    rights_basis: Literal["creator-owned-synthetic", "user-authorised"]
    service_processing_allowed: bool
    training_allowed: bool
    inputs: tuple[HashedObject, ...]
    outputs: tuple[HashedObject, ...]
    runtime: RuntimeEvidence
    algorithms: tuple[AlgorithmEvidence, ...]
    repeatability_verdict: RepeatabilityVerdict
    repeatability_basis: str
    physical_capture_verdict: FieldVerdict
    representative_accuracy_verdict: FieldVerdict
    resources: ResourcePeaks
    warnings: tuple[str, ...]
    failures: tuple[str, ...]
    cleanup_complete: bool
    schema_version: Literal["c8-blackwell-evidence-v2"] = "c8-blackwell-evidence-v2"

    def __post_init__(self) -> None:
        if self.schema_version != EVIDENCE_SCHEMA_VERSION:
            raise ValueError("evidence schema version is invalid")
        if not self.run_id or len(self.run_id) > 160:
            raise ValueError("run identifier is invalid")
        if re.fullmatch(r"^[0-9a-f]{40}$", self.source_commit) is None:
            raise ValueError("source commit is invalid")
        for value, name in (
            (self.image_digest.removeprefix("sha256:"), "image digest"),
            (self.dependency_lock_sha256, "dependency lock"),
            (self.config_sha256, "config"),
        ):
            _validate_sha256(value, name)
        if not self.service_processing_allowed or self.training_allowed:
            raise ValueError("acceptance requires processing approval and denied training use")
        components = {item.component for item in self.algorithms}
        if components != set(AlgorithmComponent) or len(components) != len(self.algorithms):
            raise ValueError("evidence must report every algorithm component exactly once")
        if not self.repeatability_basis or len(self.repeatability_basis) > 500:
            raise ValueError("repeatability basis is invalid")
        if (
            self.physical_capture_verdict is FieldVerdict.PASSED
            and self.rights_basis == "creator-owned-synthetic"
        ):
            raise ValueError("synthetic evidence cannot pass physical capture")
        if (
            self.representative_accuracy_verdict is FieldVerdict.PASSED
            and self.rights_basis == "creator-owned-synthetic"
        ):
            raise ValueError("synthetic evidence cannot pass representative accuracy")

    def to_json(self) -> JsonObject:
        return {
            "algorithmVerdicts": [item.to_json() for item in self.algorithms],
            "cleanupComplete": self.cleanup_complete,
            "configSha256": self.config_sha256,
            "dependencyLockSha256": self.dependency_lock_sha256,
            "failures": list(self.failures),
            "imageDigest": self.image_digest,
            "inputs": [item.to_json() for item in self.inputs],
            "outputs": [item.to_json() for item in self.outputs],
            "physicalCaptureVerdict": self.physical_capture_verdict.value,
            "repeatabilityBasis": self.repeatability_basis,
            "repeatabilityVerdict": self.repeatability_verdict.value,
            "representativeAccuracyVerdict": self.representative_accuracy_verdict.value,
            "resources": self.resources.to_json(),
            "rights": {
                "basis": self.rights_basis,
                "serviceProcessingAllowed": self.service_processing_allowed,
                "trainingAllowed": self.training_allowed,
            },
            "runId": self.run_id,
            "runtimeVerdict": self.runtime.to_json(),
            "schemaVersion": self.schema_version,
            "sourceCommit": self.source_commit,
            "warnings": list(self.warnings),
        }

    @property
    def evidence_sha256(self) -> str:
        return sha256_json(self.to_json())
