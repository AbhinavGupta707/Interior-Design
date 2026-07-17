"""Deterministic vector, fixture, and bounded CPU raster plan parsing."""

import hashlib
import time
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

from .canonical import canonical_json_bytes
from .schema import NormalizedInputError, parse_normalized_input
from .types import (
    JsonObject,
    JsonValue,
    NormalizedPlan,
    OpeningSegment,
    ParserRequest,
    Point,
    Segment,
)

ADAPTER_ID = "local-plan-parser"
ADAPTER_VERSION = "1.0.0"
RESULT_SCHEMA_VERSION = "c6-plan-proposal-v1"
DETERMINISTIC_CREATED_AT = "1970-01-01T00:00:00.000Z"
MINIMUM_PROPOSAL_CONFIDENCE = 75


class ParserDeadlineExceeded(RuntimeError):
    """Internal bounded deadline signal."""


class ParserCancelled(RuntimeError):
    """Internal monotonic cancellation signal."""


@dataclass(frozen=True, slots=True)
class WorkGuard:
    """Cooperative cancellation and deadline guard for CPU loops."""

    deadline: float
    cancelled: Callable[[], bool]

    @classmethod
    def for_timeout(
        cls, timeout_milliseconds: int, cancelled: Callable[[], bool] | None = None
    ) -> "WorkGuard":
        return cls(
            deadline=time.monotonic() + (timeout_milliseconds / 1_000),
            cancelled=cancelled or (lambda: False),
        )

    def check(self) -> None:
        if self.cancelled():
            raise ParserCancelled
        if time.monotonic() >= self.deadline:
            raise ParserDeadlineExceeded


@dataclass(frozen=True, slots=True)
class GeometryAbstention(ValueError):
    """A safe geometry failure that must not become a proposal."""

    code: str
    detail: str
    finding_code: str
    finding_message: str
    severity: str = "error"


def _point_json(point: Point) -> JsonObject:
    return {"x": point.x, "y": point.y}


def _stable_uuid(source_sha256: str, category: str, value: JsonValue) -> str:
    canonical_value = canonical_json_bytes(value).decode("utf-8")
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"c6:{source_sha256}:{category}:{canonical_value}"))


def _proposal_id(request: ParserRequest, normalized_sha256: str) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"c6:{request.job_id}:{normalized_sha256}:{ADAPTER_ID}:{ADAPTER_VERSION}",
        )
    )


def _parser_manifest(request: ParserRequest) -> JsonObject:
    normalizer_name = {
        "deterministic-vector": "vector-normalizer",
        "deterministic-raster": "raster-gray8-normalizer",
        "deterministic-fixture": "fixture-normalizer",
    }[request.parser_mode]
    core: JsonObject = {
        "adapterId": ADAPTER_ID,
        "adapterVersion": ADAPTER_VERSION,
        "mode": request.parser_mode,
        "normalizers": [{"name": normalizer_name, "version": "1.0.0"}],
    }
    manifest_sha256 = hashlib.sha256(canonical_json_bytes(core)).hexdigest()
    return {**core, "manifestSha256": manifest_sha256}


def _finding(
    code: str,
    message: str,
    severity: str,
    *,
    affected_candidate_ids: list[str] | None = None,
    source_region: JsonObject | None = None,
) -> JsonObject:
    result: JsonObject = {
        "affectedCandidateIds": list(affected_candidate_ids or []),
        "code": code,
        "message": message,
        "severity": severity,
    }
    if source_region is not None:
        result["sourceRegion"] = source_region
    return result


def _next_actions(code: str) -> list[JsonValue]:
    by_code: dict[str, list[JsonValue]] = {
        "ambiguous-topology": ["use-manual-editor", "request-professional-input"],
        "invalid-parser-output": ["replace-source", "retry", "use-manual-editor"],
        "low-confidence": ["add-known-dimension", "use-manual-editor"],
        "no-plan-geometry": ["select-another-page", "use-manual-editor"],
        "parser-timeout": ["retry", "use-manual-editor"],
        "parser-unavailable": ["retry", "use-manual-editor"],
        "resource-limit": ["replace-source", "select-another-page", "use-manual-editor"],
        "source-mismatch": ["replace-source", "retry"],
        "unsupported-input": ["replace-source", "use-manual-editor"],
    }
    return by_code.get(code, ["use-manual-editor"])


