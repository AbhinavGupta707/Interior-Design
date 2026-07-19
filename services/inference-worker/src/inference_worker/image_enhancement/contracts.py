"""Strict, privacy-minimised contracts for optional C14 image enhancement."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import cast

from .errors import EnhancementError, EnhancementSafeCode

ENHANCEMENT_INPUT_SCHEMA_VERSION = "c14-image-enhancement-input-v1"
GEOMETRY_GUARD_SCHEMA_VERSION = "c14-geometry-guard-v1"
ENHANCEMENT_ARTIFACT_SCHEMA_VERSION = "c14-render-artifact-v1"

MINIMUM_DIMENSION_PIXELS = 64
MAXIMUM_DIMENSION_PIXELS = 4_096
MAXIMUM_PIXELS = 16_777_216
MAXIMUM_PNG_BYTES = 128 * 1024 * 1024
MAXIMUM_EXR_BYTES = 256 * 1024 * 1024
MAXIMUM_TOTAL_INPUT_BYTES = 512 * 1024 * 1024
MAXIMUM_OUTPUT_BYTES = 128 * 1024 * 1024
MAXIMUM_TIMEOUT_MILLISECONDS = 300_000
PROTECTED_EDGE_THRESHOLD_BASIS_POINTS = 9_800
SEGMENTATION_THRESHOLD_BASIS_POINTS = 9_800

_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_CODE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
_SAFE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+:-]{0,119}$")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_OPEN_EXR_MAGIC = b"\x76\x2f\x31\x01"

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]


def _strict_integer(value: object, *, name: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, f"{name} is outside its bound")
    return value


def validate_sha256(value: object, *, name: str) -> str:
    if type(value) is not str or _SHA256.fullmatch(value) is None:
        raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, f"{name} is not a SHA-256")
    return value


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _validated_json(value: object, *, depth: int = 0) -> JsonValue:
    if depth > 16:
        raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "configuration nesting too deep")
    if value is None or type(value) is bool:
        return cast("JsonScalar", value)
    if type(value) is str:
        if len(value.encode("utf-8")) > 4_096:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "config string too large")
        return value
    if type(value) is int:
        if not -(2**63) <= value <= 2**63 - 1:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "config integer too large")
        return value
    if type(value) is float:
        number = value
        if not math.isfinite(number):
            raise EnhancementError(EnhancementSafeCode.NON_FINITE_VALUE, "non-finite config")
        return 0.0 if number == 0.0 else number
    if type(value) in {list, tuple}:
        sequence = cast("list[object] | tuple[object, ...]", value)
        if len(sequence) > 1_024:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "config array too large")
        return [_validated_json(item, depth=depth + 1) for item in sequence]
    if type(value) is dict:
        source = cast("dict[object, object]", value)
        if len(source) > 1_024:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "config object too large")
        result: dict[str, JsonValue] = {}
        for key, item in source.items():
            if type(key) is not str or len(key) > 120:
                raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "invalid config key")
            result[key] = _validated_json(item, depth=depth + 1)
        return result
    raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "unsupported config value")


def canonical_json_sha256(value: object) -> str:
    canonical = json.dumps(
        _validated_json(value),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256_bytes(canonical)


class ArtifactRole(StrEnum):
    GEOMETRY_SAFE_PNG = "geometry-safe-png"
    DEPTH_EXR = "depth-exr"
    NORMAL_EXR = "normal-exr"
    SEGMENTATION_PNG = "segmentation-png"
    ALLOWED_EDIT_MASK_PNG = "allowed-edit-mask-png"
    ILLUSTRATIVE_ENHANCEMENT_PNG = "illustrative-enhancement-png"


_MEDIA_TYPE_BY_ROLE: dict[ArtifactRole, str] = {
    ArtifactRole.GEOMETRY_SAFE_PNG: "image/png",
    ArtifactRole.DEPTH_EXR: "image/x-exr",
    ArtifactRole.NORMAL_EXR: "image/x-exr",
    ArtifactRole.SEGMENTATION_PNG: "image/png",
    ArtifactRole.ALLOWED_EDIT_MASK_PNG: "image/png",
    ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG: "image/png",
}


@dataclass(frozen=True, slots=True)
class ExactArtifact:
    """One exact in-memory artifact; no paths, URLs, notes, or free metadata."""

    role: ArtifactRole
    media_type: str
    sha256: str = field(repr=False)
    width_px: int
    height_px: int
    content: bytes = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.role) is not ArtifactRole:
            raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "artifact role is invalid")
        if type(self.media_type) is not str or self.media_type != _MEDIA_TYPE_BY_ROLE[self.role]:
            raise EnhancementError(
                EnhancementSafeCode.INPUT_INVALID, "artifact media type mismatch"
            )
        width = _strict_integer(
            self.width_px,
            name="width_px",
            minimum=MINIMUM_DIMENSION_PIXELS,
            maximum=MAXIMUM_DIMENSION_PIXELS,
        )
        height = _strict_integer(
            self.height_px,
            name="height_px",
            minimum=MINIMUM_DIMENSION_PIXELS,
            maximum=MAXIMUM_DIMENSION_PIXELS,
        )
        if width * height > MAXIMUM_PIXELS:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "pixel budget exceeded")
        if type(self.content) is not bytes or not self.content:
            raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "artifact content is invalid")
        byte_limit = MAXIMUM_PNG_BYTES if self.media_type == "image/png" else MAXIMUM_EXR_BYTES
        if len(self.content) > byte_limit:
            raise EnhancementError(
                EnhancementSafeCode.RESOURCE_LIMIT, "artifact byte budget exceeded"
            )
        expected_magic = _PNG_SIGNATURE if self.media_type == "image/png" else _OPEN_EXR_MAGIC
        if not self.content.startswith(expected_magic):
            raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "artifact signature mismatch")
        digest = validate_sha256(self.sha256, name="artifact sha256")
        if sha256_bytes(self.content) != digest:
            raise EnhancementError(EnhancementSafeCode.INPUT_HASH_MISMATCH, "artifact bytes differ")


@dataclass(frozen=True, slots=True)
class ConditioningHashes:
    depth: str = field(repr=False)
    normal: str = field(repr=False)
    segmentation: str = field(repr=False)

    def __post_init__(self) -> None:
        validate_sha256(self.depth, name="depth sha256")
        validate_sha256(self.normal, name="normal sha256")
        validate_sha256(self.segmentation, name="segmentation sha256")


@dataclass(frozen=True, slots=True)
class EnhancementRequest:
    """The entire provider-visible C14 input allowlist.

    There is deliberately no general-purpose metadata or prompt field. In
    particular, address, notes, schedules, rights text, and unrelated evidence
    cannot be represented by this port.
    """

    base: ExactArtifact = field(repr=False)
    depth: ExactArtifact = field(repr=False)
    normal: ExactArtifact = field(repr=False)
    segmentation: ExactArtifact = field(repr=False)
    allowed_edit_mask: ExactArtifact = field(repr=False)
    camera_sha256: str = field(repr=False)
    schema_version: str = ENHANCEMENT_INPUT_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != ENHANCEMENT_INPUT_SCHEMA_VERSION:
            raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "input schema mismatch")
        expected = (
            (self.base, ArtifactRole.GEOMETRY_SAFE_PNG),
            (self.depth, ArtifactRole.DEPTH_EXR),
            (self.normal, ArtifactRole.NORMAL_EXR),
            (self.segmentation, ArtifactRole.SEGMENTATION_PNG),
            (self.allowed_edit_mask, ArtifactRole.ALLOWED_EDIT_MASK_PNG),
        )
        if any(
            type(artifact) is not ExactArtifact or artifact.role is not role
            for artifact, role in expected
        ):
            raise EnhancementError(
                EnhancementSafeCode.INPUT_INVALID, "input artifact role mismatch"
            )
        dimensions = {(artifact.width_px, artifact.height_px) for artifact, _role in expected}
        if len(dimensions) != 1:
            raise EnhancementError(EnhancementSafeCode.CONDITIONING_MISMATCH, "dimension mismatch")
        if sum(len(artifact.content) for artifact, _role in expected) > MAXIMUM_TOTAL_INPUT_BYTES:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "aggregate input too large")
        validate_sha256(self.camera_sha256, name="camera sha256")

    @property
    def conditioning_hashes(self) -> ConditioningHashes:
        return ConditioningHashes(
            depth=self.depth.sha256,
            normal=self.normal.sha256,
            segmentation=self.segmentation.sha256,
        )


class ProviderExecutionClass(StrEnum):
    DISABLED = "disabled"
    DETERMINISTIC_LOCAL_TEST = "deterministic-local-test"
    EXTERNAL = "external"


@dataclass(frozen=True, slots=True)
class ProviderProvenance:
    provider_id: str
    provider_version: str
    model_id: str
    model_version: str
    adapter_version: str
    config_sha256: str = field(repr=False)
    execution_class: ProviderExecutionClass
    external_network_used: bool
    test_only: bool
    production_eligible: bool

    def __post_init__(self) -> None:
        for name, value, pattern in (
            ("provider_id", self.provider_id, _CODE_ID),
            ("model_id", self.model_id, _CODE_ID),
            ("provider_version", self.provider_version, _SAFE_VERSION),
            ("model_version", self.model_version, _SAFE_VERSION),
            ("adapter_version", self.adapter_version, _SAFE_VERSION),
        ):
            if type(value) is not str or pattern.fullmatch(value) is None:
                raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, f"invalid {name}")
        validate_sha256(self.config_sha256, name="config sha256")
        if (
            type(self.execution_class) is not ProviderExecutionClass
            or type(self.external_network_used) is not bool
            or type(self.test_only) is not bool
            or type(self.production_eligible) is not bool
        ):
            raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "invalid provenance type")
        if self.execution_class is ProviderExecutionClass.DISABLED and (
            self.external_network_used or self.test_only or self.production_eligible
        ):
            raise EnhancementError(
                EnhancementSafeCode.INPUT_INVALID, "disabled provenance mismatch"
            )
        if self.execution_class is ProviderExecutionClass.DETERMINISTIC_LOCAL_TEST and (
            self.external_network_used or not self.test_only or self.production_eligible
        ):
            raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "test provenance mismatch")


@dataclass(frozen=True, slots=True)
class EnhancementCandidate:
    output: ExactArtifact = field(repr=False)
    output_sha256: str = field(repr=False)
    base_artifact_sha256: str = field(repr=False)
    conditioning: ConditioningHashes = field(repr=False)
    allowed_mask_sha256: str = field(repr=False)
    camera_sha256: str = field(repr=False)
    provenance: ProviderProvenance

    def __post_init__(self) -> None:
        if (
            type(self.output) is not ExactArtifact
            or self.output.role is not ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG
        ):
            raise EnhancementError(EnhancementSafeCode.OUTPUT_INVALID, "output role mismatch")
        if validate_sha256(self.output_sha256, name="output sha256") != self.output.sha256:
            raise EnhancementError(EnhancementSafeCode.OUTPUT_HASH_MISMATCH, "output hash mismatch")
        validate_sha256(self.base_artifact_sha256, name="base sha256")
        validate_sha256(self.allowed_mask_sha256, name="allowed mask sha256")
        validate_sha256(self.camera_sha256, name="camera sha256")
        if (
            type(self.conditioning) is not ConditioningHashes
            or type(self.provenance) is not ProviderProvenance
        ):
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "candidate type mismatch"
            )


class ProviderResponseState(StrEnum):
    DISABLED = "disabled"
    CANDIDATE = "candidate"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed-out"
    RESOURCE_LIMITED = "resource-limited"


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    state: ProviderResponseState
    candidate: EnhancementCandidate | None = field(default=None, repr=False)
    safe_code: EnhancementSafeCode | None = None

    def __post_init__(self) -> None:
        if type(self.state) is not ProviderResponseState:
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "response state type"
            )
        has_candidate = self.candidate is not None
        if has_candidate != (self.state is ProviderResponseState.CANDIDATE):
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "response candidate"
            )
        if has_candidate and type(self.candidate) is not EnhancementCandidate:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "candidate type")
        if (self.safe_code is not None) != (not has_candidate):
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "response safe code"
            )
        if self.safe_code is not None and type(self.safe_code) is not EnhancementSafeCode:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "safe code type")
        required_codes = {
            ProviderResponseState.DISABLED: EnhancementSafeCode.PROVIDER_DISABLED,
            ProviderResponseState.FAILED: EnhancementSafeCode.PROVIDER_FAILED,
            ProviderResponseState.CANCELLED: EnhancementSafeCode.CANCELLED,
            ProviderResponseState.TIMED_OUT: EnhancementSafeCode.TIME_LIMIT,
            ProviderResponseState.RESOURCE_LIMITED: EnhancementSafeCode.RESOURCE_LIMIT,
        }
        required = required_codes.get(self.state)
        if required is not None and self.safe_code is not required:
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "response state/code mismatch"
            )


@dataclass(frozen=True, slots=True)
class ExecutionLimits:
    timeout_milliseconds: int = 30_000
    maximum_output_bytes: int = MAXIMUM_OUTPUT_BYTES

    def __post_init__(self) -> None:
        _strict_integer(
            self.timeout_milliseconds,
            name="timeout_milliseconds",
            minimum=1,
            maximum=MAXIMUM_TIMEOUT_MILLISECONDS,
        )
        _strict_integer(
            self.maximum_output_bytes,
            name="maximum_output_bytes",
            minimum=1,
            maximum=MAXIMUM_OUTPUT_BYTES,
        )


@dataclass(frozen=True, slots=True)
class GeometryGuardReport:
    accepted: bool
    allowed_mask_sha256: str = field(repr=False)
    base_artifact_sha256: str = field(repr=False)
    camera_locked: bool
    changed_outside_allowed_mask_pixels: int
    changed_pixel_count: int
    enhanced_artifact_sha256: str = field(repr=False)
    protected_edge_agreement_basis_points: int
    protected_geometry_moved: bool
    segmentation_iou_basis_points: int
    safe_code: EnhancementSafeCode | None
    schema_version: str = GEOMETRY_GUARD_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if type(self.accepted) is not bool or type(self.camera_locked) is not bool:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "guard bool type")
        if type(self.protected_geometry_moved) is not bool:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "guard bool type")
        validate_sha256(self.allowed_mask_sha256, name="allowed mask sha256")
        validate_sha256(self.base_artifact_sha256, name="base sha256")
        validate_sha256(self.enhanced_artifact_sha256, name="enhanced sha256")
        for name, value, maximum in (
            ("changed outside mask", self.changed_outside_allowed_mask_pixels, MAXIMUM_PIXELS),
            ("changed pixels", self.changed_pixel_count, MAXIMUM_PIXELS),
            ("edge agreement", self.protected_edge_agreement_basis_points, 10_000),
            ("segmentation IoU", self.segmentation_iou_basis_points, 10_000),
        ):
            _strict_integer(value, name=name, minimum=0, maximum=maximum)
        passed = (
            self.camera_locked
            and not self.protected_geometry_moved
            and self.changed_outside_allowed_mask_pixels == 0
            and self.protected_edge_agreement_basis_points >= PROTECTED_EDGE_THRESHOLD_BASIS_POINTS
            and self.segmentation_iou_basis_points >= SEGMENTATION_THRESHOLD_BASIS_POINTS
        )
        if self.accepted != passed or (self.safe_code is None) != self.accepted:
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "guard contradiction"
            )
        if self.safe_code is not None and type(self.safe_code) is not EnhancementSafeCode:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "guard code type")


@dataclass(frozen=True, slots=True)
class EnhancementArtifact:
    sha256: str = field(repr=False)
    width_px: int
    height_px: int
    byte_length: int
    content: bytes = field(repr=False)
    role: ArtifactRole = ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG
    media_type: str = "image/png"
    schema_version: str = ENHANCEMENT_ARTIFACT_SCHEMA_VERSION

    def __post_init__(self) -> None:
        validate_sha256(self.sha256, name="enhancement sha256")
        width = _strict_integer(
            self.width_px,
            name="enhancement width",
            minimum=MINIMUM_DIMENSION_PIXELS,
            maximum=MAXIMUM_DIMENSION_PIXELS,
        )
        height = _strict_integer(
            self.height_px,
            name="enhancement height",
            minimum=MINIMUM_DIMENSION_PIXELS,
            maximum=MAXIMUM_DIMENSION_PIXELS,
        )
        if width * height > MAXIMUM_PIXELS:
            raise EnhancementError(EnhancementSafeCode.RESOURCE_LIMIT, "pixel budget exceeded")
        if type(self.content) is not bytes or sha256_bytes(self.content) != self.sha256:
            raise EnhancementError(
                EnhancementSafeCode.OUTPUT_HASH_MISMATCH, "artifact hash mismatch"
            )
        if (
            type(self.byte_length) is not int
            or not 0 < self.byte_length <= MAXIMUM_OUTPUT_BYTES
            or self.byte_length != len(self.content)
        ):
            raise EnhancementError(EnhancementSafeCode.OUTPUT_INVALID, "artifact size mismatch")
        if type(self.role) is not ArtifactRole or (
            self.role is not ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG
        ):
            raise EnhancementError(
                EnhancementSafeCode.OUTPUT_INVALID, "artifact presentation mismatch"
            )
        if type(self.media_type) is not str or self.media_type != "image/png":
            raise EnhancementError(
                EnhancementSafeCode.OUTPUT_INVALID, "artifact presentation mismatch"
            )
        if self.schema_version != ENHANCEMENT_ARTIFACT_SCHEMA_VERSION:
            raise EnhancementError(
                EnhancementSafeCode.OUTPUT_INVALID, "artifact presentation mismatch"
            )


class EnhancementOutcomeState(StrEnum):
    DISABLED = "disabled"
    SUCCEEDED = "succeeded"
    REJECTED = "rejected"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed-out"
    RESOURCE_LIMITED = "resource-limited"


@dataclass(frozen=True, slots=True)
class EnhancementOutcome:
    state: EnhancementOutcomeState
    safe_code: EnhancementSafeCode | None
    provenance: ProviderProvenance
    geometry_guard: GeometryGuardReport | None = None
    artifact: EnhancementArtifact | None = field(default=None, repr=False)
    safe_result_affected: bool = False

    def __post_init__(self) -> None:
        succeeded = self.state is EnhancementOutcomeState.SUCCEEDED
        attempted = self.state in {
            EnhancementOutcomeState.SUCCEEDED,
            EnhancementOutcomeState.REJECTED,
        }
        if (self.artifact is not None) != succeeded:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "outcome artifact")
        if (self.geometry_guard is not None) != attempted:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "outcome guard")
        if succeeded and self.geometry_guard is not None and not self.geometry_guard.accepted:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "rejected artifact")
        if (self.safe_code is None) != succeeded:
            raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "outcome safe code")
        if self.safe_result_affected:
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "safe result mutation"
            )

    @property
    def presentable(self) -> bool:
        return (
            self.state is EnhancementOutcomeState.SUCCEEDED
            and self.artifact is not None
            and self.geometry_guard is not None
            and self.geometry_guard.accepted
        )

    def diagnostic(self) -> dict[str, str | bool]:
        """Return a privacy-minimised event with no hashes, bytes, paths, or request text."""

        return {
            "event": "image-enhancement.completed",
            "state": self.state.value,
            "safeCode": self.safe_code.value if self.safe_code is not None else "NONE",
            "providerClass": self.provenance.execution_class.value,
            "testOnly": self.provenance.test_only,
            "presentable": self.presentable,
            "safeResultAffected": False,
        }
