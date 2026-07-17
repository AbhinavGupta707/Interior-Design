"""Bounded deterministic projection of registered observations into proposal geometry."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from .canonical import sha256_json
from .errors import (
    FittingAbstention,
    WorkCancelled,
    WorkDeadlineExceeded,
    WorkLimitExceeded,
)
from .geometry import (
    Point2,
    canonical_cycle,
    canonical_polygon2,
    point2_json,
    point3_json,
    polygons_overlap,
    rectangle_from_vertical_boundary,
    rotate_e9,
    scaled_dimension,
    segment_contains,
    segment_length_mm,
    transform_point,
    transform_preserves_up,
    validate_simple_polygon,
    validate_wall_network,
)
from .types import (
    BoundaryObservation,
    FittingRequest,
    FixedObjectHint,
    JsonObject,
    JsonValue,
    LevelHint,
    Observation,
    OpeningObservation,
    PlaneObservation,
    Point3,
    RegisteredSource,
    RoomHint,
    StairHint,
)

MINIMUM_GEOMETRY_CONFIDENCE = 1_000
LEVEL_TOLERANCE_MM = 20


@dataclass(slots=True)
class WorkGuard:
    """Cooperative cancellation, monotonic deadline and deterministic work ceiling."""

    deadline: float
    maximum_work_units: int
    cancelled: Callable[[], bool]
    clock: Callable[[], float]
    work_units: int = 0

    @classmethod
    def create(
        cls,
        timeout_milliseconds: int,
        maximum_work_units: int,
        *,
        cancelled: Callable[[], bool] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> WorkGuard:
        return cls(
            deadline=clock() + timeout_milliseconds / 1_000,
            maximum_work_units=maximum_work_units,
            cancelled=cancelled or (lambda: False),
            clock=clock,
        )

    def check(self, cost: int = 1) -> None:
        if cost < 0:
            raise ValueError("work-unit cost cannot be negative")
        if self.cancelled():
            raise WorkCancelled
        self.work_units += cost
        if self.work_units > self.maximum_work_units:
            raise WorkLimitExceeded
        if self.clock() >= self.deadline:
            raise WorkDeadlineExceeded


@dataclass(frozen=True, slots=True)
class Claim:
    source: RegisteredSource
    observation_ids: tuple[str, ...]
    confidence_basis_points: int


@dataclass(slots=True)
class LevelCandidate:
    level_key: str
    elevation_mm: int
    storey_height_mm: int
    claims: list[Claim] = field(default_factory=list)
    names: set[str] = field(default_factory=set)


@dataclass(slots=True)
class WallCandidate:
    level_key: str
    path: tuple[Point2, Point2]
    bottom_mm: int
    top_mm: int
    claims: list[Claim] = field(default_factory=list)


@dataclass(slots=True)
class SurfaceCandidate:
    level_key: str
    kind: str
    boundary: tuple[Point3, ...]
    claims: list[Claim] = field(default_factory=list)


@dataclass(slots=True)
class BoundaryCandidate:
    level_key: str
    polygon: tuple[Point2, ...]
    claims: list[Claim] = field(default_factory=list)
    room_claims: list[Claim] = field(default_factory=list)
    names: set[str] = field(default_factory=set)
    classifications: set[str] = field(default_factory=set)
    occluded_edges: set[tuple[Point2, Point2]] = field(default_factory=set)
    partial: bool = False


@dataclass(slots=True)
class OpeningCandidate:
    wall_key: tuple[str, tuple[Point2, Point2], int, int]
    offset_mm: int
    width_mm: int
    height_mm: int
    sill_height_mm: int
    kinds: set[str] = field(default_factory=set)
    claims: list[Claim] = field(default_factory=list)


@dataclass(slots=True)
class StairCandidate:
    from_level_key: str
    to_level_key: str
    path: tuple[Point2, ...]
    width_mm: int
    step_count: int
    total_rise_mm: int
    total_run_mm: int
    claims: list[Claim] = field(default_factory=list)


@dataclass(slots=True)
class FixedObjectCandidate:
    level_key: str
    category: str
    position: Point3
    dimensions: tuple[int, int, int]
    rotation_milli_degrees: int | None
    claims: list[Claim] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class UnknownCandidate:
    reason: str
    level_key: str | None
    boundary: tuple[Point3, ...] | None
    claims: tuple[Claim, ...]


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: str
    severity: str
    source_ids: tuple[str, ...]
    observation_ids: tuple[str, ...]


_DIAGNOSTIC_MESSAGES: dict[str, str] = {
    "CLASSIFICATION_CONFLICT": (
        "Registered claims disagree on classification; the field remains unknown."
    ),
    "INCOMPLETE_SPACE_BOUNDARY": "One or more explicitly occluded boundary edges remain unknown.",
    "LOW_CONFIDENCE_OBSERVATION": (
        "A low-confidence observation was retained only as an unknown region."
    ),
    "METRIC_SCALE_ESTIMATED": "Geometry uses an estimated metric scale and requires review.",
    "MISSING_ROOM_HINT": "A bounded region has no supported room classification.",
    "NO_SPACE_BOUNDARIES": "No supported enclosed-space boundary was registered.",
    "OCCLUDED_OBSERVATION": "Occluded evidence was not converted into dimensional geometry.",
    "PARTIAL_REGISTRATION": "A partially registered source requires review.",
    "ROTATION_REMAINS_UNKNOWN": "Object rotation cannot be projected exactly from this transform.",
    "UNKNOWN_SCALE_SOURCE": "An unknown-scale source was excluded from dimensional fitting.",
    "UNSUPPORTED_ASSERTED_GEOMETRY": "User assertions did not establish dimensional geometry.",
    "UNSUPPORTED_PLANE_SEMANTIC": (
        "The plane orientation or semantic is unsupported and remains unknown."
    ),
}


def _stable_id(category: str, value: object) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"c9-scan-to-model:{category}:{sha256_json(value)}"))


def _edge(first: Point2, second: Point2) -> tuple[Point2, Point2]:
    return (first, second) if first <= second else (second, first)


def _claim(source: RegisteredSource, observations: Iterable[Observation]) -> Claim:
    items = tuple(observations)
    return Claim(
        source=source,
        observation_ids=tuple(sorted(item.core.observation_id for item in items)),
        confidence_basis_points=min(item.core.confidence_basis_points for item in items),
    )


def _claim_json(claim: Claim) -> JsonObject:
    source = claim.source
    return {
        "confidenceBasisPoints": claim.confidence_basis_points,
        "evidence": {
            "evidenceId": source.evidence.evidence_id,
            "evidenceSha256": source.evidence.evidence_sha256,
            "schemaVersion": source.evidence.schema_version,
        },
        "observationIds": list(claim.observation_ids),
        "referenceId": source.reference_id,
        "rights": {
            "serviceProcessingConsent": True,
            "trainingUseConsent": "denied",
        },
        "sourceId": source.source_id,
        "sourceSchemaVersion": source.schema_version,
        "sourceSha256": source.source_sha256,
        "state": source.evidence_state,
        "tool": {
            "configSha256": source.tool.config_sha256,
            "name": source.tool.name,
            "toolSha256": source.tool.tool_sha256,
            "version": source.tool.version,
        },
    }


def _provenance(claims: Iterable[Claim], inference: str) -> JsonObject:
    ordered = sorted(
        claims,
        key=lambda claim: (claim.source.source_id, claim.observation_ids),
    )
    if not ordered:
        raise ValueError("proposal geometry requires provenance")
    distinct_sources = {claim.source.source_id for claim in ordered}
    if len(distinct_sources) > 1:
        state = "fused"
        inference_label = "fused-exact"
    elif ordered[0].source.evidence_state == "user-asserted":
        state = "user-asserted"
        inference_label = inference
    else:
        state = "source-derived"
        inference_label = inference
    return {
        "claims": [_claim_json(claim) for claim in ordered],
        "confidenceBasisPoints": min(claim.confidence_basis_points for claim in ordered),
        "inference": inference_label,
        "state": state,
    }


class FitContext:
    def __init__(self, request: FittingRequest, guard: WorkGuard) -> None:
        self.request = request
        self.guard = guard
        self.diagnostics: set[Diagnostic] = set()
        self.unknowns: list[UnknownCandidate] = []
        self._unknown_keys: set[
            tuple[
                str,
                str | None,
                tuple[Point3, ...] | None,
                tuple[tuple[str, tuple[str, ...]], ...],
            ]
        ] = set()
        self.partial = False

    def diagnostic(
        self,
        code: str,
        severity: str,
        claims: Iterable[Claim],
    ) -> None:
        if code not in _DIAGNOSTIC_MESSAGES:
            raise ValueError("unknown diagnostic code")
        items = tuple(claims)
        self.diagnostics.add(
            Diagnostic(
                code,
                severity,
                tuple(sorted({item.source.source_id for item in items})),
                tuple(sorted({obs for item in items for obs in item.observation_ids})),
            )
        )
        if severity != "information":
            self.partial = True

    def unknown(
        self,
        reason: str,
        level_key: str | None,
        boundary: tuple[Point3, ...] | None,
        claims: Iterable[Claim],
    ) -> None:
        canonical_boundary = None if boundary is None else canonical_cycle(boundary)
        ordered_claims = tuple(sorted(claims, key=lambda item: item.source.source_id))
        key = (
            reason,
            level_key,
            canonical_boundary,
            tuple((claim.source.source_id, claim.observation_ids) for claim in ordered_claims),
        )
        if key not in self._unknown_keys:
            self._unknown_keys.add(key)
            self.unknowns.append(
                UnknownCandidate(
                    reason=reason,
                    level_key=level_key,
                    boundary=canonical_boundary,
                    claims=ordered_claims,
                )
            )
        self.partial = True


def _level_projection(source: RegisteredSource, hint: LevelHint) -> tuple[int, int]:
    point = transform_point(Point3(0, 0, hint.elevation_mm), source.transform)
    return point.z, scaled_dimension(hint.storey_height_mm, source.transform)


def _active_source(context: FitContext, source: RegisteredSource) -> bool:
    if source.scale_status == "unknown":
        claims = [_claim(source, source.observations)]
        context.diagnostic("UNKNOWN_SCALE_SOURCE", "warning", claims)
        context.unknown("unknown-scale", None, None, claims)
        return False
    if not transform_preserves_up(source.transform):
        raise FittingAbstention(
            "IMPOSSIBLE_VERTICAL_TRANSFORM", "registered transform does not preserve project up"
        )
    if source.scale_status == "metric-estimated":
        context.diagnostic(
            "METRIC_SCALE_ESTIMATED", "warning", [_claim(source, source.observations)]
        )
    if source.registration_status == "partial":
        context.diagnostic("PARTIAL_REGISTRATION", "warning", [_claim(source, source.observations)])
    return True


def _levels(
    context: FitContext, active_sources: tuple[RegisteredSource, ...]
) -> dict[str, LevelCandidate]:
    levels: dict[str, LevelCandidate] = {}
    asserted: list[tuple[RegisteredSource, LevelHint]] = []
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, LevelHint):
                continue
            context.guard.check()
            if source.kind == "user-assertion-set":
                asserted.append((source, observation))
                continue
            elevation, height = _level_projection(source, observation)
            candidate = levels.get(observation.level_key)
            claim = _claim(source, [observation])
            if candidate is None:
                candidate = LevelCandidate(observation.level_key, elevation, height)
                levels[observation.level_key] = candidate
            elif (candidate.elevation_mm, candidate.storey_height_mm) != (elevation, height):
                raise FittingAbstention(
                    "CONFLICTING_LEVEL_GEOMETRY", "registered level dimensions disagree"
                )
            candidate.claims.append(claim)
            if observation.name is not None:
                candidate.names.add(observation.name)
    for source, observation in asserted:
        context.guard.check()
        candidate = levels.get(observation.level_key)
        claim = _claim(source, [observation])
        if candidate is None:
            context.diagnostic("UNSUPPORTED_ASSERTED_GEOMETRY", "warning", [claim])
            context.unknown("user-asserted-only", observation.level_key, None, [claim])
            continue
        elevation, height = _level_projection(source, observation)
        if (candidate.elevation_mm, candidate.storey_height_mm) != (elevation, height):
            raise FittingAbstention(
                "CONFLICTING_LEVEL_GEOMETRY",
                "asserted and source-derived level dimensions disagree",
            )
        candidate.claims.append(claim)
        if observation.name is not None:
            candidate.names.add(observation.name)
    if not levels:
        raise FittingAbstention("NO_SUPPORTED_LEVELS", "no evidence-backed level hint is usable")
    ordered = sorted(levels.values(), key=lambda item: (item.elevation_mm, item.level_key))
    if len({item.elevation_mm for item in ordered}) != len(ordered):
        raise FittingAbstention("OVERLAPPING_LEVELS", "distinct levels share one elevation")
    for lower, upper in zip(ordered, ordered[1:], strict=False):
        if lower.elevation_mm + lower.storey_height_mm > upper.elevation_mm + LEVEL_TOLERANCE_MM:
            raise FittingAbstention("OVERLAPPING_LEVELS", "level vertical extents overlap")
    return levels


def _observation_unknown(
    context: FitContext,
    source: RegisteredSource,
    observation: Observation,
    *,
    level_key: str | None,
    boundary: tuple[Point3, ...] | None = None,
) -> bool:
    claim = _claim(source, [observation])
    if observation.core.coverage == "occluded":
        context.diagnostic("OCCLUDED_OBSERVATION", "warning", [claim])
        context.unknown("occluded", level_key, boundary, [claim])
        return True
    if observation.core.confidence_basis_points < MINIMUM_GEOMETRY_CONFIDENCE:
        context.diagnostic("LOW_CONFIDENCE_OBSERVATION", "warning", [claim])
        context.unknown("low-confidence", level_key, boundary, [claim])
        return True
    return False


def _planes(
    context: FitContext,
    active_sources: tuple[RegisteredSource, ...],
    levels: dict[str, LevelCandidate],
) -> tuple[
    dict[tuple[str, tuple[Point2, Point2], int, int], WallCandidate],
    dict[tuple[str, str, tuple[Point3, ...]], SurfaceCandidate],
    dict[tuple[str, str], tuple[str, tuple[Point2, Point2], int, int]],
]:
    walls: dict[tuple[str, tuple[Point2, Point2], int, int], WallCandidate] = {}
    surfaces: dict[tuple[str, str, tuple[Point3, ...]], SurfaceCandidate] = {}
    host_map: dict[tuple[str, str], tuple[str, tuple[Point2, Point2], int, int]] = {}
    wall_extents: dict[tuple[str, tuple[Point2, Point2]], tuple[int, int]] = {}
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, PlaneObservation):
                continue
            context.guard.check(len(observation.boundary))
            transformed = canonical_cycle(
                tuple(transform_point(point, source.transform) for point in observation.boundary)
            )
            if _observation_unknown(
                context,
                source,
                observation,
                level_key=observation.level_key,
                boundary=transformed,
            ):
                continue
            if source.kind == "user-assertion-set":
                claim = _claim(source, [observation])
                context.diagnostic("UNSUPPORTED_ASSERTED_GEOMETRY", "warning", [claim])
                context.unknown("user-asserted-only", observation.level_key, transformed, [claim])
                continue
            level = levels.get(observation.level_key)
            if level is None:
                raise FittingAbstention(
                    "ORPHAN_LEVEL_REFERENCE", "plane references an unknown level"
                )
            normal = rotate_e9(observation.normal_e9, source.transform)
            claim = _claim(source, [observation])
            if observation.semantic == "wall-face":
                if abs(normal.z) > 2_000_000:
                    raise FittingAbstention(
                        "INVALID_WALL_PLANE", "wall-face normal is not horizontal"
                    )
                path, bottom, top = rectangle_from_vertical_boundary(
                    transformed, "INVALID_WALL_PLANE"
                )
                direction_x = path[1][0] - path[0][0]
                direction_y = path[1][1] - path[0][1]
                if abs(direction_x * normal.x + direction_y * normal.y) > (
                    segment_length_mm(*path) * 2_000_000
                ):
                    raise FittingAbstention(
                        "INVALID_WALL_PLANE", "wall normal is not perpendicular to its path"
                    )
                if bottom < level.elevation_mm - LEVEL_TOLERANCE_MM or top > (
                    level.elevation_mm + level.storey_height_mm + LEVEL_TOLERANCE_MM
                ):
                    raise FittingAbstention(
                        "IMPOSSIBLE_WALL_LEVEL_RELATIONSHIP", "wall is outside its level extent"
                    )
                key = (observation.level_key, path, bottom, top)
                extent_key = (observation.level_key, path)
                previous_extent = wall_extents.get(extent_key)
                if previous_extent is not None and previous_extent != (bottom, top):
                    raise FittingAbstention(
                        "CONFLICTING_WALL_GEOMETRY", "coincident wall claims disagree"
                    )
                wall_extents[extent_key] = (bottom, top)
                wall = walls.setdefault(
                    key, WallCandidate(observation.level_key, path, bottom, top)
                )
                wall.claims.append(claim)
                host_map[(source.source_id, observation.core.observation_id)] = key
            elif observation.semantic in {"floor", "ceiling", "slab"}:
                if abs(normal.z) < 998_000_000:
                    raise FittingAbstention(
                        "INVALID_HORIZONTAL_PLANE", "horizontal semantic has a tilted normal"
                    )
                if len({point.z for point in transformed}) != 1:
                    raise FittingAbstention(
                        "INVALID_HORIZONTAL_PLANE", "horizontal semantic is not planar"
                    )
                polygon = tuple((point.x, point.y) for point in transformed)
                validate_simple_polygon(polygon, "INVALID_HORIZONTAL_PLANE")
                if (
                    observation.semantic == "floor"
                    and abs(transformed[0].z - level.elevation_mm) > LEVEL_TOLERANCE_MM
                ):
                    raise FittingAbstention(
                        "IMPOSSIBLE_SURFACE_LEVEL_RELATIONSHIP", "floor elevation disagrees"
                    )
                if (
                    observation.semantic == "ceiling"
                    and abs(transformed[0].z - (level.elevation_mm + level.storey_height_mm))
                    > LEVEL_TOLERANCE_MM
                ):
                    raise FittingAbstention(
                        "IMPOSSIBLE_SURFACE_LEVEL_RELATIONSHIP", "ceiling elevation disagrees"
                    )
            else:
                context.diagnostic("UNSUPPORTED_PLANE_SEMANTIC", "warning", [claim])
                context.unknown("unsupported", observation.level_key, transformed, [claim])
                continue
            surface_key = (observation.level_key, observation.semantic, transformed)
            surface = surfaces.setdefault(
                surface_key,
                SurfaceCandidate(observation.level_key, observation.semantic, transformed),
            )
            surface.claims.append(claim)
            if observation.core.coverage == "partial":
                context.unknown("partially-observed", observation.level_key, transformed, [claim])
    for level_key in levels:
        level_segments = tuple(
            candidate.path for candidate in walls.values() if candidate.level_key == level_key
        )
        context.guard.check(max(1, len(level_segments) ** 2))
        validate_wall_network(level_segments)
    surface_values = tuple(surfaces.values())
    for index, first in enumerate(surface_values):
        if first.kind == "wall-face":
            continue
        for second in surface_values[index + 1 :]:
            if second.kind == "wall-face" or first.level_key != second.level_key:
                continue
            context.guard.check()
            if first.boundary[0].z != second.boundary[0].z:
                continue
            first_polygon = tuple((point.x, point.y) for point in first.boundary)
            second_polygon = tuple((point.x, point.y) for point in second.boundary)
            if polygons_overlap(first_polygon, second_polygon):
                raise FittingAbstention(
                    "OVERLAPPING_SURFACES", "non-identical coplanar surfaces overlap"
                )
    return walls, surfaces, host_map


def _boundaries(
    context: FitContext,
    active_sources: tuple[RegisteredSource, ...],
    levels: dict[str, LevelCandidate],
) -> tuple[
    dict[tuple[str, tuple[Point2, ...]], BoundaryCandidate],
    dict[tuple[str, str], tuple[str, tuple[Point2, ...]]],
]:
    boundaries: dict[tuple[str, tuple[Point2, ...]], BoundaryCandidate] = {}
    boundary_map: dict[tuple[str, str], tuple[str, tuple[Point2, ...]]] = {}
    deferred_asserted: list[
        tuple[
            RegisteredSource,
            BoundaryObservation,
            tuple[Point3, ...],
            tuple[Point2, ...],
            set[tuple[Point2, Point2]],
        ]
    ] = []
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, BoundaryObservation):
                continue
            context.guard.check(len(observation.polygon))
            raw_transformed = tuple(
                transform_point(point, source.transform) for point in observation.polygon
            )
            transformed = canonical_cycle(raw_transformed)
            if _observation_unknown(
                context,
                source,
                observation,
                level_key=observation.level_key,
                boundary=transformed,
            ):
                continue
            level = levels.get(observation.level_key)
            if level is None:
                raise FittingAbstention(
                    "ORPHAN_LEVEL_REFERENCE", "space boundary references an unknown level"
                )
            if (
                len({point.z for point in transformed}) != 1
                or abs(transformed[0].z - level.elevation_mm) > LEVEL_TOLERANCE_MM
            ):
                raise FittingAbstention(
                    "IMPOSSIBLE_SPACE_LEVEL_RELATIONSHIP", "space boundary is outside its level"
                )
            polygon = canonical_polygon2(tuple((point.x, point.y) for point in transformed))
            validate_simple_polygon(polygon, "INVALID_SPACE_BOUNDARY")
            occluded_edges: set[tuple[Point2, Point2]] = {
                _edge(
                    (raw_transformed[index].x, raw_transformed[index].y),
                    (
                        raw_transformed[(index + 1) % len(raw_transformed)].x,
                        raw_transformed[(index + 1) % len(raw_transformed)].y,
                    ),
                )
                for index in observation.occluded_edge_indices
            }
            if source.kind == "user-assertion-set":
                deferred_asserted.append(
                    (source, observation, transformed, polygon, occluded_edges)
                )
                continue
            key = (observation.level_key, polygon)
            boundary_candidate = boundaries.setdefault(
                key, BoundaryCandidate(observation.level_key, polygon)
            )
            boundary_candidate.claims.append(_claim(source, [observation]))
            boundary_candidate.occluded_edges.update(occluded_edges)
            boundary_candidate.partial = (
                boundary_candidate.partial or observation.core.coverage == "partial"
            )
            boundary_map[(source.source_id, observation.core.observation_id)] = key
    for source, observation, transformed, polygon, occluded_edges in deferred_asserted:
        key = (observation.level_key, polygon)
        claim = _claim(source, [observation])
        asserted_candidate = boundaries.get(key)
        if asserted_candidate is None:
            context.diagnostic("UNSUPPORTED_ASSERTED_GEOMETRY", "warning", [claim])
            context.unknown("user-asserted-only", observation.level_key, transformed, [claim])
            continue
        asserted_candidate.claims.append(claim)
        asserted_candidate.occluded_edges.update(occluded_edges)
        asserted_candidate.partial = (
            asserted_candidate.partial or observation.core.coverage == "partial"
        )
        boundary_map[(source.source_id, observation.core.observation_id)] = key
    values = tuple(boundaries.values())
    for index, first in enumerate(values):
        for second in values[index + 1 :]:
            context.guard.check()
            if first.level_key == second.level_key and polygons_overlap(
                first.polygon, second.polygon
            ):
                raise FittingAbstention("OVERLAPPING_SPACES", "space interiors overlap")
    return boundaries, boundary_map


def _apply_room_hints(
    context: FitContext,
    active_sources: tuple[RegisteredSource, ...],
    boundaries: dict[tuple[str, tuple[Point2, ...]], BoundaryCandidate],
    boundary_map: dict[tuple[str, str], tuple[str, tuple[Point2, ...]]],
) -> None:
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, RoomHint):
                continue
            context.guard.check()
            if _observation_unknown(context, source, observation, level_key=observation.level_key):
                continue
            key = boundary_map.get((source.source_id, observation.boundary_observation_id))
            if key is None or key not in boundaries:
                if source.kind == "user-assertion-set":
                    context.diagnostic(
                        "UNSUPPORTED_ASSERTED_GEOMETRY", "warning", [_claim(source, [observation])]
                    )
                    continue
                raise FittingAbstention("ORPHAN_ROOM_HINT", "room hint has no fitted boundary")
            candidate = boundaries[key]
            if observation.level_key != candidate.level_key:
                raise FittingAbstention("ORPHAN_ROOM_HINT", "room and boundary levels disagree")
            candidate.room_claims.append(_claim(source, [observation]))
            if observation.classification is not None:
                candidate.classifications.add(observation.classification)
            if observation.name is not None:
                candidate.names.add(observation.name)


def _openings(
    context: FitContext,
    active_sources: tuple[RegisteredSource, ...],
    host_map: dict[tuple[str, str], tuple[str, tuple[Point2, Point2], int, int]],
    walls: dict[tuple[str, tuple[Point2, Point2], int, int], WallCandidate],
) -> dict[tuple[tuple[str, tuple[Point2, Point2], int, int], int, int, int, int], OpeningCandidate]:
    openings: dict[
        tuple[tuple[str, tuple[Point2, Point2], int, int], int, int, int, int],
        OpeningCandidate,
    ] = {}
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, OpeningObservation):
                continue
            context.guard.check(len(observation.boundary))
            transformed = canonical_cycle(
                tuple(transform_point(point, source.transform) for point in observation.boundary)
            )
            if _observation_unknown(
                context,
                source,
                observation,
                level_key=observation.level_key,
                boundary=transformed,
            ):
                continue
            if source.kind == "user-assertion-set":
                claim = _claim(source, [observation])
                context.diagnostic("UNSUPPORTED_ASSERTED_GEOMETRY", "warning", [claim])
                context.unknown("user-asserted-only", observation.level_key, transformed, [claim])
                continue
            wall_key = host_map.get((source.source_id, observation.host_plane_observation_id))
            if wall_key is None or wall_key not in walls:
                raise FittingAbstention("ORPHAN_OPENING", "opening has no fitted wall host")
            if wall_key[0] != observation.level_key:
                raise FittingAbstention("ORPHAN_OPENING", "opening and host levels disagree")
            opening_path, bottom, top = rectangle_from_vertical_boundary(
                transformed, "INVALID_OPENING_GEOMETRY"
            )
            wall = walls[wall_key]
            if not segment_contains(wall.path, opening_path):
                raise FittingAbstention("ORPHAN_OPENING", "opening is outside the host wall")
            if bottom < wall.bottom_mm or top > wall.top_mm:
                raise FittingAbstention("ORPHAN_OPENING", "opening exceeds the host wall extent")
            width = segment_length_mm(*opening_path)
            height = top - bottom
            offset = min(
                segment_length_mm(wall.path[0], opening_path[0]),
                segment_length_mm(wall.path[0], opening_path[1]),
            )
            key = (wall_key, offset, width, height, bottom - wall.bottom_mm)
            candidate = openings.setdefault(
                key,
                OpeningCandidate(
                    wall_key,
                    offset,
                    width,
                    height,
                    bottom - wall.bottom_mm,
                ),
            )
            candidate.kinds.add(observation.opening_kind)
            candidate.claims.append(_claim(source, [observation]))
            if observation.core.coverage == "partial":
                context.unknown(
                    "partially-observed", observation.level_key, transformed, candidate.claims
                )
    by_wall: dict[tuple[str, tuple[Point2, Point2], int, int], list[OpeningCandidate]] = {}
    for opening in openings.values():
        by_wall.setdefault(opening.wall_key, []).append(opening)
    for values in by_wall.values():
        ordered = sorted(values, key=lambda item: (item.offset_mm, item.width_mm))
        for first, second in zip(ordered, ordered[1:], strict=False):
            if first.offset_mm + first.width_mm > second.offset_mm:
                raise FittingAbstention("OVERLAPPING_OPENINGS", "hosted openings overlap")
    return openings


def _stairs(
    context: FitContext,
    active_sources: tuple[RegisteredSource, ...],
    levels: dict[str, LevelCandidate],
) -> dict[tuple[object, ...], StairCandidate]:
    stairs: dict[tuple[object, ...], StairCandidate] = {}
    ordered_levels = sorted(levels.values(), key=lambda item: item.elevation_mm)
    adjacency = {
        (lower.level_key, upper.level_key)
        for lower, upper in zip(ordered_levels, ordered_levels[1:], strict=False)
    }
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, StairHint):
                continue
            context.guard.check(len(observation.path))
            transformed = tuple(
                transform_point(point, source.transform) for point in observation.path
            )
            if _observation_unknown(
                context,
                source,
                observation,
                level_key=observation.from_level_key,
                boundary=transformed,
            ):
                continue
            claim = _claim(source, [observation])
            if source.kind == "user-assertion-set":
                context.diagnostic("UNSUPPORTED_ASSERTED_GEOMETRY", "warning", [claim])
                context.unknown(
                    "user-asserted-only", observation.from_level_key, transformed, [claim]
                )
                continue
            start = levels.get(observation.from_level_key)
            end = levels.get(observation.to_level_key)
            if (
                start is None
                or end is None
                or (
                    observation.from_level_key,
                    observation.to_level_key,
                )
                not in adjacency
            ):
                raise FittingAbstention(
                    "IMPOSSIBLE_STAIR_LEVEL_RELATIONSHIP",
                    "stair must join adjacent ascending levels",
                )
            rise = scaled_dimension(observation.total_rise_mm, source.transform)
            run = scaled_dimension(observation.total_run_mm, source.transform)
            if abs((end.elevation_mm - start.elevation_mm) - rise) > LEVEL_TOLERANCE_MM:
                raise FittingAbstention(
                    "IMPOSSIBLE_STAIR_LEVEL_RELATIONSHIP", "stair rise disagrees with levels"
                )
            path = tuple((point.x, point.y) for point in transformed)
            if any(first == second for first, second in zip(path, path[1:], strict=False)):
                raise FittingAbstention("DEGENERATE_STAIR", "stair path is degenerate")
            measured_run = sum(
                segment_length_mm(first, second)
                for first, second in zip(path, path[1:], strict=False)
            )
            if abs(measured_run - run) > LEVEL_TOLERANCE_MM:
                raise FittingAbstention("DEGENERATE_STAIR", "stair run disagrees with its path")
            width = scaled_dimension(observation.width_mm, source.transform)
            key = (
                observation.from_level_key,
                observation.to_level_key,
                path,
                width,
                observation.step_count,
                rise,
                run,
            )
            candidate = stairs.setdefault(
                key,
                StairCandidate(
                    observation.from_level_key,
                    observation.to_level_key,
                    path,
                    width,
                    observation.step_count,
                    rise,
                    run,
                ),
            )
            candidate.claims.append(claim)
    return stairs


def _fixed_objects(
    context: FitContext,
    active_sources: tuple[RegisteredSource, ...],
    levels: dict[str, LevelCandidate],
) -> dict[tuple[object, ...], FixedObjectCandidate]:
    objects: dict[tuple[object, ...], FixedObjectCandidate] = {}
    for source in active_sources:
        for observation in source.observations:
            if not isinstance(observation, FixedObjectHint):
                continue
            context.guard.check()
            position = transform_point(observation.position, source.transform)
            if _observation_unknown(
                context,
                source,
                observation,
                level_key=observation.level_key,
                boundary=(position,),
            ):
                continue
            level = levels.get(observation.level_key)
            if level is None:
                raise FittingAbstention(
                    "ORPHAN_LEVEL_REFERENCE", "fixed object references an unknown level"
                )
            dimensions = (
                scaled_dimension(observation.width_mm, source.transform),
                scaled_dimension(observation.depth_mm, source.transform),
                scaled_dimension(observation.height_mm, source.transform),
            )
            if position.z < level.elevation_mm - LEVEL_TOLERANCE_MM or (
                position.z + dimensions[2]
                > level.elevation_mm + level.storey_height_mm + LEVEL_TOLERANCE_MM
            ):
                raise FittingAbstention(
                    "IMPOSSIBLE_OBJECT_LEVEL_RELATIONSHIP", "fixed object is outside its level"
                )
            identity_rotation = source.transform.rotation == (1_000_000_000, 0, 0, 0)
            rotation = observation.rotation_milli_degrees if identity_rotation else None
            claim = _claim(source, [observation])
            if rotation is None:
                context.diagnostic("ROTATION_REMAINS_UNKNOWN", "warning", [claim])
            key = (observation.level_key, observation.category, position, dimensions, rotation)
            candidate = objects.setdefault(
                key,
                FixedObjectCandidate(
                    observation.level_key,
                    observation.category,
                    position,
                    dimensions,
                    rotation,
                ),
            )
            candidate.claims.append(claim)
    values = tuple(objects.values())
    for index, first in enumerate(values):
        for second in values[index + 1 :]:
            if first.level_key != second.level_key:
                continue
            context.guard.check()
            overlap_x = abs(first.position.x - second.position.x) * 2 < (
                first.dimensions[0] + second.dimensions[0]
            )
            overlap_y = abs(first.position.y - second.position.y) * 2 < (
                first.dimensions[1] + second.dimensions[1]
            )
            overlap_z = max(first.position.z, second.position.z) < min(
                first.position.z + first.dimensions[2],
                second.position.z + second.dimensions[2],
            )
            if overlap_x and overlap_y and overlap_z:
                raise FittingAbstention(
                    "OVERLAPPING_FIXED_OBJECTS", "non-identical fixed objects overlap"
                )
    return objects


def _diagnostics_json(context: FitContext) -> list[JsonValue]:
    return [
        {
            "code": item.code,
            "message": _DIAGNOSTIC_MESSAGES[item.code],
            "observationIds": list(item.observation_ids),
            "severity": item.severity,
            "sourceIds": list(item.source_ids),
        }
        for item in sorted(
            context.diagnostics,
            key=lambda value: (value.code, value.source_ids, value.observation_ids),
        )
    ]


def fit_proposal(request: FittingRequest, guard: WorkGuard) -> JsonObject:
    """Fit a proposal or raise a safe abstention/cancellation/resource signal."""

    context = FitContext(request, guard)
    guard.check()
    active_sources = tuple(source for source in request.sources if _active_source(context, source))
    if not active_sources:
        raise FittingAbstention("NO_METRIC_SOURCES", "no source has a usable metric scale")
    levels = _levels(context, active_sources)
    walls, surfaces, host_map = _planes(context, active_sources, levels)
    boundaries, boundary_map = _boundaries(context, active_sources, levels)
    _apply_room_hints(context, active_sources, boundaries, boundary_map)
    openings = _openings(context, active_sources, host_map, walls)
    stairs = _stairs(context, active_sources, levels)
    fixed_objects = _fixed_objects(context, active_sources, levels)

    level_ids = {
        key: _stable_id(
            "level",
            {
                "elevationMm": candidate.elevation_mm,
                "levelKey": key,
                "storeyHeightMm": candidate.storey_height_mm,
            },
        )
        for key, candidate in levels.items()
    }
    wall_ids = {
        key: _stable_id(
            "wall",
            {
                "bottomMm": candidate.bottom_mm,
                "levelId": level_ids[candidate.level_key],
                "path": [point2_json(point) for point in candidate.path],
                "topMm": candidate.top_mm,
            },
        )
        for key, candidate in walls.items()
    }

    level_output: list[JsonValue] = []
    for key, level_candidate in levels.items():
        names = sorted(level_candidate.names)
        if len(names) > 1:
            context.diagnostic("CLASSIFICATION_CONFLICT", "warning", level_candidate.claims)
        level_output.append(
            {
                "elevationMm": level_candidate.elevation_mm,
                "id": level_ids[key],
                "levelKey": key,
                "name": names[0] if len(names) == 1 else None,
                "provenance": _provenance(level_candidate.claims, "level-hint-projected"),
                "storeyHeightMm": level_candidate.storey_height_mm,
                "unknownFields": [] if len(names) == 1 else ["name"],
            }
        )

    wall_output: list[JsonValue] = [
        {
            "alignment": "centre",
            "baseOffsetMm": candidate.bottom_mm - levels[candidate.level_key].elevation_mm,
            "heightMm": candidate.top_mm - candidate.bottom_mm,
            "id": wall_ids[key],
            "levelId": level_ids[candidate.level_key],
            "path": [point2_json(point) for point in candidate.path],
            "provenance": _provenance(candidate.claims, "plane-projected"),
            "thicknessMm": None,
            "unknownFields": ["structuralRole", "thicknessMm"],
        }
        for key, candidate in walls.items()
    ]
    surface_output: list[JsonValue] = [
        {
            "boundary": [point3_json(point) for point in candidate.boundary],
            "id": _stable_id(
                "surface",
                {
                    "boundary": [point3_json(point) for point in candidate.boundary],
                    "kind": candidate.kind,
                    "levelId": level_ids[candidate.level_key],
                },
            ),
            "kind": candidate.kind,
            "levelId": level_ids[candidate.level_key],
            "provenance": _provenance(candidate.claims, "plane-projected"),
            "unknownFields": ["material", "structuralRole"],
        }
        for candidate in surfaces.values()
    ]

    opening_output: list[JsonValue] = []
    for opening_candidate in openings.values():
        kinds = opening_candidate.kinds - {"unknown"}
        kind = next(iter(kinds)) if len(kinds) == 1 else "opening"
        opening_unknown_fields: list[JsonValue] = ["swing"]
        if len(kinds) != 1 or len(opening_candidate.kinds) > 1:
            opening_unknown_fields.append("kind")
            context.diagnostic("CLASSIFICATION_CONFLICT", "warning", opening_candidate.claims)
        opening_output.append(
            {
                "heightMm": opening_candidate.height_mm,
                "hostWallId": wall_ids[opening_candidate.wall_key],
                "id": _stable_id(
                    "opening",
                    {
                        "heightMm": opening_candidate.height_mm,
                        "hostWallId": wall_ids[opening_candidate.wall_key],
                        "offsetAlongHostMm": opening_candidate.offset_mm,
                        "sillHeightMm": opening_candidate.sill_height_mm,
                        "widthMm": opening_candidate.width_mm,
                    },
                ),
                "kind": kind,
                "offsetAlongHostMm": opening_candidate.offset_mm,
                "provenance": _provenance(opening_candidate.claims, "opening-projected"),
                "sillHeightMm": opening_candidate.sill_height_mm,
                "unknownFields": sorted(opening_unknown_fields, key=str),
                "widthMm": opening_candidate.width_mm,
            }
        )

    space_output: list[JsonValue] = []
    if not boundaries:
        context.diagnostic("NO_SPACE_BOUNDARIES", "warning", [])
    for space_candidate in boundaries.values():
        bounded_ids: set[str] = set()
        for index, start in enumerate(space_candidate.polygon):
            end = space_candidate.polygon[(index + 1) % len(space_candidate.polygon)]
            edge = _edge(start, end)
            hosts = [
                wall_ids[key]
                for key, wall in walls.items()
                if wall.level_key == space_candidate.level_key and segment_contains(wall.path, edge)
            ]
            if not hosts:
                if edge in space_candidate.occluded_edges or space_candidate.partial:
                    context.diagnostic(
                        "INCOMPLETE_SPACE_BOUNDARY", "warning", space_candidate.claims
                    )
                    boundary3 = (
                        Point3(
                            start[0],
                            start[1],
                            levels[space_candidate.level_key].elevation_mm,
                        ),
                        Point3(
                            end[0],
                            end[1],
                            levels[space_candidate.level_key].elevation_mm,
                        ),
                    )
                    context.unknown(
                        "occluded-boundary-edge",
                        space_candidate.level_key,
                        boundary3,
                        space_candidate.claims,
                    )
                    continue
                raise FittingAbstention(
                    "UNHOSTED_SPACE_BOUNDARY", "observed space edge has no fitted wall"
                )
            bounded_ids.update(hosts)
        if len(space_candidate.classifications) > 1 or len(space_candidate.names) > 1:
            context.diagnostic(
                "CLASSIFICATION_CONFLICT",
                "warning",
                [*space_candidate.claims, *space_candidate.room_claims],
            )
        if not space_candidate.room_claims:
            context.diagnostic("MISSING_ROOM_HINT", "warning", space_candidate.claims)
        classification = (
            next(iter(space_candidate.classifications))
            if len(space_candidate.classifications) == 1
            else None
        )
        name = next(iter(space_candidate.names)) if len(space_candidate.names) == 1 else None
        space_unknown_fields: list[JsonValue] = []
        if classification is None:
            space_unknown_fields.append("classification")
        if name is None:
            space_unknown_fields.append("name")
        all_claims = [*space_candidate.claims, *space_candidate.room_claims]
        bounded_id_values: list[JsonValue] = []
        bounded_id_values.extend(sorted(bounded_ids))
        space_output.append(
            {
                "boundedByWallIds": bounded_id_values,
                "boundary": [point2_json(point) for point in space_candidate.polygon],
                "classification": classification,
                "id": _stable_id(
                    "space",
                    {
                        "boundary": [point2_json(point) for point in space_candidate.polygon],
                        "levelId": level_ids[space_candidate.level_key],
                    },
                ),
                "levelId": level_ids[space_candidate.level_key],
                "name": name,
                "provenance": _provenance(all_claims, "boundary-projected"),
                "unknownFields": sorted(space_unknown_fields, key=str),
            }
        )

    stair_output: list[JsonValue] = [
        {
            "fromLevelId": level_ids[candidate.from_level_key],
            "id": _stable_id(
                "stair",
                {
                    "fromLevelId": level_ids[candidate.from_level_key],
                    "path": [point2_json(point) for point in candidate.path],
                    "toLevelId": level_ids[candidate.to_level_key],
                    "widthMm": candidate.width_mm,
                },
            ),
            "path": [point2_json(point) for point in candidate.path],
            "provenance": _provenance(candidate.claims, "stair-hint-projected"),
            "stepCount": candidate.step_count,
            "toLevelId": level_ids[candidate.to_level_key],
            "totalRiseMm": candidate.total_rise_mm,
            "totalRunMm": candidate.total_run_mm,
            "unknownFields": ["compliance", "construction"],
            "widthMm": candidate.width_mm,
        }
        for candidate in stairs.values()
    ]

    fixed_output: list[JsonValue] = [
        {
            "category": candidate.category,
            "dimensionsMm": {
                "depthMm": candidate.dimensions[1],
                "heightMm": candidate.dimensions[2],
                "widthMm": candidate.dimensions[0],
            },
            "id": _stable_id(
                "fixed-object",
                {
                    "category": candidate.category,
                    "dimensions": candidate.dimensions,
                    "levelId": level_ids[candidate.level_key],
                    "position": point3_json(candidate.position),
                },
            ),
            "levelId": level_ids[candidate.level_key],
            "position": point3_json(candidate.position),
            "provenance": _provenance(candidate.claims, "fixed-object-hint-projected"),
            "rotationMilliDegrees": candidate.rotation_milli_degrees,
            "unknownFields": (
                ["rotationMilliDegrees"] if candidate.rotation_milli_degrees is None else []
            ),
        }
        for candidate in fixed_objects.values()
    ]

    unknown_output: list[JsonValue] = []
    for unknown in context.unknowns:
        provenance = _provenance(unknown.claims, "unknown-preserved")
        value: JsonObject = {
            "boundary": (
                None
                if unknown.boundary is None
                else [point3_json(point) for point in unknown.boundary]
            ),
            "id": _stable_id(
                "unknown-region",
                {
                    "boundary": (
                        None
                        if unknown.boundary is None
                        else [point3_json(point) for point in unknown.boundary]
                    ),
                    "levelId": (
                        None if unknown.level_key is None else level_ids.get(unknown.level_key)
                    ),
                    "reason": unknown.reason,
                    "sourceIds": sorted({claim.source.source_id for claim in unknown.claims}),
                },
            ),
            "levelId": None if unknown.level_key is None else level_ids.get(unknown.level_key),
            "provenance": provenance,
            "reason": unknown.reason,
        }
        unknown_output.append(value)

    geometry: JsonObject = {
        "fixedObjects": sorted(fixed_output, key=lambda item: str(item)),
        "levels": sorted(level_output, key=lambda item: str(item)),
        "openings": sorted(opening_output, key=lambda item: str(item)),
        "spaces": sorted(space_output, key=lambda item: str(item)),
        "stairs": sorted(stair_output, key=lambda item: str(item)),
        "surfaces": sorted(surface_output, key=lambda item: str(item)),
        "walls": sorted(wall_output, key=lambda item: str(item)),
    }
    return {
        "coordinateSystem": {
            "axes": {"x": "east", "y": "north", "z": "up"},
            "handedness": "right",
            "kind": "local-cartesian",
            "lengthUnit": "mm",
        },
        "diagnostics": _diagnostics_json(context),
        "geometry": geometry,
        "status": "partial-proposal" if context.partial else "proposal",
        "unknownRegions": sorted(unknown_output, key=lambda item: str(item)),
        "workUnits": guard.work_units,
    }
