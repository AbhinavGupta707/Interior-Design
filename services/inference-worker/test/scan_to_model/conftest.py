"""Deterministic synthetic C9 semantic-fitting fixtures."""

from __future__ import annotations

import copy
import uuid
from typing import cast

from inference_worker.scan_to_model import source_manifest_sha256


def fixture_uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"c9-scan-to-model-test:{name}"))


def point(x: int, y: int, z: int) -> dict[str, int]:
    return {"xMm": x, "yMm": y, "zMm": z}


def observation_id(source_name: str, name: str) -> str:
    return fixture_uuid(f"{source_name}:{name}")


def level(source_name: str, key: str, elevation: int) -> dict[str, object]:
    return {
        "confidenceBasisPoints": 9_500,
        "coverage": "observed",
        "elevationMm": elevation,
        "levelKey": key,
        "name": "Ground floor" if key == "ground" else "First floor",
        "observationId": observation_id(source_name, f"level:{key}"),
        "observationType": "level-hint",
        "storeyHeightMm": 3_000,
    }


def wall(
    source_name: str,
    level_key: str,
    name: str,
    start: tuple[int, int],
    end: tuple[int, int],
    bottom: int,
    top: int,
) -> dict[str, object]:
    dx = end[0] - start[0]
    normal = {"xE9": 0, "yE9": 1_000_000_000, "zE9": 0}
    if dx == 0:
        normal = {"xE9": 1_000_000_000, "yE9": 0, "zE9": 0}
    return {
        "boundary": [
            point(start[0], start[1], bottom),
            point(end[0], end[1], bottom),
            point(end[0], end[1], top),
            point(start[0], start[1], top),
        ],
        "confidenceBasisPoints": 9_000,
        "coverage": "observed",
        "levelKey": level_key,
        "normalE9": normal,
        "observationId": observation_id(source_name, f"wall:{level_key}:{name}"),
        "observationType": "plane",
        "semantic": "wall-face",
    }


def boundary(source_name: str, level_key: str, elevation: int) -> dict[str, object]:
    return {
        "confidenceBasisPoints": 9_200,
        "coverage": "observed",
        "levelKey": level_key,
        "observationId": observation_id(source_name, f"boundary:{level_key}"),
        "observationType": "boundary",
        "occludedEdgeIndices": [],
        "polygon": [
            point(0, 0, elevation),
            point(4_000, 0, elevation),
            point(4_000, 4_000, elevation),
            point(0, 4_000, elevation),
        ],
    }


def room(source_name: str, level_key: str) -> dict[str, object]:
    return {
        "boundaryObservationId": observation_id(source_name, f"boundary:{level_key}"),
        "classification": "living-room" if level_key == "ground" else "bedroom",
        "confidenceBasisPoints": 8_800,
        "coverage": "observed",
        "levelKey": level_key,
        "name": "Living room" if level_key == "ground" else "Bedroom",
        "observationId": observation_id(source_name, f"room:{level_key}"),
        "observationType": "room-hint",
    }


def floor_observations(source_name: str, level_key: str, elevation: int) -> list[dict[str, object]]:
    top = elevation + 3_000
    return [
        level(source_name, level_key, elevation),
        wall(source_name, level_key, "south", (0, 0), (4_000, 0), elevation, top),
        wall(source_name, level_key, "east", (4_000, 0), (4_000, 4_000), elevation, top),
        wall(source_name, level_key, "north", (4_000, 4_000), (0, 4_000), elevation, top),
        wall(source_name, level_key, "west", (0, 4_000), (0, 0), elevation, top),
        boundary(source_name, level_key, elevation),
        room(source_name, level_key),
    ]