def make_abstention(
    request: ParserRequest,
    code: str,
    detail: str,
    *,
    normalized_sha256: str | None = None,
    findings: list[JsonValue] | None = None,
) -> JsonObject:
    """Construct a strict c6-plan-proposal-v1 abstention."""

    result: JsonObject = {
        "code": code,
        "createdAt": DETERMINISTIC_CREATED_AT,
        "detail": detail,
        "findings": list(findings or []),
        "jobId": request.job_id,
        "nextActions": _next_actions(code),
        "parser": _parser_manifest(request),
        "projectId": request.project_id,
        "proposalId": _proposal_id(request, normalized_sha256 or request.normalized_input_sha256),
        "retryable": code in {"parser-timeout", "parser-unavailable"},
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "source": request.source,
        "status": "abstained",
    }
    if normalized_sha256 is not None:
        result["normalizedInputSha256"] = normalized_sha256
    return result


def _cross(origin: Point, first: Point, second: Point) -> int:
    return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (
        second.x - origin.x
    )


def _on_segment(start: Point, end: Point, point: Point) -> bool:
    return (
        _cross(start, end, point) == 0
        and min(start.x, end.x) <= point.x <= max(start.x, end.x)
        and min(start.y, end.y) <= point.y <= max(start.y, end.y)
    )


def _segments_intersect(first: Segment, second: Segment) -> bool:
    a = _cross(first.start, first.end, second.start)
    b = _cross(first.start, first.end, second.end)
    c = _cross(second.start, second.end, first.start)
    d = _cross(second.start, second.end, first.end)
    if ((a > 0 and b < 0) or (a < 0 and b > 0)) and ((c > 0 and d < 0) or (c < 0 and d > 0)):
        return True
    return (
        (a == 0 and _on_segment(first.start, first.end, second.start))
        or (b == 0 and _on_segment(first.start, first.end, second.end))
        or (c == 0 and _on_segment(second.start, second.end, first.start))
        or (d == 0 and _on_segment(second.start, second.end, first.end))
    )


def _other_endpoint(segment: Segment, point: Point) -> Point:
    return segment.end if segment.start == point else segment.start


def _validated_cycle(walls: tuple[Segment, ...]) -> tuple[tuple[Segment, ...], tuple[int, ...]]:
    if len(walls) < 3:
        raise GeometryAbstention(
            "no-plan-geometry",
            "The normalized page does not contain a closed room boundary.",
            "NO_PLAN_GEOMETRY",
            "No closed straight-edged room boundary was found.",
            "warning",
        )
    ordered_walls = tuple(
        sorted(
            (wall.canonical() for wall in walls),
            key=lambda wall: (
                wall.start,
                wall.end,
                wall.confidence,
            ),
        )
    )
    geometry_keys = [(wall.start, wall.end) for wall in ordered_walls]
    if len(set(geometry_keys)) != len(geometry_keys):
        raise GeometryAbstention(
            "ambiguous-topology",
            "Duplicate wall geometry prevents a safe proposal.",
            "DUPLICATE_WALL_GEOMETRY",
            "Duplicate wall geometry was detected.",
        )

    adjacency: dict[Point, list[int]] = defaultdict(list)
    for index, wall in enumerate(ordered_walls):
        adjacency[wall.start].append(index)
        adjacency[wall.end].append(index)
    if any(len(incident) != 2 for incident in adjacency.values()):
        raise GeometryAbstention(
            "ambiguous-topology",
            "Wall endpoints do not form one unambiguous closed boundary.",
            "INVALID_WALL_DEGREE",
            "Every boundary endpoint must be hosted by exactly two walls.",
        )

    start = min(adjacency)
    first_index = min(
        adjacency[start], key=lambda index: _other_endpoint(ordered_walls[index], start)
    )
    cycle_indices: list[int] = []
    cycle_points: list[Point] = [start]
    current = start
    previous_index: int | None = None
    next_index = first_index
    while True:
        if next_index in cycle_indices:
            raise GeometryAbstention(
                "ambiguous-topology",
                "Wall traversal repeated before closing the boundary.",
                "REPEATED_BOUNDARY_EDGE",
                "The wall boundary repeats an edge.",
            )
        cycle_indices.append(next_index)
        current = _other_endpoint(ordered_walls[next_index], current)
        if current == start:
            break
        cycle_points.append(current)
        choices = [index for index in adjacency[current] if index != next_index]
        if len(choices) != 1:
            raise GeometryAbstention(
                "ambiguous-topology",
                "Wall traversal is ambiguous.",
                "AMBIGUOUS_BOUNDARY_TRAVERSAL",
                "The wall boundary cannot be traversed unambiguously.",
            )
        previous_index, next_index = next_index, choices[0]
        if previous_index == next_index:
            raise GeometryAbstention(
                "ambiguous-topology",
                "Wall traversal did not advance.",
                "INVALID_BOUNDARY_TRAVERSAL",
                "The wall boundary traversal did not advance.",
            )
    if len(cycle_indices) != len(ordered_walls):
        raise GeometryAbstention(
            "ambiguous-topology",
            "The page contains disconnected wall boundaries.",
            "DISCONNECTED_WALL_GEOMETRY",
            "All proposed walls must belong to one connected boundary.",
        )

    for first_index, first in enumerate(ordered_walls):
        for second_index in range(first_index + 1, len(ordered_walls)):
            second = ordered_walls[second_index]
            if {first.start, first.end}.intersection({second.start, second.end}):
                continue
            if _segments_intersect(first, second):
                raise GeometryAbstention(
                    "ambiguous-topology",
                    "The wall boundary self-intersects.",
                    "SELF_INTERSECTING_BOUNDARY",
                    "A proposed room boundary cannot self-intersect.",
                )

    doubled_area = 0
    for index, point in enumerate(cycle_points):
        following = cycle_points[(index + 1) % len(cycle_points)]
        doubled_area += point.x * following.y - following.x * point.y
    if doubled_area == 0:
        raise GeometryAbstention(
            "ambiguous-topology",
            "The wall boundary has no area.",
            "ZERO_AREA_BOUNDARY",
            "A proposed room boundary must enclose positive area.",
        )
    return ordered_walls, tuple(cycle_indices)


