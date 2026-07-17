"""Strict, path-free manifests for optional C8 neural appearance execution.

The public input intentionally contains no filesystem path, executable, URL,
object key, signed access token, arbitrary command flag, or raw media. Trusted
worker composition supplies staged files separately after tenant/right checks.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from dataclasses import dataclass
from typing import Literal, cast

type JsonScalar = str | int | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
type JsonObject = dict[str, JsonValue]
type AppearanceMethod = Literal["nerfstudio", "gsplat"]
type CameraModel = Literal["OPENCV", "PINHOLE"]
type GeometryUnit = Literal["micrometres", "arbitrary-units"]

INPUT_SCHEMA_VERSION = "c8-neural-appearance-input-v1"
CAMERA_SCHEMA_VERSION = "c8-calibrated-cameras-v1"
MEDIA_SCHEMA_VERSION = "c8-media-preparation-v1"
GEOMETRY_SCHEMA_VERSION = "c8-geometry-result-v1"
APPEARANCE_SCHEMA_VERSION = "c8-appearance-result-v1"

MAXIMUM_FRAME_COUNT = 10_000
MAXIMUM_FRAME_PIXELS = 50_000_000
MAXIMUM_ARTIFACT_BYTES = 53_687_091_200
MAXIMUM_ARTIFACT_COUNT = 64
MAXIMUM_ATTEMPTS = 3

_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_SAFE_ADAPTER = re.compile(r"^[a-z][a-z0-9.-]{2,79}$")
_SAFE_MEDIA_TYPE = re.compile(r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$")


class ManifestError(ValueError):
    """A safe schema error whose message contains no untrusted value."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class PreparedFrame:
    """One privacy-reviewed sanitized frame referenced only by stable identity."""

    frame_id: str
    sanitized_sha256: str
    source_asset_id: str
    timestamp_microseconds: int
    width_pixels: int
    height_pixels: int


@dataclass(frozen=True, slots=True)
class CameraFrame:
    """Integer camera calibration and pose with explicit coordinate units."""

    basis_nanounits: tuple[int, ...]
    camera_id: str
    camera_model: CameraModel
    distortion_millionths: tuple[int, int, int, int]
    focal_x_millionths: int
    focal_y_millionths: int
    frame_id: str
    principal_x_millionths: int
    principal_y_millionths: int
    source_frame_sha256: str
    translation_micro_units: tuple[int, int, int]


@dataclass(frozen=True, slots=True)
class ToolManifest:
    """Exact producer identity retained from a frozen manifest."""

    adapter_id: str
    adapter_version: str
    config_sha256: str
    executable_version: str
    container_image_digest: str | None


@dataclass(frozen=True, slots=True)
class AppearanceInput:
    """Validated manifest bundle consumed by an optional appearance adapter."""

    attempt: int
    cameras: tuple[CameraFrame, ...]
    camera_manifest_sha256: str
    frames: tuple[PreparedFrame, ...]
    geometry_manifest_sha256: str
    geometry_tool: ToolManifest
    geometry_unit: GeometryUnit
    job_id: str
    method: AppearanceMethod
    prepared_manifest_sha256: str
    project_id: str


