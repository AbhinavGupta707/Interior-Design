"""Strict, dependency-free validation for the private C9 fitting protocol."""

import re
import uuid
from typing import cast

from .canonical import sha256_json, source_manifest_sha256, validated_json
from .errors import ScanToModelError
from .types import (
    BaseSnapshot,
    BoundaryObservation,
    Coverage,
    EvidencePin,
    EvidenceState,
    FittingRequest,
    FixedObjectHint,
    JsonObject,
    JsonValue,
    LevelHint,
    Observation,
    ObservationCore,
    OpeningKind,
    OpeningObservation,
    PlaneObservation,
    PlaneSemantic,
    Point3,
    RegisteredSource,
    RegistrationStatus,
    RoomHint,
    ScaleStatus,
    SourceKind,
    StairHint,
    ToolPin,
    Transform,
    WorkLimits,
)

REQUEST_SCHEMA_VERSION = "c9-scan-to-model-request-v1"
SOURCE_MANIFEST_SCHEMA_VERSION = "c9-semantic-source-manifest-v1"
RESULT_SCHEMA_VERSION = "c9-scan-to-model-result-v1"

MAXIMUM_SOURCES = 32
MAXIMUM_OBSERVATIONS = 10_000
MAXIMUM_VERTICES = 100_000
MAXIMUM_OUTPUT_BYTES = 8_388_608
MAXIMUM_WORK_UNITS = 2_000_000
MAXIMUM_TIMEOUT_MILLISECONDS = 30_000
MAXIMUM_COORDINATE_MM = 10_000_000
MAXIMUM_DIMENSION_MM = 1_000_000
MINIMUM_OUTPUT_BYTES = 32_768

_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_SAFE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.+_-]{0,99}$")
_SAFE_IDENTIFIER = re.compile(r"^[a-z][a-z0-9.-]{0,79}$")
_LEVEL_KEY = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SAFE_LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,'()/_-]{0,79}$")


def _object(value: JsonValue | None, expected: frozenset[str], code: str) -> JsonObject:
    if not isinstance(value, dict) or frozenset(value) != expected:
        raise ScanToModelError(code, "object has missing or unknown fields")
    return value


def _array(
    value: JsonValue | None,
    *,
    minimum: int,
    maximum: int,
    code: str,
) -> list[JsonValue]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ScanToModelError(code, "array length is outside its bound")
    return value


