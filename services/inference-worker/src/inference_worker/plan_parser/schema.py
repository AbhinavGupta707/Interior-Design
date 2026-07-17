"""Strict request and normalized-input validation for the C6 parser."""

import base64
import binascii
import re
from dataclasses import dataclass
from typing import Literal, cast

from .canonical import sha256_json
from .types import (
    JsonObject,
    JsonValue,
    NormalizedKind,
    NormalizedPlan,
    OpeningKind,
    OpeningSegment,
    ParserMode,
    ParserRequest,
    Point,
    Segment,
)

MAXIMUM_ASSET_BYTES = 26_214_400
MAXIMUM_CANDIDATES = 200
MAXIMUM_OUTPUT_BYTES = 5_242_880
MAXIMUM_RASTER_PIXELS = 20_000_000
PARSER_TIMEOUT_MILLISECONDS = 30_000
NORMALIZED_SCHEMA_VERSION = "c6-normalized-plan-v1"

_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_SAFE_KEY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9]*$")


@dataclass(frozen=True, slots=True)
class NormalizedInputError(ValueError):
    """A bounded failure that can become a strict abstention."""

    abstention_code: Literal[
        "invalid-parser-output", "resource-limit", "source-mismatch", "unsupported-input"
    ]
    safe_detail: str


class RequestSchemaError(ValueError):
    """The request is too malformed to construct a schema-valid abstention."""


def _object(value: JsonValue, name: str) -> JsonObject:
    if not isinstance(value, dict):
        raise RequestSchemaError(f"{name} must be an object")
    return value


def _normalized_object(value: JsonValue, name: str) -> JsonObject:
    if not isinstance(value, dict):
        raise NormalizedInputError("invalid-parser-output", f"{name} must be an object.")
    return value


def _exact_keys(
    value: JsonObject,
    expected: set[str],
    name: str,
    *,
    normalized: bool = False,
) -> None:
    if set(value) == expected:
        return
    if normalized:
        raise NormalizedInputError(
            "invalid-parser-output", f"{name} contains missing or unknown fields."
        )
    raise RequestSchemaError(f"{name} contains missing or unknown fields")


def _string(value: JsonValue | None, name: str) -> str:
    if not isinstance(value, str):
        raise RequestSchemaError(f"{name} must be a string")
    return value


def _normalized_string(value: JsonValue | None, name: str, maximum: int = 500) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise NormalizedInputError("invalid-parser-output", f"{name} is invalid.")
    return value