def _strictly_inside_wall(wall: Segment, point: Point) -> bool:
    if not _on_segment(wall.start, wall.end, point):
        return False
    dx = wall.end.x - wall.start.x
    dy = wall.end.y - wall.start.y
    projection = (point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy
    length_squared = dx * dx + dy * dy
    return 0 < projection < length_squared


def _opening_interval(wall: Segment, opening: OpeningSegment) -> tuple[int, int]:
    dx = wall.end.x - wall.start.x
    dy = wall.end.y - wall.start.y
    first = (opening.start.x - wall.start.x) * dx + (opening.start.y - wall.start.y) * dy
    second = (opening.end.x - wall.start.x) * dx + (opening.end.y - wall.start.y) * dy
    return min(first, second), max(first, second)


def _host_openings(
    walls: tuple[Segment, ...], openings: tuple[OpeningSegment, ...]
) -> tuple[tuple[OpeningSegment, int], ...]:
    hosted: list[tuple[OpeningSegment, int]] = []
    for opening in sorted(
        (item.canonical() for item in openings),
        key=lambda item: (item.start, item.end, item.opening_kind, item.confidence),
    ):
        hosts = [
            index
            for index, wall in enumerate(walls)
            if _strictly_inside_wall(wall, opening.start)
            and _strictly_inside_wall(wall, opening.end)
        ]
        if len(hosts) != 1:
            raise GeometryAbstention(
                "ambiguous-topology",
                "An opening is not hosted by exactly one proposed wall.",
                "INVALID_OPENING_HOST",
                "Every proposed opening must be hosted by exactly one wall.",
            )
        hosted.append((opening, hosts[0]))
    for first_index, (first, first_host) in enumerate(hosted):
        first_interval = _opening_interval(walls[first_host], first)
        for second, second_host in hosted[first_index + 1 :]:
            if first_host != second_host:
                continue
            second_interval = _opening_interval(walls[second_host], second)
            if max(first_interval[0], second_interval[0]) < min(
                first_interval[1], second_interval[1]
            ):
                raise GeometryAbstention(
                    "ambiguous-topology",
                    "Hosted openings overlap.",
                    "OVERLAPPING_OPENINGS",
                    "Openings hosted by one wall cannot overlap.",
                )
    return tuple(hosted)


def _region(points: tuple[Point, ...], width: int, height: int) -> JsonObject:
    minimum_x = min(point.x for point in points)
    maximum_x = max(point.x for point in points)
    minimum_y = min(point.y for point in points)
    maximum_y = max(point.y for point in points)
    if minimum_x == maximum_x:
        if maximum_x < width - 1:
            maximum_x += 1
        else:
            minimum_x -= 1
    if minimum_y == maximum_y:
        if maximum_y < height - 1:
            maximum_y += 1
        else:
            minimum_y -= 1
    return {
        "maximum": {"x": maximum_x, "y": maximum_y},
        "minimum": {"x": minimum_x, "y": minimum_y},
    }


def _bands(counts: list[int], required_dark: int) -> tuple[tuple[int, int, int], ...]:
    matching = [index for index, count in enumerate(counts) if count >= required_dark]
    if not matching:
        return ()
    groups: list[tuple[int, int, int]] = []
    start = matching[0]
    previous = start
    for current in matching[1:]:
        if current != previous + 1:
            groups.append((start, previous, (start + previous) // 2))
            start = current
        previous = current
    groups.append((start, previous, (start + previous) // 2))
    return tuple(groups)


def _false_runs(values: list[bool], offset: int) -> tuple[tuple[int, int], ...]:
    runs: list[tuple[int, int]] = []
    run_start: int | None = None
    for index, value in enumerate(values):
        if not value and run_start is None:
            run_start = index
        if value and run_start is not None:
            runs.append((offset + run_start, offset + index - 1))
            run_start = None
    if run_start is not None:
        runs.append((offset + run_start, offset + len(values) - 1))
    return tuple(runs)


def _raster_geometry(plan: NormalizedPlan, guard: WorkGuard) -> NormalizedPlan:
    pixels = plan.raster_pixels
    if pixels is None or plan.width < 8 or plan.height < 8:
        raise GeometryAbstention(
            "no-plan-geometry",
            "The normalized raster is too small to contain supported plan geometry.",
            "NO_RASTER_PLAN_GEOMETRY",
            "No supported raster plan geometry was found.",
            "warning",
        )
    row_counts = [0] * plan.height
    column_counts = [0] * plan.width
    view = memoryview(pixels)
    for y in range(plan.height):
        if y % 64 == 0:
            guard.check()
        row = view[y * plan.width : (y + 1) * plan.width]
        count = 0
        for x, pixel in enumerate(row):
            if pixel <= 127:
                count += 1
                column_counts[x] += 1
        row_counts[y] = count
    horizontal_bands = _bands(row_counts, max(3, plan.width // 3))
    vertical_bands = _bands(column_counts, max(3, plan.height // 3))
    if len(horizontal_bands) != 2 or len(vertical_bands) != 2:
        raise GeometryAbstention(
            "ambiguous-topology",
            "The raster baseline requires exactly one rectangular outer boundary.",
            "RASTER_TOPOLOGY_AMBIGUOUS",
            "The bounded raster baseline found ambiguous line topology.",
        )
    top_band, bottom_band = horizontal_bands
    left_band, right_band = vertical_bands
    top = top_band[2]
    bottom = bottom_band[2]
    left = left_band[2]
    right = right_band[2]
    if right - left < 4 or bottom - top < 4:
        raise GeometryAbstention(
            "no-plan-geometry",
            "The raster boundary is too small.",
            "RASTER_BOUNDARY_TOO_SMALL",
            "The detected raster boundary is too small to propose.",
            "warning",
        )
    for y in range(plan.height):
        if y % 64 == 0:
            guard.check()
        for x in range(plan.width):
            if pixels[y * plan.width + x] > 127:
                continue
            on_horizontal_boundary = (
                top_band[0] <= y <= top_band[1] or bottom_band[0] <= y <= bottom_band[1]
            ) and left_band[0] <= x <= right_band[1]
            on_vertical_boundary = (
                left_band[0] <= x <= left_band[1] or right_band[0] <= x <= right_band[1]
            ) and top_band[0] <= y <= bottom_band[1]
            if not on_horizontal_boundary and not on_vertical_boundary:
                raise GeometryAbstention(
                    "ambiguous-topology",
                    "The raster contains unsupported geometry outside the outer boundary.",
                    "RASTER_GEOMETRY_UNRESOLVED",
                    "The bounded raster baseline found geometry it cannot represent safely.",
                )
    walls = (
        Segment(Point(left, top), Point(right, top), 84),
        Segment(Point(right, top), Point(right, bottom), 84),
        Segment(Point(left, bottom), Point(right, bottom), 84),
        Segment(Point(left, top), Point(left, bottom), 84),
    )
    openings: list[OpeningSegment] = []

    def horizontal_gaps(band: tuple[int, int, int], y: int) -> None:
        coverage = [
            any(pixels[row * plan.width + x] <= 127 for row in range(band[0], band[1] + 1))
            for x in range(left + 1, right)
        ]
        for start, end in _false_runs(coverage, left + 1):
            if end - start + 1 < 2 or end - start + 1 >= (right - left) // 2:
                raise GeometryAbstention(
                    "ambiguous-topology",
                    "A raster line gap is not a supported hosted opening.",
                    "RASTER_OPENING_AMBIGUOUS",
                    "A raster line gap could not be classified safely as an opening.",
                )
            openings.append(
                OpeningSegment(Point(start, y), Point(end, y), 78, "unknown").canonical()
            )

    def vertical_gaps(band: tuple[int, int, int], x: int) -> None:
        coverage = [
            any(pixels[y * plan.width + column] <= 127 for column in range(band[0], band[1] + 1))
            for y in range(top + 1, bottom)
        ]
        for start, end in _false_runs(coverage, top + 1):
            if end - start + 1 < 2 or end - start + 1 >= (bottom - top) // 2:
                raise GeometryAbstention(
                    "ambiguous-topology",
                    "A raster line gap is not a supported hosted opening.",
                    "RASTER_OPENING_AMBIGUOUS",
                    "A raster line gap could not be classified safely as an opening.",
                )
            openings.append(
                OpeningSegment(Point(x, start), Point(x, end), 78, "unknown").canonical()
            )

    horizontal_gaps(top_band, top)
    horizontal_gaps(bottom_band, bottom)
    vertical_gaps(left_band, left)
    vertical_gaps(right_band, right)
    if len(openings) > 4:
        raise GeometryAbstention(
            "ambiguous-topology",
            "The raster contains too many boundary gaps for the bounded baseline.",
            "RASTER_OPENING_LIMIT",
            "Too many raster line gaps were detected.",
        )
    guard.check()
    return NormalizedPlan(
        kind=plan.kind,
        source_sha256=plan.source_sha256,
        width=plan.width,
        height=plan.height,
        walls=walls,
        openings=tuple(openings),
        label_count=0,
        raster_pixels=None,
    )


def _candidate_id(source_sha256: str, kind: str, geometry: JsonObject) -> str:
    return _stable_uuid(source_sha256, kind, geometry)


def _build_proposal(
    request: ParserRequest,
    plan: NormalizedPlan,
    normalized_sha256: str,
    guard: WorkGuard,
) -> JsonObject:
    guard.check()
    if plan.kind == "raster-gray8":
        plan = _raster_geometry(plan, guard)
    walls, cycle_indices = _validated_cycle(plan.walls)
    hosted_openings = _host_openings(walls, plan.openings)
    candidate_count = 2 + len(walls) + len(hosted_openings)
    if candidate_count > request.maximum_candidates:
        return make_abstention(
            request,
            "resource-limit",
            "The normalized plan exceeds the candidate limit.",
            normalized_sha256=normalized_sha256,
        )

    level_geometry: JsonObject = {"elevationMillimetres": 0, "kind": "level"}
    level_id = _candidate_id(request.source_sha256, "level", level_geometry)
    wall_ids: list[str] = []
    for wall in walls:
        wall_ids.append(
            _candidate_id(
                request.source_sha256,
                "wall",
                {"end": _point_json(wall.end), "start": _point_json(wall.start)},
            )
        )

    confidences = [wall.confidence for wall in walls]
    confidences.extend(opening.confidence for opening, _host in hosted_openings)
    overall_confidence = min(confidences, default=0)
    if overall_confidence < MINIMUM_PROPOSAL_CONFIDENCE:
        return make_abstention(
            request,
            "low-confidence",
            "The bounded parser could not produce a proposal above the confidence floor.",
            normalized_sha256=normalized_sha256,
            findings=[
                _finding(
                    "LOW_CONFIDENCE_GEOMETRY",
                    "At least one geometry candidate is below the publication confidence floor.",
                    "warning",
                )
            ],
        )

    all_points = tuple(point for wall in walls for point in (wall.start, wall.end))
    full_region = _region(all_points, plan.width, plan.height)
    candidates: list[JsonValue] = [
        {
            "candidateId": level_id,
            "confidence": min(wall.confidence for wall in walls),
            "elevationMillimetres": 0,
            "kind": "level",
            "sourceRegion": full_region,
            "suggestedName": "Ground floor",
        }
    ]
    for index, wall in enumerate(walls):
        candidates.append(
            {
                "candidateId": wall_ids[index],
                "confidence": wall.confidence,
                "end": _point_json(wall.end),
                "kind": "wall",
                "levelCandidateId": level_id,
                "sourceRegion": _region((wall.start, wall.end), plan.width, plan.height),
                "start": _point_json(wall.start),
            }
        )

    findings: list[JsonValue] = []
    unresolved_regions: list[JsonValue] = []
    if plan.label_count:
        findings.append(
            _finding(
                "UNTRUSTED_TEXT_IGNORED",
                (
                    "Extracted text was retained only as untrusted label data and did not "
                    "control parsing."
                ),
                "information",
            )
        )
    for opening, host_index in hosted_openings:
        geometry: JsonObject = {
            "end": _point_json(opening.end),
            "hostWallCandidateId": wall_ids[host_index],
            "openingKind": opening.opening_kind,
            "start": _point_json(opening.start),
        }
        opening_id = _candidate_id(request.source_sha256, "opening", geometry)
        opening_region = _region((opening.start, opening.end), plan.width, plan.height)
        candidates.append(
            {
                "candidateId": opening_id,
                "confidence": opening.confidence,
                "end": _point_json(opening.end),
                "hostWallCandidateId": wall_ids[host_index],
                "kind": "opening",
                "levelCandidateId": level_id,
                "openingKind": opening.opening_kind,
                "sourceRegion": opening_region,
                "start": _point_json(opening.start),
            }
        )
        if opening.opening_kind == "unknown":
            findings.append(
                _finding(
                    "OPENING_KIND_UNKNOWN",
                    "A hosted opening requires manual classification.",
                    "warning",
                    affected_candidate_ids=[opening_id],
                    source_region=opening_region,
                )
            )
            unresolved_regions.append(
                {
                    "code": "OPENING_KIND_UNKNOWN",
                    "detail": "Classify this hosted opening before creating operations.",
                    "id": _stable_uuid(request.source_sha256, "unresolved-opening", geometry),
                    "nextAction": "correct-manually",
                    "sourceRegion": opening_region,
                }
            )

    boundary_wall_ids = [wall_ids[index] for index in cycle_indices]
    space_geometry: JsonObject = {
        "boundaryWallCandidateIds": list(boundary_wall_ids),
        "kind": "space",
    }
    candidates.append(
        {
            "boundaryWallCandidateIds": list(boundary_wall_ids),
            "candidateId": _candidate_id(request.source_sha256, "space", space_geometry),
            "confidence": min(wall.confidence for wall in walls),
            "kind": "space",
            "levelCandidateId": level_id,
            "sourceRegion": full_region,
            "suggestedName": "Space 1",
        }
    )
    guard.check()
    return {
        "candidates": candidates,
        "createdAt": DETERMINISTIC_CREATED_AT,
        "findings": findings,
        "jobId": request.job_id,
        "normalizedInputSha256": normalized_sha256,
        "overallConfidence": overall_confidence,
        "parser": _parser_manifest(request),
        "projectId": request.project_id,
        "proposalId": _proposal_id(request, normalized_sha256),
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "source": request.source,
        "status": "proposal",
        "unresolvedRegions": unresolved_regions,
    }


def parse_plan(
    request: ParserRequest,
    normalized_value: JsonValue,
    *,
    guard: WorkGuard | None = None,
) -> JsonObject:
    """Parse one normalized page or return an explicit schema-shaped abstention."""

    active_guard = guard or WorkGuard.for_timeout(request.timeout_milliseconds)
    try:
        active_guard.check()
        plan, normalized_sha256 = parse_normalized_input(normalized_value, request)
        return _build_proposal(request, plan, normalized_sha256, active_guard)
    except NormalizedInputError as error:
        return make_abstention(
            request,
            error.abstention_code,
            error.safe_detail,
            normalized_sha256=(
                request.normalized_input_sha256
                if error.abstention_code != "source-mismatch"
                else None
            ),
        )
    except GeometryAbstention as error:
        return make_abstention(
            request,
            error.code,
            error.detail,
            normalized_sha256=request.normalized_input_sha256,
            findings=[
                _finding(
                    error.finding_code,
                    error.finding_message,
                    error.severity,
                )
            ],
        )
    except ParserDeadlineExceeded:
        return make_abstention(
            request,
            "parser-timeout",
            "The bounded parser deadline elapsed.",
            normalized_sha256=request.normalized_input_sha256,
        )
    except ParserCancelled:
        return make_abstention(
            request,
            "parser-unavailable",
            "The parser was cancelled before publication.",
            normalized_sha256=request.normalized_input_sha256,
        )