def canonical_json_bytes(value: JsonValue) -> bytes:
    """Encode deterministic JSON without platform-specific whitespace."""

    return json.dumps(
        value,
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_json(value: JsonValue) -> str:
    """Hash deterministic JSON bytes."""

    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def as_json_value(value: object) -> JsonValue:
    """Convert a JSON-compatible value while rejecting floats and exotic objects."""

    if value is None or isinstance(value, str | bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, list):
        return [as_json_value(item) for item in value]
    if isinstance(value, dict):
        result: JsonObject = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ManifestError("MANIFEST_NON_STRING_KEY")
            result[key] = as_json_value(item)
        return result
    raise ManifestError("MANIFEST_NON_JSON_VALUE")


def _object(
    value: object,
    *,
    required: frozenset[str],
    optional: frozenset[str] = frozenset(),
    code: str,
) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ManifestError(code)
    result = cast("dict[str, object]", value)
    keys = frozenset(result)
    if not required.issubset(keys) or not keys.issubset(required | optional):
        raise ManifestError(code)
    return result


def _array(value: object, *, minimum: int, maximum: int, code: str) -> list[object]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ManifestError(code)
    return cast("list[object]", value)


def _string(value: object, *, minimum: int = 1, maximum: int = 200, code: str) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise ManifestError(code)
    return value


def _literal(value: object, allowed: frozenset[str], *, code: str) -> str:
    result = _string(value, code=code)
    if result not in allowed:
        raise ManifestError(code)
    return result


def _integer(value: object, *, minimum: int, maximum: int, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ManifestError(code)
    return value


def _uuid(value: object, *, code: str) -> str:
    result = _string(value, maximum=36, code=code)
    try:
        parsed = uuid.UUID(result)
    except ValueError as error:
        raise ManifestError(code) from error
    if str(parsed) != result.lower():
        raise ManifestError(code)
    return result.lower()


def _sha256(value: object, *, code: str) -> str:
    result = _string(value, minimum=64, maximum=64, code=code)
    if _SHA256.fullmatch(result) is None:
        raise ManifestError(code)
    return result


def _tool(value: object) -> ToolManifest:
    raw = _object(
        value,
        required=frozenset({"adapterId", "adapterVersion", "configSha256", "executableVersion"}),
        optional=frozenset({"containerImageDigest"}),
        code="MANIFEST_TOOL_INVALID",
    )
    adapter_id = _string(raw["adapterId"], maximum=80, code="MANIFEST_TOOL_INVALID")
    if _SAFE_ADAPTER.fullmatch(adapter_id) is None:
        raise ManifestError("MANIFEST_TOOL_INVALID")
    container_digest: str | None = None
    if "containerImageDigest" in raw:
        digest = _string(
            raw["containerImageDigest"], minimum=71, maximum=71, code="MANIFEST_TOOL_INVALID"
        )
        if not digest.startswith("sha256:") or _SHA256.fullmatch(digest[7:]) is None:
            raise ManifestError("MANIFEST_TOOL_INVALID")
        container_digest = digest
    return ToolManifest(
        adapter_id=adapter_id,
        adapter_version=_string(raw["adapterVersion"], maximum=100, code="MANIFEST_TOOL_INVALID"),
        config_sha256=_sha256(raw["configSha256"], code="MANIFEST_TOOL_INVALID"),
        executable_version=_string(
            raw["executableVersion"], maximum=100, code="MANIFEST_TOOL_INVALID"
        ),
        container_image_digest=container_digest,
    )


def _rights(value: object) -> None:
    raw = _object(
        value,
        required=frozenset({"basis", "serviceProcessingConsent", "trainingUseConsent"}),
        code="MANIFEST_RIGHTS_INVALID",
    )
    _literal(
        raw["basis"],
        frozenset({"owned-by-user", "permission-granted", "public-domain", "licensed"}),
        code="MANIFEST_RIGHTS_INVALID",
    )
    if raw["serviceProcessingConsent"] is not True:
        raise ManifestError("MANIFEST_RIGHTS_INVALID")
    if raw["trainingUseConsent"] != "denied":
        raise ManifestError("MANIFEST_TRAINING_USE_NOT_DENIED")


def _prepared_manifest(
    value: object, *, expected_job_id: str, expected_project_id: str
) -> tuple[str, tuple[PreparedFrame, ...]]:
    raw = _object(
        value,
        required=frozenset(
            {
                "frames",
                "jobId",
                "manifestSha256",
                "privacyStatus",
                "projectId",
                "schemaVersion",
                "sourceManifestSha256",
                "tool",
            }
        ),
        code="PREPARED_MANIFEST_INVALID",
    )
    if raw["schemaVersion"] != MEDIA_SCHEMA_VERSION:
        raise ManifestError("PREPARED_MANIFEST_INVALID")
    if _uuid(raw["jobId"], code="PREPARED_MANIFEST_INVALID") != expected_job_id:
        raise ManifestError("MANIFEST_SCOPE_MISMATCH")
    if _uuid(raw["projectId"], code="PREPARED_MANIFEST_INVALID") != expected_project_id:
        raise ManifestError("MANIFEST_SCOPE_MISMATCH")
    manifest_sha256 = _sha256(raw["manifestSha256"], code="PREPARED_MANIFEST_INVALID")
    _sha256(raw["sourceManifestSha256"], code="PREPARED_MANIFEST_INVALID")
    _tool(raw["tool"])
    if raw["privacyStatus"] != "accepted":
        raise ManifestError("PREPARED_PRIVACY_NOT_ACCEPTED")

    frames: list[PreparedFrame] = []
    for item in _array(
        raw["frames"], minimum=1, maximum=MAXIMUM_FRAME_COUNT, code="PREPARED_FRAMES_INVALID"
    ):
        frame = _object(
            item,
            required=frozenset(
                {
                    "blurScoreMillionths",
                    "exposureScoreMillionths",
                    "frameId",
                    "heightPixels",
                    "metadataStripped",
                    "overlapScoreMillionths",
                    "redactionStatus",
                    "sanitizedSha256",
                    "sourceAssetId",
                    "timestampMicroseconds",
                    "widthPixels",
                }
            ),
            code="PREPARED_FRAME_INVALID",
        )
        for score in (
            "blurScoreMillionths",
            "exposureScoreMillionths",
            "overlapScoreMillionths",
        ):
            _integer(frame[score], minimum=0, maximum=1_000_000, code="PREPARED_FRAME_INVALID")
        if frame["metadataStripped"] is not True:
            raise ManifestError("PREPARED_METADATA_NOT_STRIPPED")
        if frame["redactionStatus"] not in {"not-required", "applied"}:
            raise ManifestError("PREPARED_PRIVACY_NOT_ACCEPTED")
        width = _integer(
            frame["widthPixels"], minimum=1, maximum=100_000, code="PREPARED_FRAME_INVALID"
        )
        height = _integer(
            frame["heightPixels"], minimum=1, maximum=100_000, code="PREPARED_FRAME_INVALID"
        )
        if width * height > MAXIMUM_FRAME_PIXELS:
            raise ManifestError("PREPARED_FRAME_PIXEL_LIMIT")
        frames.append(
            PreparedFrame(
                frame_id=_uuid(frame["frameId"], code="PREPARED_FRAME_INVALID"),
                sanitized_sha256=_sha256(frame["sanitizedSha256"], code="PREPARED_FRAME_INVALID"),
                source_asset_id=_uuid(frame["sourceAssetId"], code="PREPARED_FRAME_INVALID"),
                timestamp_microseconds=_integer(
                    frame["timestampMicroseconds"],
                    minimum=0,
                    maximum=86_400_000_000,
                    code="PREPARED_FRAME_INVALID",
                ),
                width_pixels=width,
                height_pixels=height,
            )
        )
    frame_ids = [frame.frame_id for frame in frames]
    if len(frame_ids) != len(set(frame_ids)):
        raise ManifestError("PREPARED_FRAME_DUPLICATE")
    return manifest_sha256, tuple(frames)


def _integer_vector(
    value: object, *, length: int, minimum: int, maximum: int, code: str
) -> tuple[int, ...]:
    items = _array(value, minimum=length, maximum=length, code=code)
    return tuple(_integer(item, minimum=minimum, maximum=maximum, code=code) for item in items)


def _camera_manifest(
    value: object,
    *,
    expected_job_id: str,
    expected_project_id: str,
    prepared_manifest_sha256: str,
    prepared_frames: tuple[PreparedFrame, ...],
) -> tuple[str, tuple[CameraFrame, ...], GeometryUnit]:
    raw = _object(
        value,
        required=frozenset(
            {
                "coordinateSystem",
                "frames",
                "jobId",
                "manifestSha256",
                "projectId",
                "schemaVersion",
                "sourceManifestSha256",
                "tool",
                "translationUnit",
            }
        ),
        code="CAMERA_MANIFEST_INVALID",
    )
    if raw["schemaVersion"] != CAMERA_SCHEMA_VERSION:
        raise ManifestError("CAMERA_MANIFEST_INVALID")
    if _uuid(raw["jobId"], code="CAMERA_MANIFEST_INVALID") != expected_job_id:
        raise ManifestError("MANIFEST_SCOPE_MISMATCH")
    if _uuid(raw["projectId"], code="CAMERA_MANIFEST_INVALID") != expected_project_id:
        raise ManifestError("MANIFEST_SCOPE_MISMATCH")
    if raw["coordinateSystem"] != "right-handed-local":
        raise ManifestError("CAMERA_COORDINATE_SYSTEM_INVALID")
    if _sha256(raw["sourceManifestSha256"], code="CAMERA_MANIFEST_INVALID") != (
        prepared_manifest_sha256
    ):
        raise ManifestError("MANIFEST_SOURCE_MISMATCH")
    unit = cast(
        "GeometryUnit",
        _literal(
            raw["translationUnit"],
            frozenset({"micrometres", "arbitrary-units"}),
            code="CAMERA_MANIFEST_INVALID",
        ),
    )
    _tool(raw["tool"])
    prepared_by_id = {frame.frame_id: frame for frame in prepared_frames}
    cameras: list[CameraFrame] = []
    for item in _array(
        raw["frames"], minimum=1, maximum=MAXIMUM_FRAME_COUNT, code="CAMERA_FRAMES_INVALID"
    ):
        frame = _object(
            item,
            required=frozenset(
                {
                    "basisNanounits",
                    "cameraId",
                    "cameraModel",
                    "distortionMillionths",
                    "focalXMillionths",
                    "focalYMillionths",
                    "frameId",
                    "principalXMillionths",
                    "principalYMillionths",
                    "sourceFrameSha256",
                    "translationMicroUnits",
                }
            ),
            code="CAMERA_FRAME_INVALID",
        )
        frame_id = _uuid(frame["frameId"], code="CAMERA_FRAME_INVALID")
        prepared = prepared_by_id.get(frame_id)
        source_frame_sha256 = _sha256(frame["sourceFrameSha256"], code="CAMERA_FRAME_INVALID")
        if prepared is None or prepared.sanitized_sha256 != source_frame_sha256:
            raise ManifestError("CAMERA_FRAME_SOURCE_MISMATCH")
        camera_model = cast(
            "CameraModel",
            _literal(
                frame["cameraModel"],
                frozenset({"OPENCV", "PINHOLE"}),
                code="CAMERA_FRAME_INVALID",
            ),
        )
        distortion = _integer_vector(
            frame["distortionMillionths"],
            length=4,
            minimum=-10_000_000,
            maximum=10_000_000,
            code="CAMERA_FRAME_INVALID",
        )
        if camera_model == "PINHOLE" and distortion != (0, 0, 0, 0):
            raise ManifestError("CAMERA_DISTORTION_INVALID")
        cameras.append(
            CameraFrame(
                basis_nanounits=_integer_vector(
                    frame["basisNanounits"],
                    length=9,
                    minimum=-2_000_000_000,
                    maximum=2_000_000_000,
                    code="CAMERA_FRAME_INVALID",
                ),
                camera_id=_uuid(frame["cameraId"], code="CAMERA_FRAME_INVALID"),
                camera_model=camera_model,
                distortion_millionths=cast("tuple[int, int, int, int]", distortion),
                focal_x_millionths=_integer(
                    frame["focalXMillionths"],
                    minimum=1,
                    maximum=1_000_000_000_000,
                    code="CAMERA_FRAME_INVALID",
                ),
                focal_y_millionths=_integer(
                    frame["focalYMillionths"],
                    minimum=1,
                    maximum=1_000_000_000_000,
                    code="CAMERA_FRAME_INVALID",
                ),
                frame_id=frame_id,
                principal_x_millionths=_integer(
                    frame["principalXMillionths"],
                    minimum=-1_000_000_000_000,
                    maximum=1_000_000_000_000,
                    code="CAMERA_FRAME_INVALID",
                ),
                principal_y_millionths=_integer(
                    frame["principalYMillionths"],
                    minimum=-1_000_000_000_000,
                    maximum=1_000_000_000_000,
                    code="CAMERA_FRAME_INVALID",
                ),
                source_frame_sha256=source_frame_sha256,
                translation_micro_units=cast(
                    "tuple[int, int, int]",
                    _integer_vector(
                        frame["translationMicroUnits"],
                        length=3,
                        minimum=-1_000_000_000,
                        maximum=1_000_000_000,
                        code="CAMERA_FRAME_INVALID",
                    ),
                ),
            )
        )
    ids = [camera.frame_id for camera in cameras]
    if len(ids) != len(set(ids)):
        raise ManifestError("CAMERA_FRAME_DUPLICATE")
    return (
        _sha256(raw["manifestSha256"], code="CAMERA_MANIFEST_INVALID"),
        tuple(cameras),
        unit,
    )


def _artifact(value: object) -> tuple[str, str]:
    raw = _object(
        value,
        required=frozenset(
            {
                "artifactId",
                "byteSize",
                "contentSha256",
                "dimensionalAuthority",
                "kind",
                "mediaType",
                "sourceManifestSha256",
                "toolManifestSha256",
            }
        ),
        code="GEOMETRY_ARTIFACT_INVALID",
    )
    _uuid(raw["artifactId"], code="GEOMETRY_ARTIFACT_INVALID")
    _integer(
        raw["byteSize"], minimum=1, maximum=MAXIMUM_ARTIFACT_BYTES, code="GEOMETRY_ARTIFACT_INVALID"
    )
    _sha256(raw["contentSha256"], code="GEOMETRY_ARTIFACT_INVALID")
    _sha256(raw["sourceManifestSha256"], code="GEOMETRY_ARTIFACT_INVALID")
    _sha256(raw["toolManifestSha256"], code="GEOMETRY_ARTIFACT_INVALID")
    media_type = _string(raw["mediaType"], maximum=200, code="GEOMETRY_ARTIFACT_INVALID")
    if _SAFE_MEDIA_TYPE.fullmatch(media_type) is None:
        raise ManifestError("GEOMETRY_ARTIFACT_INVALID")
    kind = _literal(
        raw["kind"],
        frozenset(
            {
                "sanitized-frame-manifest",
                "calibrated-cameras",
                "sparse-point-cloud",
                "dense-point-cloud",
                "triangle-mesh",
                "diagnostics",
                "nerfstudio-viewer",
                "gaussian-splat",
            }
        ),
        code="GEOMETRY_ARTIFACT_INVALID",
    )
    authority = _literal(
        raw["dimensionalAuthority"],
        frozenset({"proposal-only", "non-dimensional"}),
        code="GEOMETRY_ARTIFACT_INVALID",
    )
    is_appearance = kind in {"nerfstudio-viewer", "gaussian-splat"}
    if is_appearance != (authority == "non-dimensional"):
        raise ManifestError("GEOMETRY_ARTIFACT_AUTHORITY_INVALID")
    return kind, authority


def _geometry_manifest(
    value: object,
    *,
    expected_source_sha256: str,
    camera_count: int,
    camera_unit: GeometryUnit,
) -> tuple[str, ToolManifest, GeometryUnit]:
    raw = _object(
        value,
        required=frozenset(
            {
                "alignment",
                "artifacts",
                "componentCount",
                "coordinateSystem",
                "inputFrameCount",
                "manifestSha256",
                "registeredFrameCount",
                "scaleStatus",
                "schemaVersion",
                "tool",
                "unit",
            }
        ),
        code="GEOMETRY_MANIFEST_INVALID",
    )
    if raw["schemaVersion"] != GEOMETRY_SCHEMA_VERSION:
        raise ManifestError("GEOMETRY_MANIFEST_INVALID")
    if raw["coordinateSystem"] != "right-handed-local":
        raise ManifestError("GEOMETRY_COORDINATE_SYSTEM_INVALID")
    unit = cast(
        "GeometryUnit",
        _literal(
            raw["unit"],
            frozenset({"micrometres", "arbitrary-units"}),
            code="GEOMETRY_MANIFEST_INVALID",
        ),
    )
    scale_status = _literal(
        raw["scaleStatus"],
        frozenset({"metric-validated", "metric-estimated", "unknown"}),
        code="GEOMETRY_MANIFEST_INVALID",
    )
    if (scale_status == "unknown") != (unit == "arbitrary-units") or unit != camera_unit:
        raise ManifestError("GEOMETRY_SCALE_UNIT_MISMATCH")
    input_count = _integer(
        raw["inputFrameCount"],
        minimum=1,
        maximum=MAXIMUM_FRAME_COUNT,
        code="GEOMETRY_MANIFEST_INVALID",
    )
    registered_count = _integer(
        raw["registeredFrameCount"],
        minimum=1,
        maximum=MAXIMUM_FRAME_COUNT,
        code="GEOMETRY_MANIFEST_INVALID",
    )
    if registered_count > input_count or registered_count != camera_count:
        raise ManifestError("GEOMETRY_REGISTERED_FRAME_MISMATCH")
    _integer(raw["componentCount"], minimum=1, maximum=1_000, code="GEOMETRY_MANIFEST_INVALID")
    alignment = _object(
        raw["alignment"],
        required=frozenset({"anchorCount"}),
        optional=frozenset({"residualP90Micrometres"}),
        code="GEOMETRY_ALIGNMENT_INVALID",
    )
    anchor_count = _integer(
        alignment["anchorCount"], minimum=0, maximum=32, code="GEOMETRY_ALIGNMENT_INVALID"
    )
    has_residual = "residualP90Micrometres" in alignment
    if has_residual:
        _integer(
            alignment["residualP90Micrometres"],
            minimum=0,
            maximum=100_000_000,
            code="GEOMETRY_ALIGNMENT_INVALID",
        )
    if scale_status == "metric-validated" and (anchor_count < 3 or not has_residual):
        raise ManifestError("GEOMETRY_ALIGNMENT_INVALID")
    kinds: list[str] = []
    for item in _array(
        raw["artifacts"],
        minimum=2,
        maximum=MAXIMUM_ARTIFACT_COUNT,
        code="GEOMETRY_ARTIFACTS_INVALID",
    ):
        kind, authority = _artifact(item)
        if authority != "proposal-only":
            raise ManifestError("GEOMETRY_CONTAINS_APPEARANCE")
        artifact = cast("dict[str, object]", item)
        if (
            _sha256(artifact["sourceManifestSha256"], code="GEOMETRY_ARTIFACT_INVALID")
            != expected_source_sha256
        ):
            raise ManifestError("MANIFEST_SOURCE_MISMATCH")
        kinds.append(kind)
    if "calibrated-cameras" not in kinds or not {
        "sparse-point-cloud",
        "dense-point-cloud",
        "triangle-mesh",
    }.intersection(kinds):
        raise ManifestError("GEOMETRY_ARTIFACTS_INVALID")
    return (
        _sha256(raw["manifestSha256"], code="GEOMETRY_MANIFEST_INVALID"),
        _tool(raw["tool"]),
        unit,
    )


def parse_appearance_input(value: object, *, expected_method: AppearanceMethod) -> AppearanceInput:
    """Parse all frozen inputs and enforce cross-manifest scope and hash links."""

    raw = _object(
        value,
        required=frozenset(
            {
                "attempt",
                "cameras",
                "geometry",
                "jobId",
                "method",
                "prepared",
                "projectId",
                "rights",
                "schemaVersion",
            }
        ),
        code="APPEARANCE_INPUT_INVALID",
    )
    if raw["schemaVersion"] != INPUT_SCHEMA_VERSION or raw["method"] != expected_method:
        raise ManifestError("APPEARANCE_INPUT_INVALID")
    _rights(raw["rights"])
    job_id = _uuid(raw["jobId"], code="APPEARANCE_INPUT_INVALID")
    project_id = _uuid(raw["projectId"], code="APPEARANCE_INPUT_INVALID")
    attempt = _integer(
        raw["attempt"], minimum=1, maximum=MAXIMUM_ATTEMPTS, code="APPEARANCE_INPUT_INVALID"
    )
    prepared_sha, frames = _prepared_manifest(
        raw["prepared"], expected_job_id=job_id, expected_project_id=project_id
    )
    camera_sha, cameras, camera_unit = _camera_manifest(
        raw["cameras"],
        expected_job_id=job_id,
        expected_project_id=project_id,
        prepared_manifest_sha256=prepared_sha,
        prepared_frames=frames,
    )
    geometry_sha, geometry_tool, geometry_unit = _geometry_manifest(
        raw["geometry"],
        expected_source_sha256=prepared_sha,
        camera_count=len(cameras),
        camera_unit=camera_unit,
    )
    return AppearanceInput(
        attempt=attempt,
        cameras=cameras,
        camera_manifest_sha256=camera_sha,
        frames=frames,
        geometry_manifest_sha256=geometry_sha,
        geometry_tool=geometry_tool,
        geometry_unit=geometry_unit,
        job_id=job_id,
        method=expected_method,
        prepared_manifest_sha256=prepared_sha,
        project_id=project_id,
    )


def finite_decimal(value: int, divisor: int) -> float:
    """Convert a bounded integer unit to a finite JSON number."""

    result = value / divisor
    if not math.isfinite(result):
        raise ManifestError("CAMERA_NON_FINITE")
    return result