def source(source_name: str, kind: str, *, include_details: bool) -> dict[str, object]:
    observations = [
        *floor_observations(source_name, "ground", 0),
        *floor_observations(source_name, "first", 3_000),
    ]
    if include_details:
        observations.extend(
            [
                {
                    "boundary": [
                        point(1_000, 0, 0),
                        point(2_000, 0, 0),
                        point(2_000, 0, 2_100),
                        point(1_000, 0, 2_100),
                    ],
                    "confidenceBasisPoints": 9_100,
                    "coverage": "observed",
                    "hostPlaneObservationId": observation_id(source_name, "wall:ground:south"),
                    "kind": "door",
                    "levelKey": "ground",
                    "observationId": observation_id(source_name, "opening:ground:door"),
                    "observationType": "opening",
                },
                {
                    "confidenceBasisPoints": 8_500,
                    "coverage": "observed",
                    "fromLevelKey": "ground",
                    "observationId": observation_id(source_name, "stair:ground:first"),
                    "observationType": "stair-hint",
                    "path": [point(500, 500, 0), point(500, 3_500, 3_000)],
                    "stepCount": 15,
                    "toLevelKey": "first",
                    "totalRiseMm": 3_000,
                    "totalRunMm": 3_000,
                    "widthMm": 900,
                },
                {
                    "category": "fireplace",
                    "confidenceBasisPoints": 8_000,
                    "coverage": "observed",
                    "dimensionsMm": {"depthMm": 400, "heightMm": 1_200, "widthMm": 800},
                    "levelKey": "ground",
                    "observationId": observation_id(source_name, "fixed:fireplace"),
                    "observationType": "fixed-object-hint",
                    "position": point(3_000, 3_000, 0),
                    "rotationMilliDegrees": 0,
                },
            ]
        )
    return {
        "coordinateFrame": "project-local",
        "evidence": {
            "evidenceId": fixture_uuid(f"{source_name}:evidence"),
            "evidenceSha256": "2" * 64 if source_name == "roomplan" else "3" * 64,
            "schemaVersion": "c9-synthetic-evidence-v1",
        },
        "evidenceState": "source-derived",
        "kind": kind,
        "observations": observations,
        "referenceId": fixture_uuid(f"{source_name}:reference"),
        "registrationStatus": "registered",
        "rights": {
            "serviceProcessingConsent": True,
            "trainingUseConsent": "denied",
        },
        "scaleStatus": "metric-validated",
        "schemaVersion": "c9-synthetic-source-v1",
        "sourceId": fixture_uuid(f"{source_name}:source"),
        "sourceSha256": "a" * 64 if source_name == "roomplan" else "b" * 64,
        "tool": {
            "configSha256": "c" * 64,
            "name": "synthetic-fixture",
            "toolSha256": "d" * 64,
            "version": "1.0.0",
        },
        "transform": {
            "rotationQuaternionE9": {"w": 1_000_000_000, "x": 0, "y": 0, "z": 0},
            "scalePartsPerMillion": 1_000_000,
            "translationMm": point(0, 0, 0),
        },
        "unit": "mm",
    }


def request_fixture() -> dict[str, object]:
    manifest: dict[str, object] = {
        "manifestSha256": "0" * 64,
        "schemaVersion": "c9-semantic-source-manifest-v1",
        "sources": [
            source("roomplan", "roomplan-proposal", include_details=True),
            source("plan", "plan-proposal", include_details=False),
        ],
    }
    manifest["manifestSha256"] = source_manifest_sha256(manifest)
    return {
        "baseSnapshot": {
            "modelId": fixture_uuid("model"),
            "profile": "existing",
            "snapshotId": fixture_uuid("snapshot"),
            "snapshotSha256": "e" * 64,
        },
        "cancellation": {"requested": False},
        "jobId": fixture_uuid("job"),
        "limits": {
            "maximumObservations": 10_000,
            "maximumOutputBytes": 8_388_608,
            "maximumSources": 32,
            "maximumVertices": 100_000,
            "maximumWorkUnits": 2_000_000,
            "timeoutMilliseconds": 30_000,
        },
        "projectId": fixture_uuid("project"),
        "schemaVersion": "c9-scan-to-model-request-v1",
        "sourceManifest": manifest,
    }


def cloned_request() -> dict[str, object]:
    return copy.deepcopy(request_fixture())


def manifest_from(request: dict[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", request["sourceManifest"])


def sources_from(request: dict[str, object]) -> list[dict[str, object]]:
    manifest = manifest_from(request)
    return cast("list[dict[str, object]]", manifest["sources"])


def observations_from(source_value: dict[str, object]) -> list[dict[str, object]]:
    return cast("list[dict[str, object]]", source_value["observations"])


def rehash(request: dict[str, object]) -> None:
    manifest = manifest_from(request)
    manifest["manifestSha256"] = source_manifest_sha256(manifest)
