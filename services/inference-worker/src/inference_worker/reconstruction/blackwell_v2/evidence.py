"""Typed, round-trippable evidence model for C8 v2 workstation acceptance."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Literal, cast

from ..common.hashing import JsonObject, sha256_json

EVIDENCE_SCHEMA_VERSION = "c8-blackwell-evidence-v3"
RUN_SCHEMA_VERSION = "c8-blackwell-run-v3"
EVIDENCE_RECORD_KIND = "c8-blackwell-workstation-envelope-v3"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SAFE_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")


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


def _object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object")
    result = cast("dict[str, object]", value)
    sha256_json(result)
    return result


def _array(value: object, name: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array")
    return cast("list[object]", value)


def _string(value: object, name: str, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"{name} must be a non-empty bounded string")
    return value


def _integer(value: object, name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} must be an integer of at least {minimum}")
    return value


def _exact_keys(value: dict[str, object], expected: set[str], name: str) -> None:
    if set(value) != expected:
        raise ValueError(f"{name} fields are invalid")


def _json_object(value: object, name: str) -> JsonObject:
    return cast("JsonObject", _object(value, name))


@dataclass(frozen=True, slots=True)
class HashedObject:
    identifier: str
    sha256: str
    byte_size: int

    def __post_init__(self) -> None:
        if not self.identifier or len(self.identifier) > 240:
            raise ValueError("hashed object identifier is invalid")
        _validate_sha256(self.sha256, "hashed object")
        if self.byte_size < 0:
            raise ValueError("hashed object byte size is invalid")

    @classmethod
    def from_json(cls, value: object) -> HashedObject:
        raw = _object(value, "hashed object")
        _exact_keys(raw, {"byteSize", "identifier", "sha256"}, "hashed object")
        return cls(
            _string(raw["identifier"], "hashed object identifier", 240),
            _string(raw["sha256"], "hashed object hash", 64),
            _integer(raw["byteSize"], "hashed object byte size"),
        )

    def to_json(self) -> JsonObject:
        return {
            "byteSize": self.byte_size,
            "identifier": self.identifier,
            "sha256": self.sha256,
        }


@dataclass(frozen=True, slots=True)
class RightsEvidence:
    basis: Literal["creator-owned-synthetic", "user-authorised"]
    service_processing_allowed: bool
    training_allowed: bool
    customer_data_used: bool
    provider_data_used: bool

    def __post_init__(self) -> None:
        if self.basis not in {"creator-owned-synthetic", "user-authorised"}:
            raise ValueError("rights basis is invalid")
        if not self.service_processing_allowed or self.training_allowed:
            raise ValueError("acceptance requires processing approval and denied training use")
        if self.basis == "creator-owned-synthetic" and (
            self.customer_data_used or self.provider_data_used
        ):
            raise ValueError("synthetic evidence cannot use customer or provider data")

    @classmethod
    def from_json(cls, value: object) -> RightsEvidence:
        raw = _object(value, "rights")
        _exact_keys(
            raw,
            {
                "basis",
                "customerDataUsed",
                "providerDataUsed",
                "serviceProcessingAllowed",
                "trainingAllowed",
            },
            "rights",
        )
        booleans = (
            raw["serviceProcessingAllowed"],
            raw["trainingAllowed"],
            raw["customerDataUsed"],
            raw["providerDataUsed"],
        )
        if not all(isinstance(item, bool) for item in booleans):
            raise ValueError("rights flags must be booleans")
        basis = _string(raw["basis"], "rights basis")
        if basis not in {"creator-owned-synthetic", "user-authorised"}:
            raise ValueError("rights basis is invalid")
        return cls(
            cast("Literal['creator-owned-synthetic', 'user-authorised']", basis),
            cast("bool", booleans[0]),
            cast("bool", booleans[1]),
            cast("bool", booleans[2]),
            cast("bool", booleans[3]),
        )

    def to_json(self) -> JsonObject:
        return {
            "basis": self.basis,
            "customerDataUsed": self.customer_data_used,
            "providerDataUsed": self.provider_data_used,
            "serviceProcessingAllowed": self.service_processing_allowed,
            "trainingAllowed": self.training_allowed,
        }


@dataclass(frozen=True, slots=True)
class ResourcePeaks:
    elapsed_milliseconds: int
    peak_gpu_memory_bytes: int
    peak_gpu_utilization_percent: int
    peak_host_memory_bytes: int
    measurement_basis: str

    def __post_init__(self) -> None:
        if (
            self.elapsed_milliseconds <= 0
            or self.peak_gpu_memory_bytes < 0
            or not 0 <= self.peak_gpu_utilization_percent <= 100
            or self.peak_host_memory_bytes < 0
        ):
            raise ValueError("resource peaks are invalid")
        _string(self.measurement_basis, "resource measurement basis")

    @classmethod
    def from_json(cls, value: object) -> ResourcePeaks:
        raw = _object(value, "resources")
        _exact_keys(
            raw,
            {
                "elapsedMilliseconds",
                "measurementBasis",
                "peakGpuMemoryBytes",
                "peakGpuUtilizationPercent",
                "peakHostMemoryBytes",
            },
            "resources",
        )
        return cls(
            _integer(raw["elapsedMilliseconds"], "elapsed milliseconds", minimum=1),
            _integer(raw["peakGpuMemoryBytes"], "peak GPU memory"),
            _integer(raw["peakGpuUtilizationPercent"], "peak GPU utilization"),
            _integer(raw["peakHostMemoryBytes"], "peak host memory"),
            _string(raw["measurementBasis"], "resource measurement basis"),
        )

    def to_json(self) -> JsonObject:
        return {
            "elapsedMilliseconds": self.elapsed_milliseconds,
            "measurementBasis": self.measurement_basis,
            "peakGpuMemoryBytes": self.peak_gpu_memory_bytes,
            "peakGpuUtilizationPercent": self.peak_gpu_utilization_percent,
            "peakHostMemoryBytes": self.peak_host_memory_bytes,
        }


@dataclass(frozen=True, slots=True)
class RuntimeEvidence:
    verdict: RuntimeVerdict
    device_name: str
    driver_version: str
    compute_capability: str
    native_probe_compiled_architecture: str
    native_probe_workload: str
    component_workload: str
    component_code_path: str

    def __post_init__(self) -> None:
        for value in (
            self.device_name,
            self.driver_version,
            self.compute_capability,
            self.native_probe_compiled_architecture,
            self.native_probe_workload,
            self.component_workload,
            self.component_code_path,
        ):
            _string(value, "runtime evidence field", 240)
        if self.verdict is RuntimeVerdict.PASSED and (
            self.compute_capability != "12.0"
            or self.native_probe_compiled_architecture != "sm_120"
            or "version-only" in {self.native_probe_workload, self.component_workload}
        ):
            raise ValueError("a runtime pass requires real native sm_120 and component work")

    @classmethod
    def from_json(cls, value: object) -> RuntimeEvidence:
        raw = _object(value, "runtime evidence")
        _exact_keys(
            raw,
            {
                "componentCodePath",
                "componentWorkload",
                "computeCapability",
                "deviceName",
                "driverVersion",
                "nativeProbeCompiledArchitecture",
                "nativeProbeWorkload",
                "verdict",
            },
            "runtime evidence",
        )
        return cls(
            RuntimeVerdict(_string(raw["verdict"], "runtime verdict")),
            _string(raw["deviceName"], "device name"),
            _string(raw["driverVersion"], "driver version"),
            _string(raw["computeCapability"], "compute capability"),
            _string(
                raw["nativeProbeCompiledArchitecture"],
                "native probe compiled architecture",
            ),
            _string(raw["nativeProbeWorkload"], "native probe workload"),
            _string(raw["componentWorkload"], "component workload"),
            _string(raw["componentCodePath"], "component code path"),
        )

    def to_json(self) -> JsonObject:
        return {
            "componentCodePath": self.component_code_path,
            "componentWorkload": self.component_workload,
            "computeCapability": self.compute_capability,
            "deviceName": self.device_name,
            "driverVersion": self.driver_version,
            "nativeProbeCompiledArchitecture": self.native_probe_compiled_architecture,
            "nativeProbeWorkload": self.native_probe_workload,
            "verdict": self.verdict.value,
        }


MetricValue = int | float | str | bool


@dataclass(frozen=True, slots=True)
class AlgorithmEvidence:
    component: AlgorithmComponent
    verdict: AlgorithmVerdict
    metrics: tuple[tuple[str, MetricValue], ...]
    safe_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if len({name for name, _value in self.metrics}) != len(self.metrics):
            raise ValueError("algorithm metric names must be unique")
        for name, value in self.metrics:
            if not name or len(name) > 100:
                raise ValueError("algorithm metric is invalid")
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("algorithm metric must be finite")
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
            if not {"depthMaps", "fusedPoints", "payloadValidated"}.issubset(metric_names):
                raise ValueError("COLMAP dense pass lacks required metrics")
            values = dict(self.metrics)
            if (
                not isinstance(values["fusedPoints"], (int, float))
                or values["fusedPoints"] <= 0
                or values["payloadValidated"] is not True
            ):
                raise ValueError("COLMAP dense pass requires validated fused points")
        if (
            self.component is AlgorithmComponent.OPEN3D_TSDF
            and self.verdict is AlgorithmVerdict.PASSED
            and not {"vertices", "triangles", "backend"}.issubset(metric_names)
        ):
            raise ValueError("Open3D TSDF pass lacks required metrics")
        if (
            self.component is AlgorithmComponent.DIRECT_GSPLAT
            and self.verdict is AlgorithmVerdict.PASSED
            and not {"optimizerSteps", "heldOutPsnrDb"}.issubset(metric_names)
        ):
            raise ValueError("direct gsplat pass lacks required metrics")

    @classmethod
    def from_json(cls, value: object) -> AlgorithmEvidence:
        raw = _object(value, "algorithm evidence")
        _exact_keys(raw, {"component", "metrics", "safeCodes", "verdict"}, "algorithm evidence")
        metrics = _object(raw["metrics"], "algorithm metrics")
        parsed_metrics: list[tuple[str, MetricValue]] = []
        for name, metric in metrics.items():
            if not isinstance(metric, (bool, int, float, str)):
                raise ValueError("algorithm metric value is invalid")
            parsed_metrics.append((name, metric))
        safe_codes = tuple(
            _string(item, "algorithm safe code", 80)
            for item in _array(raw["safeCodes"], "algorithm safe codes")
        )
        return cls(
            AlgorithmComponent(_string(raw["component"], "algorithm component")),
            AlgorithmVerdict(_string(raw["verdict"], "algorithm verdict")),
            tuple(parsed_metrics),
            safe_codes,
        )

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
    image: HashedObject
    dependency_locks: tuple[HashedObject, ...]
    config_sha256: str
    rights: RightsEvidence
    inputs: tuple[HashedObject, ...]
    outputs: tuple[HashedObject, ...]
    runtime: RuntimeEvidence
    algorithms: tuple[AlgorithmEvidence, ...]
    resources: ResourcePeaks
    warnings: tuple[str, ...]
    failures: tuple[str, ...]
    schema_version: Literal["c8-blackwell-run-v3"] = "c8-blackwell-run-v3"

    def __post_init__(self) -> None:
        if self.schema_version != RUN_SCHEMA_VERSION:
            raise ValueError("run schema version is invalid")
        _string(self.run_id, "run identifier", 160)
        if COMMIT_PATTERN.fullmatch(self.source_commit) is None:
            raise ValueError("source commit is invalid")
        _validate_sha256(self.config_sha256, "config")
        if not self.dependency_locks or not self.inputs or not self.outputs:
            raise ValueError("run evidence requires dependency, input, and output hashes")
        components = {item.component for item in self.algorithms}
        if not self.algorithms or len(components) != len(self.algorithms):
            raise ValueError("a run must report a non-empty unique algorithm subset")
        for message in (*self.warnings, *self.failures):
            _string(message, "run warning or failure", 500)

    @classmethod
    def from_json(cls, value: object) -> RunEvidence:
        raw = _object(value, "run evidence")
        _exact_keys(
            raw,
            {
                "algorithmVerdicts",
                "configSha256",
                "dependencyLocks",
                "failures",
                "image",
                "inputs",
                "outputs",
                "resources",
                "rights",
                "runId",
                "runtimeVerdict",
                "schemaVersion",
                "sourceCommit",
                "warnings",
            },
            "run evidence",
        )
        return cls(
            run_id=_string(raw["runId"], "run identifier", 160),
            source_commit=_string(raw["sourceCommit"], "source commit", 40),
            image=HashedObject.from_json(raw["image"]),
            dependency_locks=tuple(
                HashedObject.from_json(item)
                for item in _array(raw["dependencyLocks"], "dependency locks")
            ),
            config_sha256=_string(raw["configSha256"], "config hash", 64),
            rights=RightsEvidence.from_json(raw["rights"]),
            inputs=tuple(
                HashedObject.from_json(item) for item in _array(raw["inputs"], "inputs")
            ),
            outputs=tuple(
                HashedObject.from_json(item) for item in _array(raw["outputs"], "outputs")
            ),
            runtime=RuntimeEvidence.from_json(raw["runtimeVerdict"]),
            algorithms=tuple(
                AlgorithmEvidence.from_json(item)
                for item in _array(raw["algorithmVerdicts"], "algorithm verdicts")
            ),
            resources=ResourcePeaks.from_json(raw["resources"]),
            warnings=tuple(
                _string(item, "run warning", 500)
                for item in _array(raw["warnings"], "warnings")
            ),
            failures=tuple(
                _string(item, "run failure", 500)
                for item in _array(raw["failures"], "failures")
            ),
            schema_version=cast(
                "Literal['c8-blackwell-run-v3']",
                _string(raw["schemaVersion"], "run schema version"),
            ),
        )

    def to_json(self) -> JsonObject:
        return {
            "algorithmVerdicts": [item.to_json() for item in self.algorithms],
            "configSha256": self.config_sha256,
            "dependencyLocks": [item.to_json() for item in self.dependency_locks],
            "failures": list(self.failures),
            "image": self.image.to_json(),
            "inputs": [item.to_json() for item in self.inputs],
            "outputs": [item.to_json() for item in self.outputs],
            "resources": self.resources.to_json(),
            "rights": self.rights.to_json(),
            "runId": self.run_id,
            "runtimeVerdict": self.runtime.to_json(),
            "schemaVersion": self.schema_version,
            "sourceCommit": self.source_commit,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True, slots=True)
class RepeatabilityEvidence:
    component: AlgorithmComponent
    verdict: RepeatabilityVerdict
    basis: str
    details: JsonObject

    def __post_init__(self) -> None:
        _string(self.basis, "repeatability basis")
        sha256_json(self.details)

    @classmethod
    def from_json(cls, value: object) -> RepeatabilityEvidence:
        raw = _object(value, "repeatability evidence")
        _exact_keys(raw, {"basis", "component", "details", "verdict"}, "repeatability evidence")
        return cls(
            AlgorithmComponent(_string(raw["component"], "repeatability component")),
            RepeatabilityVerdict(_string(raw["verdict"], "repeatability verdict")),
            _string(raw["basis"], "repeatability basis"),
            _json_object(raw["details"], "repeatability details"),
        )

    def to_json(self) -> JsonObject:
        return {
            "basis": self.basis,
            "component": self.component.value,
            "details": self.details,
            "verdict": self.verdict.value,
        }


@dataclass(frozen=True, slots=True)
class WorkstationEvidence:
    recorded_at: str
    source_commit: str
    authority: JsonObject
    package: JsonObject
    host: JsonObject
    accepted_stack: JsonObject
    compatibility_spike: JsonObject
    rights: RightsEvidence
    fixtures: JsonObject
    runs: tuple[RunEvidence, ...]
    repeatability: tuple[RepeatabilityEvidence, ...]
    runtime_verdict: RuntimeVerdict
    algorithm_verdicts: tuple[tuple[AlgorithmComponent, AlgorithmVerdict], ...]
    repeatability_verdict: RepeatabilityVerdict
    physical_capture_verdict: FieldVerdict
    representative_accuracy_verdict: FieldVerdict
    diagnostic_attempts: tuple[JsonObject, ...]
    cleanup: JsonObject
    deferred_limitations: tuple[str, ...]
    exposure_status: Literal["acceptance-only"] = "acceptance-only"
    production_routing_enabled: Literal[False] = False
    schema_version: Literal["c8-blackwell-evidence-v3"] = "c8-blackwell-evidence-v3"
    record_kind: Literal[
        "c8-blackwell-workstation-envelope-v3"
    ] = "c8-blackwell-workstation-envelope-v3"

    def __post_init__(self) -> None:
        if (
            self.schema_version != EVIDENCE_SCHEMA_VERSION
            or self.record_kind != EVIDENCE_RECORD_KIND
            or self.exposure_status != "acceptance-only"
            or self.production_routing_enabled is not False
        ):
            raise ValueError("workstation evidence identity or exposure is invalid")
        try:
            if date.fromisoformat(self.recorded_at).isoformat() != self.recorded_at:
                raise ValueError
        except ValueError as error:
            raise ValueError("recorded date is invalid") from error
        if COMMIT_PATTERN.fullmatch(self.source_commit) is None:
            raise ValueError("source commit is invalid")
        if (
            self.authority.get("geometry") != "proposal-only"
            or self.authority.get("canonicalMutationAllowed") is not False
        ):
            raise ValueError("workstation evidence authority is invalid")
        for item in (
            self.authority,
            self.package,
            self.host,
            self.accepted_stack,
            self.compatibility_spike,
            self.fixtures,
            self.cleanup,
            *self.diagnostic_attempts,
        ):
            sha256_json(item)
        if len({run.run_id for run in self.runs}) != len(self.runs):
            raise ValueError("run identifiers must be unique")
        if any(
            run.source_commit != self.source_commit or run.rights != self.rights
            for run in self.runs
        ):
            raise ValueError("run source commit and rights must match the envelope")
        observations = {
            component: [
                algorithm
                for run in self.runs
                for algorithm in run.algorithms
                if algorithm.component is component
            ]
            for component in AlgorithmComponent
        }
        if any(len(items) != 2 for items in observations.values()):
            raise ValueError("counted evidence requires exactly two runs per algorithm")
        aggregate_components = [component for component, _verdict in self.algorithm_verdicts]
        if len(set(aggregate_components)) != len(aggregate_components) or set(
            aggregate_components
        ) != set(AlgorithmComponent):
            raise ValueError("aggregate algorithm verdicts must cover every component")
        for component, verdict in self.algorithm_verdicts:
            run_verdicts = {item.verdict for item in observations[component]}
            if verdict is AlgorithmVerdict.PASSED and run_verdicts != {
                AlgorithmVerdict.PASSED
            }:
                raise ValueError("aggregate algorithm pass disagrees with its runs")
            if verdict is AlgorithmVerdict.PARTIAL and AlgorithmVerdict.PARTIAL not in run_verdicts:
                raise ValueError("aggregate algorithm partial disagrees with its runs")
        repeatability_components = [item.component for item in self.repeatability]
        if len(set(repeatability_components)) != len(repeatability_components) or set(
            repeatability_components
        ) != set(AlgorithmComponent):
            raise ValueError("repeatability must cover every algorithm component")
        if self.runtime_verdict is RuntimeVerdict.PASSED and any(
            run.runtime.verdict is not RuntimeVerdict.PASSED for run in self.runs
        ):
            raise ValueError("aggregate runtime pass disagrees with a run")
        if self.repeatability_verdict is RepeatabilityVerdict.PASSED and any(
            item.verdict is not RepeatabilityVerdict.PASSED
            for item in self.repeatability
        ):
            raise ValueError("aggregate repeatability pass disagrees with a component")
        if self.rights.basis == "creator-owned-synthetic" and (
            self.physical_capture_verdict is FieldVerdict.PASSED
            or self.representative_accuracy_verdict is FieldVerdict.PASSED
        ):
            raise ValueError("synthetic evidence cannot pass physical or representative gates")
        for limitation in self.deferred_limitations:
            _string(limitation, "deferred limitation", 500)

    @classmethod
    def from_json(cls, value: object) -> WorkstationEvidence:
        raw = _object(value, "workstation evidence")
        _exact_keys(
            raw,
            {
                "acceptedStack",
                "authority",
                "cleanup",
                "compatibilitySpike",
                "deferredLimitations",
                "diagnosticAttempts",
                "exposure",
                "fixtures",
                "host",
                "package",
                "recordKind",
                "recordedAt",
                "repeatability",
                "rights",
                "runs",
                "schemaVersion",
                "sourceCommit",
                "verdicts",
            },
            "workstation evidence",
        )
        exposure = _object(raw["exposure"], "exposure")
        _exact_keys(exposure, {"productionRoutingEnabled", "status"}, "exposure")
        verdicts = _object(raw["verdicts"], "verdicts")
        _exact_keys(
            verdicts,
            {
                "algorithmVerdicts",
                "physicalCaptureVerdict",
                "repeatabilityVerdict",
                "representativeAccuracyVerdict",
                "runtimeVerdict",
            },
            "verdicts",
        )
        aggregate: list[tuple[AlgorithmComponent, AlgorithmVerdict]] = []
        for item in _array(verdicts["algorithmVerdicts"], "aggregate algorithm verdicts"):
            item_object = _object(item, "aggregate algorithm verdict")
            _exact_keys(item_object, {"component", "verdict"}, "aggregate algorithm verdict")
            aggregate.append(
                (
                    AlgorithmComponent(
                        _string(item_object["component"], "aggregate algorithm component")
                    ),
                    AlgorithmVerdict(
                        _string(item_object["verdict"], "aggregate algorithm verdict")
                    ),
                )
            )
        status = _string(exposure["status"], "exposure status")
        routing = exposure["productionRoutingEnabled"]
        if status != "acceptance-only" or routing is not False:
            raise ValueError("v2 evidence must remain acceptance-only")
        return cls(
            recorded_at=_string(raw["recordedAt"], "recorded date"),
            source_commit=_string(raw["sourceCommit"], "source commit", 40),
            authority=_json_object(raw["authority"], "authority"),
            package=_json_object(raw["package"], "package"),
            host=_json_object(raw["host"], "host"),
            accepted_stack=_json_object(raw["acceptedStack"], "accepted stack"),
            compatibility_spike=_json_object(
                raw["compatibilitySpike"], "compatibility spike"
            ),
            rights=RightsEvidence.from_json(raw["rights"]),
            fixtures=_json_object(raw["fixtures"], "fixtures"),
            runs=tuple(
                RunEvidence.from_json(item) for item in _array(raw["runs"], "runs")
            ),
            repeatability=tuple(
                RepeatabilityEvidence.from_json(item)
                for item in _array(raw["repeatability"], "repeatability")
            ),
            runtime_verdict=RuntimeVerdict(
                _string(verdicts["runtimeVerdict"], "runtime verdict")
            ),
            algorithm_verdicts=tuple(aggregate),
            repeatability_verdict=RepeatabilityVerdict(
                _string(verdicts["repeatabilityVerdict"], "repeatability verdict")
            ),
            physical_capture_verdict=FieldVerdict(
                _string(verdicts["physicalCaptureVerdict"], "physical capture verdict")
            ),
            representative_accuracy_verdict=FieldVerdict(
                _string(
                    verdicts["representativeAccuracyVerdict"],
                    "representative accuracy verdict",
                )
            ),
            diagnostic_attempts=tuple(
                _json_object(item, "diagnostic attempt")
                for item in _array(raw["diagnosticAttempts"], "diagnostic attempts")
            ),
            cleanup=_json_object(raw["cleanup"], "cleanup"),
            deferred_limitations=tuple(
                _string(item, "deferred limitation", 500)
                for item in _array(raw["deferredLimitations"], "deferred limitations")
            ),
            exposure_status=cast("Literal['acceptance-only']", status),
            production_routing_enabled=routing,
            schema_version=cast(
                "Literal['c8-blackwell-evidence-v3']",
                _string(raw["schemaVersion"], "evidence schema version"),
            ),
            record_kind=cast(
                "Literal['c8-blackwell-workstation-envelope-v3']",
                _string(raw["recordKind"], "record kind"),
            ),
        )

    def to_json(self) -> JsonObject:
        return {
            "acceptedStack": self.accepted_stack,
            "authority": self.authority,
            "cleanup": self.cleanup,
            "compatibilitySpike": self.compatibility_spike,
            "deferredLimitations": list(self.deferred_limitations),
            "diagnosticAttempts": list(self.diagnostic_attempts),
            "exposure": {
                "productionRoutingEnabled": self.production_routing_enabled,
                "status": self.exposure_status,
            },
            "fixtures": self.fixtures,
            "host": self.host,
            "package": self.package,
            "recordKind": self.record_kind,
            "recordedAt": self.recorded_at,
            "repeatability": [item.to_json() for item in self.repeatability],
            "rights": self.rights.to_json(),
            "runs": [run.to_json() for run in self.runs],
            "schemaVersion": self.schema_version,
            "sourceCommit": self.source_commit,
            "verdicts": {
                "algorithmVerdicts": [
                    {"component": component.value, "verdict": verdict.value}
                    for component, verdict in self.algorithm_verdicts
                ],
                "physicalCaptureVerdict": self.physical_capture_verdict.value,
                "repeatabilityVerdict": self.repeatability_verdict.value,
                "representativeAccuracyVerdict": (
                    self.representative_accuracy_verdict.value
                ),
                "runtimeVerdict": self.runtime_verdict.value,
            },
        }

    @property
    def evidence_sha256(self) -> str:
        return sha256_json(self.to_json())
