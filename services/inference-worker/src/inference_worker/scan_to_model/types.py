"""Strict immutable types for the C9 private semantic-fitting protocol."""

from dataclasses import dataclass
from typing import Literal

type JsonScalar = str | int | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
type JsonObject = dict[str, JsonValue]

type SourceKind = Literal[
    "plan-proposal",
    "roomplan-proposal",
    "reconstruction-result",
    "measurement-set",
    "user-assertion-set",
]
type EvidenceState = Literal["observed", "source-derived", "fused", "inferred", "user-asserted"]
type Coverage = Literal["observed", "partial", "occluded"]
type ScaleStatus = Literal["metric-validated", "metric-estimated", "unknown"]
type RegistrationStatus = Literal["registered", "partial"]
type PlaneSemantic = Literal["wall-face", "floor", "ceiling", "slab", "other"]
type OpeningKind = Literal["door", "window", "opening", "unknown"]


@dataclass(frozen=True, order=True, slots=True)
class Point3:
    """An integer millimetre point or E9 vector, depending on context."""

    x: int
    y: int
    z: int


@dataclass(frozen=True, slots=True)
class Transform:
    """A fixed-point source-to-project similarity transform."""

    translation: Point3
    rotation: tuple[int, int, int, int]
    scale_parts_per_million: int


@dataclass(frozen=True, slots=True)
class EvidencePin:
    evidence_id: str
    evidence_sha256: str
    schema_version: str


@dataclass(frozen=True, slots=True)
class ToolPin:
    name: str
    version: str
    tool_sha256: str
    config_sha256: str


@dataclass(frozen=True, slots=True)
class ObservationCore:
    observation_id: str
    confidence_basis_points: int
    coverage: Coverage


@dataclass(frozen=True, slots=True)
class LevelHint:
    core: ObservationCore
    level_key: str
    elevation_mm: int
    storey_height_mm: int
    name: str | None


@dataclass(frozen=True, slots=True)
class PlaneObservation:
    core: ObservationCore
    level_key: str
    semantic: PlaneSemantic
    boundary: tuple[Point3, ...]
    normal_e9: Point3


@dataclass(frozen=True, slots=True)
class BoundaryObservation:
    core: ObservationCore
    level_key: str
    polygon: tuple[Point3, ...]
    occluded_edge_indices: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class OpeningObservation:
    core: ObservationCore
    level_key: str
    host_plane_observation_id: str
    opening_kind: OpeningKind
    boundary: tuple[Point3, ...]


@dataclass(frozen=True, slots=True)
class RoomHint:
    core: ObservationCore
    level_key: str
    boundary_observation_id: str
    classification: str | None
    name: str | None


@dataclass(frozen=True, slots=True)
class StairHint:
    core: ObservationCore
    from_level_key: str
    to_level_key: str
    path: tuple[Point3, ...]
    width_mm: int
    step_count: int
    total_rise_mm: int
    total_run_mm: int


@dataclass(frozen=True, slots=True)
class FixedObjectHint:
    core: ObservationCore
    level_key: str
    category: str
    position: Point3
    width_mm: int
    depth_mm: int
    height_mm: int
    rotation_milli_degrees: int


type Observation = (
    LevelHint
    | PlaneObservation
    | BoundaryObservation
    | OpeningObservation
    | RoomHint
    | StairHint
    | FixedObjectHint
)


@dataclass(frozen=True, slots=True)
class RegisteredSource:
    source_id: str
    reference_id: str
    kind: SourceKind
    schema_version: str
    source_sha256: str
    evidence_state: EvidenceState
    evidence: EvidencePin
    tool: ToolPin
    coordinate_frame: str
    scale_status: ScaleStatus
    registration_status: RegistrationStatus
    transform: Transform
    observations: tuple[Observation, ...]


@dataclass(frozen=True, slots=True)
class WorkLimits:
    maximum_sources: int
    maximum_observations: int
    maximum_vertices: int
    maximum_output_bytes: int
    maximum_work_units: int
    timeout_milliseconds: int


@dataclass(frozen=True, slots=True)
class BaseSnapshot:
    model_id: str
    snapshot_id: str
    snapshot_sha256: str


@dataclass(frozen=True, slots=True)
class FittingRequest:
    job_id: str
    project_id: str
    base_snapshot: BaseSnapshot
    source_manifest_sha256: str
    sources: tuple[RegisteredSource, ...]
    limits: WorkLimits
    cancellation_requested: bool
    request_sha256: str
