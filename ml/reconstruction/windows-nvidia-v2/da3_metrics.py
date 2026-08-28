#!/usr/bin/env python3
"""Validate and compare two fresh DA3 proposal-only runs without exposing private IDs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any

RESULT_SCHEMA = "c14-10-da3-result-v1"
SUMMARY_SCHEMA = "c14-10-da3-repeatability-v1"
ARTIFACTS = {"proposal-cameras.json", "proposal-points.ply"}


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_result(path: Path) -> dict[str, Any]:
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError("result must be an absolute regular file")
    payload = path.read_bytes()
    value = json.loads(payload)
    if not isinstance(value, dict) or payload != canonical_bytes(value) + b"\n":
        raise ValueError("result must be exact canonical JSON")
    if value.get("schemaVersion") != RESULT_SCHEMA:
        raise ValueError("result schema is invalid")
    if value.get("productionAuthority") != "none-proposal-only":
        raise ValueError("result authority is invalid")
    if value.get("dimensionalAccuracy") != "NOT RUN":
        raise ValueError("dimensional accuracy must remain NOT RUN")
    if value.get("representativeAccuracy") != "NOT RUN":
        raise ValueError("representative accuracy must remain NOT RUN")
    artifacts = value.get("artifacts")
    required = ARTIFACTS | (
        {"held-out-render.png"} if value.get("sourceViewCount", 0) >= 4 else set()
    )
    if not isinstance(artifacts, dict) or set(artifacts) != required:
        raise ValueError("result artifacts are incomplete")
    for name, expected in artifacts.items():
        artifact = path.parent / name
        if artifact.is_symlink() or not artifact.is_file() or sha256_file(artifact) != expected:
            raise ValueError("result artifact hash mismatch")
    return value


def finite_number(value: object, label: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be finite")
    return float(value)


def compare(first: dict[str, Any], second: dict[str, Any]) -> dict[str, Any]:
    identity = (
        "candidateId",
        "cohort",
        "configSha256",
        "inputManifestSha256",
        "registeredViewCount",
        "segmentId",
        "selectionSha256",
        "sourceCommit",
        "sourceViewCount",
        "weightSha256",
    )
    if any(first.get(key) != second.get(key) for key in identity):
        raise ValueError("run identity or registration count differs")
    if (first.get("runIndex"), second.get("runIndex")) != (1, 2):
        raise ValueError("repeatability comparison requires run indices one and two")
    artifact_match = first["artifacts"] == second["artifacts"]
    point_delta = abs(
        int(first["geometry"]["retainedPointCount"]) - int(second["geometry"]["retainedPointCount"])
    )
    first_held = first.get("heldOutAppearance")
    second_held = second.get("heldOutAppearance")
    psnr_delta: float | None = None
    coverage_delta: float | None = None
    held_out_quality_status = "NOT RUN"
    held_out_pass = first_held is None and second_held is None
    if isinstance(first_held, dict) and isinstance(second_held, dict):
        psnr_delta = abs(
            finite_number(first_held.get("fullFramePsnrDb"), "first PSNR")
            - finite_number(second_held.get("fullFramePsnrDb"), "second PSNR")
        )
        coverage_delta = abs(
            finite_number(first_held.get("coverageFraction"), "first coverage")
            - finite_number(second_held.get("coverageFraction"), "second coverage")
        )
        held_out_pass = psnr_delta <= 0.01 and coverage_delta <= 1e-6
        held_out_quality_status = (
            "FAILED_ZERO_COVERAGE"
            if finite_number(first_held.get("coverageFraction"), "first coverage") == 0
            and finite_number(second_held.get("coverageFraction"), "second coverage") == 0
            else "OBSERVED_PROPOSAL_RENDER"
        )
    passed = artifact_match and point_delta == 0 and held_out_pass
    source_view_count = int(first["sourceViewCount"])
    connectivity = (
        {
            "basis": "single-joint-multiview-inference",
            "componentCount": 1,
            "connectedViewCount": int(first["registeredViewCount"]),
            "status": "observed-proposal-connectivity",
        }
        if source_view_count >= 2
        else {
            "basis": "single-view-cannot-establish-connectivity",
            "componentCount": None,
            "connectedViewCount": 1,
            "status": "NOT RUN",
        }
    )
    return {
        "artifactHashesExact": artifact_match,
        "candidateId": first["candidateId"],
        "cohort": first["cohort"],
        "connectivity": connectivity,
        "dimensionalAccuracy": "NOT RUN",
        "heldOutCoverageAbsoluteDelta": coverage_delta,
        "heldOutPsnrAbsoluteDeltaDb": psnr_delta,
        "heldOutQualityStatus": held_out_quality_status,
        "maxPeakHostRssBytes": max(
            int(first["peakHostMaxRssBytes"]), int(second["peakHostMaxRssBytes"])
        ),
        "maxPeakTaskVramBytes": max(
            int(first["peakTaskVramBytes"]), int(second["peakTaskVramBytes"])
        ),
        "maxWallSeconds": max(
            finite_number(first["wallSeconds"], "first wall time"),
            finite_number(second["wallSeconds"], "second wall time"),
        ),
        "passed": passed,
        "registeredViewCount": first["registeredViewCount"],
        "representativeAccuracy": "NOT RUN",
        "retainedPointCountAbsoluteDelta": point_delta,
        "segmentKey": hashlib.sha256(str(first["segmentId"]).encode()).hexdigest()[:12],
        "sourceViewCount": source_view_count,
    }


def write_summary(args: argparse.Namespace) -> None:
    first_path = Path(args.run_one)
    second_path = Path(args.run_two)
    first = load_result(first_path)
    second = load_result(second_path)
    comparison = compare(first, second)
    summary = {
        "comparison": comparison,
        "imageId": args.image_id,
        "registrySha256": args.registry_sha256,
        "runResultSha256": [sha256_file(first_path), sha256_file(second_path)],
        "schemaVersion": SUMMARY_SCHEMA,
    }
    output = Path(args.output)
    if not output.is_absolute() or output.exists() or output.is_symlink():
        raise ValueError("output must be a new absolute path")
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(canonical_bytes(summary) + b"\n")
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({"passed": comparison["passed"], "sha256": sha256_file(output)}))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--run-one", required=True)
    value.add_argument("--run-two", required=True)
    value.add_argument("--image-id", required=True)
    value.add_argument("--registry-sha256", required=True)
    value.add_argument("--output", required=True)
    value.set_defaults(function=write_summary)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