def _integer(value: JsonValue | None, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise RequestSchemaError(f"{name} must be a bounded integer")
    return value


def _normalized_integer(value: JsonValue | None, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise NormalizedInputError("invalid-parser-output", f"{name} is invalid.")
    return value


def _uuid(value: JsonValue | None, name: str) -> str:
    result = _string(value, name)
    if _UUID_PATTERN.fullmatch(result) is None:
        raise RequestSchemaError(f"{name} must be a canonical UUID")
    return result


def _sha256(value: JsonValue | None, name: str) -> str:
    result = _string(value, name)
    if _SHA256_PATTERN.fullmatch(result) is None:
        raise RequestSchemaError(f"{name} must be a lower-case SHA-256")
    return result


def parse_request(value: JsonValue) -> ParserRequest:
    """Validate the frozen c6-plan-parser-input-v1 request without dependencies."""

    request = _object(value, "request")
    _exact_keys(
        request,
        {
            "jobId",
            "limits",
            "normalizedInputSha256",
            "parserMode",
            "schemaVersion",
            "source",
        },
        "request",
    )
    if _string(request.get("schemaVersion"), "request.schemaVersion") != (
        "c6-plan-parser-input-v1"
    ):
        raise RequestSchemaError("unsupported request schema")
    parser_mode_value = _string(request.get("parserMode"), "request.parserMode")
    if parser_mode_value not in {
        "deterministic-vector",
        "deterministic-raster",
        "deterministic-fixture",
    }:
        raise RequestSchemaError("unsupported parser mode")
    parser_mode = cast("ParserMode", parser_mode_value)

    limits = _object(request.get("limits"), "request.limits")
    _exact_keys(
        limits,
        {"maximumCandidates", "maximumOutputBytes", "timeoutMilliseconds"},
        "request.limits",
    )
    maximum_candidates = _integer(
        limits.get("maximumCandidates"), "maximumCandidates", 1, MAXIMUM_CANDIDATES
    )
    maximum_output_bytes = _integer(
        limits.get("maximumOutputBytes"), "maximumOutputBytes", 1, MAXIMUM_OUTPUT_BYTES
    )
    timeout_milliseconds = _integer(
        limits.get("timeoutMilliseconds"),
        "timeoutMilliseconds",
        1,
        PARSER_TIMEOUT_MILLISECONDS,
    )
    if (
        maximum_candidates != MAXIMUM_CANDIDATES
        or maximum_output_bytes != MAXIMUM_OUTPUT_BYTES
        or timeout_milliseconds != PARSER_TIMEOUT_MILLISECONDS
    ):
        raise RequestSchemaError("request limits do not match c6-plan-parser-input-v1")

    source = _object(request.get("source"), "request.source")
    _exact_keys(
        source,
        {
            "assetId",
            "byteSize",
            "coordinateSpace",
            "detectedMimeType",
            "heightSourceUnits",
            "pageIndex",
            "projectId",
            "rights",
            "sha256",
            "widthSourceUnits",
        },
        "request.source",
    )
    _uuid(source.get("assetId"), "source.assetId")
    project_id = _uuid(source.get("projectId"), "source.projectId")
    _integer(source.get("byteSize"), "source.byteSize", 1, MAXIMUM_ASSET_BYTES)
    coordinate_space = _string(source.get("coordinateSpace"), "source.coordinateSpace")
    if coordinate_space not in {
        "pdf-micropoints",
        "svg-microunits",
        "pixels",
        "fixture-microunits",
    }:
        raise RequestSchemaError("unsupported source coordinate space")
    expected_coordinate_spaces: dict[ParserMode, set[str]] = {
        "deterministic-vector": {"pdf-micropoints", "svg-microunits"},
        "deterministic-raster": {"pixels"},
        "deterministic-fixture": {"fixture-microunits"},
    }
    if coordinate_space not in expected_coordinate_spaces[parser_mode]:
        raise RequestSchemaError("parser mode and source coordinate space do not match")
    detected_mime = _string(source.get("detectedMimeType"), "source.detectedMimeType")
    if detected_mime not in {
        "application/pdf",
        "image/svg+xml",
        "image/png",
        "image/jpeg",
    }:
        raise RequestSchemaError("unsupported source MIME type")
    width = _integer(source.get("widthSourceUnits"), "source.widthSourceUnits", 1, 1_000_000_000)
    height = _integer(source.get("heightSourceUnits"), "source.heightSourceUnits", 1, 1_000_000_000)
    _integer(source.get("pageIndex"), "source.pageIndex", 0, 19)
    source_sha256 = _sha256(source.get("sha256"), "source.sha256")

    rights = _object(source.get("rights"), "request.source.rights")
    _exact_keys(
        rights,
        {"basis", "serviceProcessingConsent", "trainingUseConsent"},
        "request.source.rights",
    )
    if _string(rights.get("basis"), "rights.basis") not in {
        "owned-by-user",
        "permission-granted",
        "public-domain",
        "licensed",
    }:
        raise RequestSchemaError("unsupported rights basis")
    if rights.get("serviceProcessingConsent") is not True:
        raise RequestSchemaError("service processing is not permitted")
    if rights.get("trainingUseConsent") != "denied":
        raise RequestSchemaError("training permission must remain denied")

    return ParserRequest(
        job_id=_uuid(request.get("jobId"), "request.jobId"),
        normalized_input_sha256=_sha256(
            request.get("normalizedInputSha256"), "request.normalizedInputSha256"
        ),
        parser_mode=parser_mode,
        source={key: item for key, item in source.items()},
        source_sha256=source_sha256,
        project_id=project_id,
        width=width,
        height=height,
        timeout_milliseconds=timeout_milliseconds,
        maximum_candidates=maximum_candidates,
        maximum_output_bytes=maximum_output_bytes,
    )


def _point(value: JsonValue | None, name: str, width: int, height: int) -> Point:
    point = _normalized_object(value, name)
    _exact_keys(point, {"x", "y"}, name, normalized=True)
    return Point(
        x=_normalized_integer(point.get("x"), f"{name}.x", 0, width - 1),
        y=_normalized_integer(point.get("y"), f"{name}.y", 0, height - 1),
    )


def _segment(value: JsonValue, name: str, width: int, height: int) -> Segment:
    segment = _normalized_object(value, name)
    _exact_keys(segment, {"confidence", "end", "start"}, name, normalized=True)
    parsed = Segment(
        start=_point(segment.get("start"), f"{name}.start", width, height),
        end=_point(segment.get("end"), f"{name}.end", width, height),
        confidence=_normalized_integer(segment.get("confidence"), f"{name}.confidence", 0, 100),
    ).canonical()
    if parsed.start == parsed.end:
        raise NormalizedInputError("invalid-parser-output", "A wall segment has zero length.")
    return parsed


def _opening(value: JsonValue, name: str, width: int, height: int) -> OpeningSegment:
    opening = _normalized_object(value, name)
    _exact_keys(
        opening,
        {"confidence", "end", "openingKind", "start"},
        name,
        normalized=True,
    )
    opening_kind_value = _normalized_string(opening.get("openingKind"), f"{name}.openingKind")
    if opening_kind_value not in {"door", "window", "unknown"}:
        raise NormalizedInputError("invalid-parser-output", "An opening kind is unsupported.")
    parsed = OpeningSegment(
        start=_point(opening.get("start"), f"{name}.start", width, height),
        end=_point(opening.get("end"), f"{name}.end", width, height),
        confidence=_normalized_integer(opening.get("confidence"), f"{name}.confidence", 0, 100),
        opening_kind=cast("OpeningKind", opening_kind_value),
    ).canonical()
    if parsed.start == parsed.end:
        raise NormalizedInputError("invalid-parser-output", "An opening segment has zero length.")
    return parsed


def _validate_labels(value: JsonValue | None, width: int, height: int) -> int:
    if not isinstance(value, list) or len(value) > 1_000:
        raise NormalizedInputError("resource-limit", "The normalized label list is too large.")
    for index, item in enumerate(value):
        label = _normalized_object(item, f"labels[{index}]")
        _exact_keys(label, {"region", "text"}, f"labels[{index}]", normalized=True)
        _normalized_string(label.get("text"), f"labels[{index}].text", maximum=500)
        region = _normalized_object(label.get("region"), f"labels[{index}].region")
        _exact_keys(
            region,
            {"maximum", "minimum"},
            f"labels[{index}].region",
            normalized=True,
        )
        minimum = _point(region.get("minimum"), f"labels[{index}].region.minimum", width, height)
        maximum = _point(region.get("maximum"), f"labels[{index}].region.maximum", width, height)
        if maximum.x <= minimum.x or maximum.y <= minimum.y:
            raise NormalizedInputError("invalid-parser-output", "A label region has no area.")
    return len(value)


def _validate_ascii_keys(value: JsonValue, *, depth: int = 0) -> None:
    if depth > 32:
        raise NormalizedInputError("resource-limit", "Normalized input nesting is too deep.")
    if isinstance(value, dict):
        for key, item in value.items():
            if _SAFE_KEY_PATTERN.fullmatch(key) is None:
                raise NormalizedInputError(
                    "invalid-parser-output", "Normalized input contains an unsafe field name."
                )
            _validate_ascii_keys(item, depth=depth + 1)
    elif isinstance(value, list):
        for item in value:
            _validate_ascii_keys(item, depth=depth + 1)


def parse_normalized_input(value: JsonValue, request: ParserRequest) -> tuple[NormalizedPlan, str]:
    """Validate and decode the lane-local c6-normalized-plan-v1 envelope."""

    _validate_ascii_keys(value)
    normalized_sha256 = sha256_json(value)
    if normalized_sha256 != request.normalized_input_sha256:
        raise NormalizedInputError(
            "source-mismatch", "The normalized input digest does not match the pinned request."
        )
    normalized = _normalized_object(value, "normalizedInput")
    common_keys = {"height", "kind", "schemaVersion", "sourceSha256", "width"}
    schema_version = _normalized_string(normalized.get("schemaVersion"), "schemaVersion")
    if schema_version != NORMALIZED_SCHEMA_VERSION:
        raise NormalizedInputError(
            "unsupported-input", "The normalized input version is unsupported."
        )
    source_sha256 = _normalized_string(normalized.get("sourceSha256"), "sourceSha256", 64)
    if _SHA256_PATTERN.fullmatch(source_sha256) is None or source_sha256 != request.source_sha256:
        raise NormalizedInputError(
            "source-mismatch", "The normalized input is not pinned to the requested source."
        )
    width = _normalized_integer(normalized.get("width"), "width", 2, 1_000_000_000)
    height = _normalized_integer(normalized.get("height"), "height", 2, 1_000_000_000)
    if width != request.width or height != request.height:
        raise NormalizedInputError(
            "source-mismatch", "The normalized dimensions do not match the requested source."
        )
    kind_value = _normalized_string(normalized.get("kind"), "kind")
    if kind_value not in {"vector", "fixture", "raster-gray8"}:
        raise NormalizedInputError("unsupported-input", "The normalized input kind is unsupported.")
    kind = cast("NormalizedKind", kind_value)
    expected_mode: dict[NormalizedKind, ParserMode] = {
        "vector": "deterministic-vector",
        "fixture": "deterministic-fixture",
        "raster-gray8": "deterministic-raster",
    }
    if expected_mode[kind] != request.parser_mode:
        raise NormalizedInputError(
            "source-mismatch", "The normalized input kind does not match the parser mode."
        )

    if kind in {"vector", "fixture"}:
        _exact_keys(
            normalized,
            common_keys | {"labels", "openings", "walls"},
            "normalizedInput",
            normalized=True,
        )
        walls_value = normalized.get("walls")
        openings_value = normalized.get("openings")
        if not isinstance(walls_value, list) or not isinstance(openings_value, list):
            raise NormalizedInputError(
                "invalid-parser-output", "Vector walls and openings must be arrays."
            )
        if len(walls_value) > MAXIMUM_CANDIDATES or len(openings_value) > MAXIMUM_CANDIDATES:
            raise NormalizedInputError("resource-limit", "The normalized geometry is too large.")
        walls = tuple(
            _segment(item, f"walls[{index}]", width, height)
            for index, item in enumerate(walls_value)
        )
        openings = tuple(
            _opening(item, f"openings[{index}]", width, height)
            for index, item in enumerate(openings_value)
        )
        return (
            NormalizedPlan(
                kind=kind,
                source_sha256=source_sha256,
                width=width,
                height=height,
                walls=walls,
                openings=openings,
                label_count=_validate_labels(normalized.get("labels"), width, height),
            ),
            normalized_sha256,
        )

    _exact_keys(
        normalized,
        common_keys | {"encoding", "pixelsBase64"},
        "normalizedInput",
        normalized=True,
    )
    if _normalized_string(normalized.get("encoding"), "encoding") != "gray8-base64":
        raise NormalizedInputError("unsupported-input", "The raster encoding is unsupported.")
    pixel_count = width * height
    if pixel_count > MAXIMUM_RASTER_PIXELS:
        raise NormalizedInputError("resource-limit", "The normalized raster exceeds 20 megapixels.")
    encoded = _normalized_string(
        normalized.get("pixelsBase64"), "pixelsBase64", maximum=((pixel_count + 2) // 3) * 4
    )
    if len(encoded) != ((pixel_count + 2) // 3) * 4:
        raise NormalizedInputError("invalid-parser-output", "The raster byte count is invalid.")
    try:
        pixels = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise NormalizedInputError(
            "invalid-parser-output", "The raster encoding is malformed."
        ) from error
    if len(pixels) != pixel_count:
        raise NormalizedInputError("invalid-parser-output", "The raster byte count is invalid.")
    return (
        NormalizedPlan(
            kind=kind,
            source_sha256=source_sha256,
            width=width,
            height=height,
            walls=(),
            openings=(),
            label_count=0,
            raster_pixels=pixels,
        ),
        normalized_sha256,
    )