def _string(value: JsonValue | None, *, pattern: re.Pattern[str], code: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise ScanToModelError(code, "string is invalid")
    return value


def _optional_label(value: JsonValue | None, code: str) -> str | None:
    if value is None:
        return None
    return _string(value, pattern=_SAFE_LABEL, code=code)


def _integer(
    value: JsonValue | None,
    *,
    minimum: int,
    maximum: int,
    code: str,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ScanToModelError(code, "integer is outside its bound")
    return value


def _uuid(value: JsonValue | None, code: str) -> str:
    if not isinstance(value, str):
        raise ScanToModelError(code, "UUID is invalid")
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise ScanToModelError(code, "UUID is invalid") from error
    if str(parsed) != value or parsed.version is None:
        raise ScanToModelError(code, "UUID must be canonical lower-case")
    return value


def _sha256(value: JsonValue | None, code: str) -> str:
    return _string(value, pattern=_SHA256, code=code)


def _point(value: JsonValue | None, code: str) -> Point3:
    raw = _object(value, frozenset({"xMm", "yMm", "zMm"}), code)
    return Point3(
        _integer(
            raw.get("xMm"),
            minimum=-MAXIMUM_COORDINATE_MM,
            maximum=MAXIMUM_COORDINATE_MM,
            code=code,
        ),
        _integer(
            raw.get("yMm"),
            minimum=-MAXIMUM_COORDINATE_MM,
            maximum=MAXIMUM_COORDINATE_MM,
            code=code,
        ),
        _integer(
            raw.get("zMm"),
            minimum=-MAXIMUM_COORDINATE_MM,
            maximum=MAXIMUM_COORDINATE_MM,
            code=code,
        ),
    )


def _normal(value: JsonValue | None, code: str) -> Point3:
    raw = _object(value, frozenset({"xE9", "yE9", "zE9"}), code)
    normal = Point3(
        _integer(raw.get("xE9"), minimum=-1_000_000_000, maximum=1_000_000_000, code=code),
        _integer(raw.get("yE9"), minimum=-1_000_000_000, maximum=1_000_000_000, code=code),
        _integer(raw.get("zE9"), minimum=-1_000_000_000, maximum=1_000_000_000, code=code),
    )
    norm_squared = normal.x * normal.x + normal.y * normal.y + normal.z * normal.z
    if abs(norm_squared - 1_000_000_000_000_000_000) > 2_000_000_000_000_000:
        raise ScanToModelError(code, "normal must be unit length within the E9 tolerance")
    return normal


def _points(
    value: JsonValue | None,
    *,
    minimum: int,
    maximum: int,
    code: str,
) -> tuple[Point3, ...]:
    raw = _array(value, minimum=minimum, maximum=maximum, code=code)
    points = tuple(_point(item, code) for item in raw)
    if len(set(points)) != len(points):
        raise ScanToModelError(code, "geometry contains repeated vertices")
    return points


def _core(raw: JsonObject, code: str) -> ObservationCore:
    coverage_value = raw.get("coverage")
    if coverage_value not in {"observed", "partial", "occluded"}:
        raise ScanToModelError(code, "unsupported coverage state")
    return ObservationCore(
        observation_id=_uuid(raw.get("observationId"), code),
        confidence_basis_points=_integer(
            raw.get("confidenceBasisPoints"), minimum=0, maximum=10_000, code=code
        ),
        coverage=cast("Coverage", coverage_value),
    )


def _level_key(value: JsonValue | None, code: str) -> str:
    return _string(value, pattern=_LEVEL_KEY, code=code)


def _parse_observation(value: JsonValue, index: int) -> Observation:
    code = "INVALID_OBSERVATION"
    if not isinstance(value, dict):
        raise ScanToModelError(code, f"observation {index} is not an object")
    observation_type = value.get("observationType")
    common = {"confidenceBasisPoints", "coverage", "observationId", "observationType"}

    if observation_type == "level-hint":
        raw = _object(
            value,
            frozenset(common | {"elevationMm", "levelKey", "name", "storeyHeightMm"}),
            code,
        )
        core = _core(raw, code)
        if core.coverage == "occluded":
            raise ScanToModelError(code, "an occluded level hint cannot establish a level")
        return LevelHint(
            core=core,
            level_key=_level_key(raw.get("levelKey"), code),
            elevation_mm=_integer(
                raw.get("elevationMm"),
                minimum=-MAXIMUM_COORDINATE_MM,
                maximum=MAXIMUM_COORDINATE_MM,
                code=code,
            ),
            storey_height_mm=_integer(
                raw.get("storeyHeightMm"),
                minimum=100,
                maximum=MAXIMUM_DIMENSION_MM,
                code=code,
            ),
            name=_optional_label(raw.get("name"), code),
        )

    if observation_type == "plane":
        raw = _object(
            value,
            frozenset(common | {"boundary", "levelKey", "normalE9", "semantic"}),
            code,
        )
        semantic = raw.get("semantic")
        if semantic not in {"wall-face", "floor", "ceiling", "slab", "other"}:
            raise ScanToModelError(code, "unsupported plane semantic")
        return PlaneObservation(
            core=_core(raw, code),
            level_key=_level_key(raw.get("levelKey"), code),
            semantic=cast("PlaneSemantic", semantic),
            boundary=_points(raw.get("boundary"), minimum=3, maximum=64, code=code),
            normal_e9=_normal(raw.get("normalE9"), code),
        )

    if observation_type == "boundary":
        raw = _object(
            value,
            frozenset(common | {"levelKey", "occludedEdgeIndices", "polygon"}),
            code,
        )
        polygon = _points(raw.get("polygon"), minimum=3, maximum=256, code=code)
        edge_values = _array(
            raw.get("occludedEdgeIndices"), minimum=0, maximum=len(polygon), code=code
        )
        edges = tuple(
            _integer(item, minimum=0, maximum=len(polygon) - 1, code=code) for item in edge_values
        )
        if len(set(edges)) != len(edges):
            raise ScanToModelError(code, "occluded edge indexes must be unique")
        return BoundaryObservation(
            core=_core(raw, code),
            level_key=_level_key(raw.get("levelKey"), code),
            polygon=polygon,
            occluded_edge_indices=tuple(sorted(edges)),
        )

    if observation_type == "opening":
        raw = _object(
            value,
            frozenset(common | {"boundary", "hostPlaneObservationId", "kind", "levelKey"}),
            code,
        )
        kind = raw.get("kind")
        if kind not in {"door", "window", "opening", "unknown"}:
            raise ScanToModelError(code, "unsupported opening kind")
        return OpeningObservation(
            core=_core(raw, code),
            level_key=_level_key(raw.get("levelKey"), code),
            host_plane_observation_id=_uuid(raw.get("hostPlaneObservationId"), code),
            opening_kind=cast("OpeningKind", kind),
            boundary=_points(raw.get("boundary"), minimum=4, maximum=4, code=code),
        )

    if observation_type == "room-hint":
        raw = _object(
            value,
            frozenset(common | {"boundaryObservationId", "classification", "levelKey", "name"}),
            code,
        )
        return RoomHint(
            core=_core(raw, code),
            level_key=_level_key(raw.get("levelKey"), code),
            boundary_observation_id=_uuid(raw.get("boundaryObservationId"), code),
            classification=_optional_label(raw.get("classification"), code),
            name=_optional_label(raw.get("name"), code),
        )

    if observation_type == "stair-hint":
        raw = _object(
            value,
            frozenset(
                common
                | {
                    "fromLevelKey",
                    "path",
                    "stepCount",
                    "toLevelKey",
                    "totalRiseMm",
                    "totalRunMm",
                    "widthMm",
                }
            ),
            code,
        )
        return StairHint(
            core=_core(raw, code),
            from_level_key=_level_key(raw.get("fromLevelKey"), code),
            to_level_key=_level_key(raw.get("toLevelKey"), code),
            path=_points(raw.get("path"), minimum=2, maximum=64, code=code),
            width_mm=_integer(
                raw.get("widthMm"), minimum=100, maximum=MAXIMUM_DIMENSION_MM, code=code
            ),
            step_count=_integer(raw.get("stepCount"), minimum=1, maximum=1_000, code=code),
            total_rise_mm=_integer(
                raw.get("totalRiseMm"), minimum=1, maximum=MAXIMUM_DIMENSION_MM, code=code
            ),
            total_run_mm=_integer(
                raw.get("totalRunMm"), minimum=1, maximum=MAXIMUM_DIMENSION_MM, code=code
            ),
        )

    if observation_type == "fixed-object-hint":
        raw = _object(
            value,
            frozenset(
                common
                | {
                    "category",
                    "dimensionsMm",
                    "levelKey",
                    "position",
                    "rotationMilliDegrees",
                }
            ),
            code,
        )
        dimensions = _object(
            raw.get("dimensionsMm"),
            frozenset({"depthMm", "heightMm", "widthMm"}),
            code,
        )
        return FixedObjectHint(
            core=_core(raw, code),
            level_key=_level_key(raw.get("levelKey"), code),
            category=_string(raw.get("category"), pattern=_SAFE_LABEL, code=code),
            position=_point(raw.get("position"), code),
            width_mm=_integer(
                dimensions.get("widthMm"),
                minimum=1,
                maximum=MAXIMUM_DIMENSION_MM,
                code=code,
            ),
            depth_mm=_integer(
                dimensions.get("depthMm"),
                minimum=1,
                maximum=MAXIMUM_DIMENSION_MM,
                code=code,
            ),
            height_mm=_integer(
                dimensions.get("heightMm"),
                minimum=1,
                maximum=MAXIMUM_DIMENSION_MM,
                code=code,
            ),
            rotation_milli_degrees=_integer(
                raw.get("rotationMilliDegrees"), minimum=-360_000, maximum=360_000, code=code
            ),
        )

    raise ScanToModelError(code, "unsupported observation type")


def _transform(value: JsonValue | None) -> Transform:
    code = "INVALID_TRANSFORM"
    raw = _object(
        value,
        frozenset({"rotationQuaternionE9", "scalePartsPerMillion", "translationMm"}),
        code,
    )
    rotation = _object(raw.get("rotationQuaternionE9"), frozenset({"w", "x", "y", "z"}), code)
    quaternion = tuple(
        _integer(rotation.get(key), minimum=-1_000_000_000, maximum=1_000_000_000, code=code)
        for key in ("w", "x", "y", "z")
    )
    norm_squared = sum(component * component for component in quaternion)
    if abs(norm_squared - 1_000_000_000_000_000_000) > 2_000_000_000_000_000:
        raise ScanToModelError(code, "rotation quaternion is outside the E9 unit tolerance")
    return Transform(
        translation=_point(raw.get("translationMm"), code),
        rotation=cast("tuple[int, int, int, int]", quaternion),
        scale_parts_per_million=_integer(
            raw.get("scalePartsPerMillion"), minimum=1, maximum=1_000_000_000, code=code
        ),
    )


def _parse_source(value: JsonValue, limits: WorkLimits) -> RegisteredSource:
    code = "INVALID_SOURCE"
    raw = _object(
        value,
        frozenset(
            {
                "coordinateFrame",
                "evidence",
                "evidenceState",
                "kind",
                "observations",
                "referenceId",
                "registrationStatus",
                "rights",
                "scaleStatus",
                "schemaVersion",
                "sourceId",
                "sourceSha256",
                "tool",
                "transform",
                "unit",
            }
        ),
        code,
    )
    kind_value = raw.get("kind")
    source_kinds = {
        "plan-proposal",
        "roomplan-proposal",
        "reconstruction-result",
        "measurement-set",
        "user-assertion-set",
    }
    if kind_value not in source_kinds:
        raise ScanToModelError(code, "unsupported source kind")
    state_value = raw.get("evidenceState")
    states = {"observed", "source-derived", "fused", "inferred", "user-asserted"}
    if state_value not in states:
        raise ScanToModelError(code, "unsupported evidence state")
    if (kind_value == "user-assertion-set") != (state_value == "user-asserted"):
        raise ScanToModelError(code, "user assertion authority does not match source kind")
    coordinate_frame = raw.get("coordinateFrame")
    if coordinate_frame not in {"project-local", "source-local-metric", "source-local-arbitrary"}:
        raise ScanToModelError(code, "unsupported coordinate frame")
    scale_value = raw.get("scaleStatus")
    if scale_value not in {"metric-validated", "metric-estimated", "unknown"}:
        raise ScanToModelError(code, "unsupported scale status")
    if coordinate_frame == "project-local" and scale_value == "unknown":
        raise ScanToModelError(code, "project-local geometry cannot have unknown scale")
    registration_value = raw.get("registrationStatus")
    if registration_value not in {"registered", "partial"}:
        raise ScanToModelError(code, "source is not registered")
    if raw.get("unit") != "mm":
        raise ScanToModelError(code, "only integer millimetres are supported")

    rights = _object(
        raw.get("rights"),
        frozenset({"serviceProcessingConsent", "trainingUseConsent"}),
        code,
    )
    if rights.get("serviceProcessingConsent") is not True:
        raise ScanToModelError(code, "service processing is not permitted")
    if rights.get("trainingUseConsent") != "denied":
        raise ScanToModelError(code, "training use must remain denied")

    evidence = _object(
        raw.get("evidence"),
        frozenset({"evidenceId", "evidenceSha256", "schemaVersion"}),
        code,
    )
    tool = _object(
        raw.get("tool"),
        frozenset({"configSha256", "name", "toolSha256", "version"}),
        code,
    )
    observations_value = _array(
        raw.get("observations"), minimum=1, maximum=limits.maximum_observations, code=code
    )
    observations = tuple(
        sorted(
            (_parse_observation(item, index) for index, item in enumerate(observations_value)),
            key=lambda item: (type(item).__name__, item.core.observation_id),
        )
    )
    observation_ids = [item.core.observation_id for item in observations]
    if len(set(observation_ids)) != len(observation_ids):
        raise ScanToModelError(code, "source observation IDs must be unique")
    plane_ids = {
        item.core.observation_id for item in observations if isinstance(item, PlaneObservation)
    }
    boundary_ids = {
        item.core.observation_id for item in observations if isinstance(item, BoundaryObservation)
    }
    for item in observations:
        if isinstance(item, OpeningObservation) and item.host_plane_observation_id not in plane_ids:
            raise ScanToModelError(code, "opening host must be a plane in the same source")
        if isinstance(item, RoomHint) and item.boundary_observation_id not in boundary_ids:
            raise ScanToModelError(code, "room hint boundary must be in the same source")
    transform = _transform(raw.get("transform"))
    if coordinate_frame == "project-local" and transform != Transform(
        Point3(0, 0, 0), (1_000_000_000, 0, 0, 0), 1_000_000
    ):
        raise ScanToModelError(code, "project-local sources require the identity transform")
    return RegisteredSource(
        source_id=_uuid(raw.get("sourceId"), code),
        reference_id=_uuid(raw.get("referenceId"), code),
        kind=cast("SourceKind", kind_value),
        schema_version=_string(raw.get("schemaVersion"), pattern=_SAFE_VERSION, code=code),
        source_sha256=_sha256(raw.get("sourceSha256"), code),
        evidence_state=cast("EvidenceState", state_value),
        evidence=EvidencePin(
            evidence_id=_uuid(evidence.get("evidenceId"), code),
            evidence_sha256=_sha256(evidence.get("evidenceSha256"), code),
            schema_version=_string(evidence.get("schemaVersion"), pattern=_SAFE_VERSION, code=code),
        ),
        tool=ToolPin(
            name=_string(tool.get("name"), pattern=_SAFE_IDENTIFIER, code=code),
            version=_string(tool.get("version"), pattern=_SAFE_VERSION, code=code),
            tool_sha256=_sha256(tool.get("toolSha256"), code),
            config_sha256=_sha256(tool.get("configSha256"), code),
        ),
        coordinate_frame=coordinate_frame,
        scale_status=cast("ScaleStatus", scale_value),
        registration_status=cast("RegistrationStatus", registration_value),
        transform=transform,
        observations=observations,
    )


def _parse_limits(value: JsonValue | None) -> WorkLimits:
    code = "INVALID_LIMITS"
    raw = _object(
        value,
        frozenset(
            {
                "maximumObservations",
                "maximumOutputBytes",
                "maximumSources",
                "maximumVertices",
                "maximumWorkUnits",
                "timeoutMilliseconds",
            }
        ),
        code,
    )
    return WorkLimits(
        maximum_sources=_integer(
            raw.get("maximumSources"), minimum=2, maximum=MAXIMUM_SOURCES, code=code
        ),
        maximum_observations=_integer(
            raw.get("maximumObservations"),
            minimum=1,
            maximum=MAXIMUM_OBSERVATIONS,
            code=code,
        ),
        maximum_vertices=_integer(
            raw.get("maximumVertices"), minimum=3, maximum=MAXIMUM_VERTICES, code=code
        ),
        maximum_output_bytes=_integer(
            raw.get("maximumOutputBytes"),
            minimum=MINIMUM_OUTPUT_BYTES,
            maximum=MAXIMUM_OUTPUT_BYTES,
            code=code,
        ),
        maximum_work_units=_integer(
            raw.get("maximumWorkUnits"), minimum=100, maximum=MAXIMUM_WORK_UNITS, code=code
        ),
        timeout_milliseconds=_integer(
            raw.get("timeoutMilliseconds"),
            minimum=1,
            maximum=MAXIMUM_TIMEOUT_MILLISECONDS,
            code=code,
        ),
    )


def _vertex_count(observation: Observation) -> int:
    if isinstance(observation, PlaneObservation | OpeningObservation):
        return len(observation.boundary)
    if isinstance(observation, BoundaryObservation):
        return len(observation.polygon)
    if isinstance(observation, StairHint):
        return len(observation.path)
    return 1 if isinstance(observation, FixedObjectHint) else 0


def parse_request(value: object) -> FittingRequest:
    """Validate and canonicalise one complete private fitting request."""

    decoded = validated_json(value)
    raw = _object(
        decoded if isinstance(decoded, dict) else None,
        frozenset(
            {
                "baseSnapshot",
                "cancellation",
                "jobId",
                "limits",
                "projectId",
                "schemaVersion",
                "sourceManifest",
            }
        ),
        "INVALID_REQUEST",
    )
    if raw.get("schemaVersion") != REQUEST_SCHEMA_VERSION:
        raise ScanToModelError("UNSUPPORTED_SCHEMA", "unsupported request schema version")
    limits = _parse_limits(raw.get("limits"))
    base = _object(
        raw.get("baseSnapshot"),
        frozenset({"modelId", "profile", "snapshotId", "snapshotSha256"}),
        "INVALID_BASE_SNAPSHOT",
    )
    if base.get("profile") != "existing":
        raise ScanToModelError("INVALID_BASE_SNAPSHOT", "only an existing base is accepted")
    cancellation = _object(
        raw.get("cancellation"), frozenset({"requested"}), "INVALID_CANCELLATION"
    )
    if not isinstance(cancellation.get("requested"), bool):
        raise ScanToModelError("INVALID_CANCELLATION", "requested must be boolean")
    manifest = _object(
        raw.get("sourceManifest"),
        frozenset({"manifestSha256", "schemaVersion", "sources"}),
        "INVALID_MANIFEST",
    )
    if manifest.get("schemaVersion") != SOURCE_MANIFEST_SCHEMA_VERSION:
        raise ScanToModelError("UNSUPPORTED_SCHEMA", "unsupported source manifest schema")
    expected_manifest_hash = _sha256(manifest.get("manifestSha256"), "INVALID_MANIFEST")
    actual_manifest_hash = source_manifest_sha256(manifest)
    if expected_manifest_hash != actual_manifest_hash:
        raise ScanToModelError("MANIFEST_HASH_MISMATCH", "source manifest hash does not match")
    sources_value = _array(
        manifest.get("sources"), minimum=2, maximum=limits.maximum_sources, code="INVALID_MANIFEST"
    )
    sources = tuple(
        sorted((_parse_source(item, limits) for item in sources_value), key=lambda s: s.source_id)
    )
    if len({source.source_id for source in sources}) != len(sources):
        raise ScanToModelError("INVALID_MANIFEST", "source IDs must be unique")
    if len({(source.kind, source.reference_id) for source in sources}) != len(sources):
        raise ScanToModelError("INVALID_MANIFEST", "immutable source references must be unique")
    if len({source.kind for source in sources}) < 2:
        raise ScanToModelError(
            "INSUFFICIENT_SOURCE_KINDS", "at least two source kinds are required"
        )
    observation_ids = [
        observation.core.observation_id for source in sources for observation in source.observations
    ]
    if len(set(observation_ids)) != len(observation_ids):
        raise ScanToModelError("INVALID_MANIFEST", "observation IDs must be globally unique")
    if len(observation_ids) > limits.maximum_observations:
        raise ScanToModelError("RESOURCE_LIMIT", "observation count exceeds the request limit")
    if sum(_vertex_count(item) for source in sources for item in source.observations) > (
        limits.maximum_vertices
    ):
        raise ScanToModelError("RESOURCE_LIMIT", "vertex count exceeds the request limit")

    job_id = _uuid(raw.get("jobId"), "INVALID_REQUEST")
    project_id = _uuid(raw.get("projectId"), "INVALID_REQUEST")
    base_snapshot = BaseSnapshot(
        model_id=_uuid(base.get("modelId"), "INVALID_BASE_SNAPSHOT"),
        snapshot_id=_uuid(base.get("snapshotId"), "INVALID_BASE_SNAPSHOT"),
        snapshot_sha256=_sha256(base.get("snapshotSha256"), "INVALID_BASE_SNAPSHOT"),
    )
    request_hash_value: JsonObject = {
        "baseSnapshot": {
            "modelId": base_snapshot.model_id,
            "profile": "existing",
            "snapshotId": base_snapshot.snapshot_id,
            "snapshotSha256": base_snapshot.snapshot_sha256,
        },
        "cancellation": {"requested": cast("bool", cancellation["requested"])},
        "jobId": job_id,
        "limits": limits_to_json(limits),
        "projectId": project_id,
        "schemaVersion": REQUEST_SCHEMA_VERSION,
        "sourceManifestSha256": expected_manifest_hash,
    }
    return FittingRequest(
        job_id=job_id,
        project_id=project_id,
        base_snapshot=base_snapshot,
        source_manifest_sha256=expected_manifest_hash,
        sources=sources,
        limits=limits,
        cancellation_requested=cast("bool", cancellation["requested"]),
        request_sha256=sha256_json(request_hash_value),
    )


def limits_to_json(limits: WorkLimits) -> JsonObject:
    return {
        "maximumObservations": limits.maximum_observations,
        "maximumOutputBytes": limits.maximum_output_bytes,
        "maximumSources": limits.maximum_sources,
        "maximumVertices": limits.maximum_vertices,
        "maximumWorkUnits": limits.maximum_work_units,
        "timeoutMilliseconds": limits.timeout_milliseconds,
    }
