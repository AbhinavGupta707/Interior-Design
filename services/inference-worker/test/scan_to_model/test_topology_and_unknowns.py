"""Adversarial topology, relationship, occlusion and abstention tests."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import cast

import pytest
from inference_worker.scan_to_model import execute_protocol
from inference_worker.scan_to_model.errors import ScanToModelError
from inference_worker.scan_to_model.geometry import validate_wall_network

from .conftest import (
    cloned_request,
    fixture_uuid,
    observation_id,
    observations_from,
    point,
    rehash,
    sources_from,
)


def payload(result: Mapping[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", result["payload"])


def find_observation(
    source: dict[str, object], observation_type: str, suffix: str
) -> dict[str, object]:
    expected = observation_id(
        "roomplan" if source["kind"] == "roomplan-proposal" else "plan", suffix
    )
    for observation in observations_from(source):
        if (
            observation.get("observationType") == observation_type
            and observation.get("observationId") == expected
        ):
            return observation
    raise AssertionError(f"missing fixture observation {suffix}")


def _self_intersecting_space(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    boundary = find_observation(source, "boundary", "boundary:ground")
    boundary["polygon"] = [
        point(0, 0, 0),
        point(4_000, 4_000, 0),
        point(4_000, 0, 0),
        point(0, 4_000, 0),
    ]


def _overlapping_space(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    observations_from(source).extend(
        [
            {
                "confidenceBasisPoints": 9_000,
                "coverage": "observed",
                "levelKey": "ground",
                "observationId": fixture_uuid("overlap-boundary"),
                "observationType": "boundary",
                "occludedEdgeIndices": [],
                "polygon": [
                    point(1_000, 1_000, 0),
                    point(3_000, 1_000, 0),
                    point(3_000, 3_000, 0),
                    point(1_000, 3_000, 0),
                ],
            },
            {
                "boundaryObservationId": fixture_uuid("overlap-boundary"),
                "classification": "hall",
                "confidenceBasisPoints": 9_000,
                "coverage": "observed",
                "levelKey": "ground",
                "name": "Hall",
                "observationId": fixture_uuid("overlap-room"),
                "observationType": "room-hint",
            },
        ]
    )


def _extra_wall(
    request: dict[str, object],
    *,
    start: tuple[int, int],
    end: tuple[int, int],
    name: str,
) -> None:
    source = sources_from(request)[0]
    normal = {"xE9": 0, "yE9": 1_000_000_000, "zE9": 0}
    if start[0] == end[0]:
        normal = {"xE9": 1_000_000_000, "yE9": 0, "zE9": 0}
    observations_from(source).append(
        {
            "boundary": [
                point(*start, 0),
                point(*end, 0),
                point(*end, 3_000),
                point(*start, 3_000),
            ],
            "confidenceBasisPoints": 9_000,
            "coverage": "observed",
            "levelKey": "ground",
            "normalE9": normal,
            "observationId": fixture_uuid(f"extra-wall:{name}"),
            "observationType": "plane",
            "semantic": "wall-face",
        }
    )


def _crossing_wall(request: dict[str, object]) -> None:
    _extra_wall(request, start=(1_000, 2_000), end=(3_000, 2_000), name="crossing-a")
    _extra_wall(request, start=(2_000, 1_000), end=(2_000, 3_000), name="crossing-b")


def _overlapping_wall(request: dict[str, object]) -> None:
    _extra_wall(request, start=(1_000, 0), end=(3_000, 0), name="overlap")


def _overlapping_opening(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    observations_from(source).append(
        {
            "boundary": [
                point(1_500, 0, 0),
                point(2_500, 0, 0),
                point(2_500, 0, 2_000),
                point(1_500, 0, 2_000),
            ],
            "confidenceBasisPoints": 8_000,
            "coverage": "observed",
            "hostPlaneObservationId": observation_id("roomplan", "wall:ground:south"),
            "kind": "door",
            "levelKey": "ground",
            "observationId": fixture_uuid("overlap-opening"),
            "observationType": "opening",
        }
    )


def _impossible_stair(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    stair = find_observation(source, "stair-hint", "stair:ground:first")
    stair["totalRiseMm"] = 2_800


def _conflicting_level(request: dict[str, object]) -> None:
    source = sources_from(request)[1]
    level = find_observation(source, "level-hint", "level:first")
    level["elevationMm"] = 3_100


def _overlapping_fixed_object(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    observations_from(source).append(
        {
            "category": "radiator",
            "confidenceBasisPoints": 8_000,
            "coverage": "observed",
            "dimensionsMm": {"depthMm": 400, "heightMm": 1_200, "widthMm": 800},
            "levelKey": "ground",
            "observationId": fixture_uuid("overlap-fixed"),
            "observationType": "fixed-object-hint",
            "position": point(3_000, 3_000, 0),
            "rotationMilliDegrees": 0,
        }
    )


def _overlapping_surfaces(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    for name, minimum, maximum in (
        ("floor-a", 0, 3_000),
        ("floor-b", 1_000, 4_000),
    ):
        observations_from(source).append(
            {
                "boundary": [
                    point(minimum, minimum, 0),
                    point(maximum, minimum, 0),
                    point(maximum, maximum, 0),
                    point(minimum, maximum, 0),
                ],
                "confidenceBasisPoints": 9_000,
                "coverage": "observed",
                "levelKey": "ground",
                "normalE9": {"xE9": 0, "yE9": 0, "zE9": 1_000_000_000},
                "observationId": fixture_uuid(name),
                "observationType": "plane",
                "semantic": "floor",
            }
        )


def _self_intersecting_wall_boundary(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    wall = find_observation(source, "plane", "wall:ground:south")
    boundary = cast("list[object]", wall["boundary"])
    boundary[1], boundary[2] = boundary[2], boundary[1]


def _misaligned_wall_normal(request: dict[str, object]) -> None:
    source = sources_from(request)[0]
    wall = find_observation(source, "plane", "wall:ground:south")
    wall["normalE9"] = {"xE9": 1_000_000_000, "yE9": 0, "zE9": 0}


@pytest.mark.parametrize(
    ("mutate", "safe_code"),
    [
        (_self_intersecting_space, "INVALID_SPACE_BOUNDARY"),
        (_overlapping_space, "OVERLAPPING_SPACES"),
        (_crossing_wall, "INTERSECTING_WALL_TOPOLOGY"),
        (_overlapping_wall, "OVERLAPPING_WALL_TOPOLOGY"),
        (_overlapping_opening, "OVERLAPPING_OPENINGS"),
        (_impossible_stair, "IMPOSSIBLE_STAIR_LEVEL_RELATIONSHIP"),
        (_conflicting_level, "CONFLICTING_LEVEL_GEOMETRY"),
        (_overlapping_fixed_object, "OVERLAPPING_FIXED_OBJECTS"),
        (_overlapping_surfaces, "OVERLAPPING_SURFACES"),
        (_self_intersecting_wall_boundary, "INVALID_WALL_PLANE"),
        (_misaligned_wall_normal, "INVALID_WALL_PLANE"),
    ],
)
def test_invalid_topology_and_relationships_abstain_without_geometry(
    mutate: Callable[[dict[str, object]], None], safe_code: str
) -> None:
    request = cloned_request()
    mutate(request)
    rehash(request)

    result = execute_protocol(request)

    assert result["status"] == "abstained"
    assert payload(result)["safeCode"] == safe_code
    assert "geometry" not in payload(result)


def test_orphan_opening_is_rejected_during_strict_manifest_validation() -> None:
    request = cloned_request()
    source = sources_from(request)[0]
    opening = find_observation(source, "opening", "opening:ground:door")
    opening["hostPlaneObservationId"] = fixture_uuid("not-a-plane")
    rehash(request)

    with pytest.raises(ScanToModelError, match="INVALID_SOURCE"):
        execute_protocol(request)


def test_occluded_wall_and_partial_boundary_remain_explicit_unknowns() -> None:
    request = cloned_request()
    roomplan, plan = sources_from(request)
    observations_from(plan)[:] = [
        item for item in observations_from(plan) if item["observationType"] == "level-hint"
    ]
    wall = find_observation(roomplan, "plane", "wall:ground:south")
    wall["coverage"] = "occluded"
    opening = find_observation(roomplan, "opening", "opening:ground:door")
    opening["coverage"] = "occluded"
    boundary = find_observation(roomplan, "boundary", "boundary:ground")
    boundary["coverage"] = "partial"
    boundary["occludedEdgeIndices"] = [0]
    rehash(request)

    result = execute_protocol(request)

    assert result["status"] == "partial-proposal"
    fitted = payload(result)
    unknowns = cast("list[dict[str, object]]", fitted["unknownRegions"])
    assert len(unknowns) >= 2
    assert {item["reason"] for item in unknowns} >= {"occluded", "occluded-boundary-edge"}
    codes = {item["code"] for item in cast("list[dict[str, object]]", fitted["diagnostics"])}
    assert {"OCCLUDED_OBSERVATION", "INCOMPLETE_SPACE_BOUNDARY"} <= codes
    assert len(cast("list[object]", cast("dict[str, object]", fitted["geometry"])["walls"])) == 7


def test_unknown_scale_source_is_excluded_with_exact_unknown_provenance() -> None:
    request = cloned_request()
    source = sources_from(request)[1]
    source["coordinateFrame"] = "source-local-arbitrary"
    source["scaleStatus"] = "unknown"
    rehash(request)

    result = execute_protocol(request)

    assert result["status"] == "partial-proposal"
    fitted = payload(result)
    unknowns = cast("list[dict[str, object]]", fitted["unknownRegions"])
    assert any(item["reason"] == "unknown-scale" for item in unknowns)
    assert "UNKNOWN_SCALE_SOURCE" in str(fitted["diagnostics"])
    assert "b" * 64 in str(unknowns)


def test_all_unknown_scale_sources_safely_abstain_from_dimensional_inference() -> None:
    request = cloned_request()
    for source in sources_from(request):
        source["coordinateFrame"] = "source-local-arbitrary"
        source["scaleStatus"] = "unknown"
    rehash(request)

    result = execute_protocol(request)

    assert result["status"] == "abstained"
    assert payload(result)["safeCode"] == "NO_METRIC_SOURCES"


def test_transform_overflow_abstains_instead_of_emitting_out_of_range_geometry() -> None:
    request = cloned_request()
    source = sources_from(request)[0]
    source["coordinateFrame"] = "source-local-metric"
    transform = cast("dict[str, object]", source["transform"])
    transform["translationMm"] = point(10_000_000, 0, 0)
    rehash(request)

    result = execute_protocol(request)

    assert result["status"] == "abstained"
    assert payload(result)["safeCode"] == "GEOMETRY_OVERFLOW"


def test_registered_labels_are_bounded_and_cannot_inject_url_or_command_text() -> None:
    request = cloned_request()
    source = sources_from(request)[0]
    room = find_observation(source, "room-hint", "room:ground")
    room["name"] = "https://attacker.invalid/$(whoami)"
    rehash(request)

    with pytest.raises(ScanToModelError, match="INVALID_OBSERVATION"):
        execute_protocol(request)


def test_valid_t_junction_is_not_misclassified_as_a_crossing() -> None:
    validate_wall_network(
        (
            ((0, 0), (4_000, 0)),
            ((2_000, 0), (2_000, 3_000)),
        )
    )
