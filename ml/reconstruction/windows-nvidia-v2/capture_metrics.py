#!/usr/bin/env python3
"""Build the immutable common C14.9 record from two-run candidate fragments."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any, cast

SCHEMA = "c14-9-capture-benchmark-v1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
TOLERANCES = {
    "cameraMedianRotationErrorDegrees": 0.05,
    "cameraMedianTranslationDirectionErrorDegrees": 0.10,
    "depthAbsRel": 0.005,
    "depthRmseMetres": 0.01,
    "heldoutLpips": 0.001,
    "heldoutPsnrDb": 0.01,
    "heldoutSsim": 0.001,
}
COUNT_METRICS = {
    "eligibleFrameCount",
    "finiteDepthCount",
    "finitePointCount",
    "registeredFrameCount",
}
REPORTED_METRICS = (
    COUNT_METRICS
    | set(TOLERANCES)
    | {
        "depthCompleteness",
        "disconnectedComponentCount",
        "focalDeviationPixels",
        "fScore",
        "meanReprojectionErrorPixels",
        "meanTrackLength",
        "missingCoverageFraction",
        "occludedCoverageFraction",
        "outputBytes",
        "pointToPlaneRmseMetres",
        "principalPointDeviationPixels",
        "scaleEstimate",
        "spatialCoverageFraction",
        "temporalDepthDrift",
        "wallTimeSeconds",
    }
)


def canonical(value: object) -> bytes:
    return json.dumps(
        value, allow_nan=False, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def obj(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return cast("dict[str, Any]", value)


def metric_delta(name: str, left: float, right: float) -> tuple[float, float]:
    if name in COUNT_METRICS:
        delta = abs(left - right) / max(abs(left), abs(right), 1.0)
        return delta, 0.01
    return abs(left - right), TOLERANCES[name]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-manifest", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--run", action="append", required=True)
    parser.add_argument("--host-capabilities", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    authority_paths = [
        Path(args.export_manifest),
        Path(args.selection),
        Path(args.policy),
        Path(args.host_capabilities),
    ]
    for path in authority_paths:
        if path.is_symlink() or not path.is_file():
            raise ValueError("authority inputs must be regular files")
    export = obj(json.loads(authority_paths[0].read_bytes()), "export")
    selection = obj(json.loads(authority_paths[1].read_bytes()), "selection")
    policy = obj(json.loads(authority_paths[2].read_bytes()), "policy")
    host = obj(json.loads(authority_paths[3].read_bytes()), "host capabilities")
    if (
        export.get("schemaVersion") != "capture-benchmark-export-v1"
        or selection.get("schemaVersion") != "capture-benchmark-selection-v1"
        or policy.get("schemaVersion") != "capture-benchmark-routing-policy-v1"
        or host.get("schemaVersion") != "c14-9-host-capabilities-v1"
    ):
        raise ValueError("benchmark authority schema mismatch")
    runs: list[dict[str, Any]] = []
    for value in args.run:
        path = Path(value)
        if path.is_symlink() or not path.is_file():
            raise ValueError("run fragment must be a regular file")
        run = obj(json.loads(path.read_bytes()), "run")
        required = {
            "candidateId",
            "cohort",
            "commandConfigSha256",
            "containerImageSha256",
            "metrics",
            "rawArtifacts",
            "resources",
            "runIndex",
            "segmentId",
            "selectionSha256",
            "status",
        }
        if (
            set(run) != required
            or run["runIndex"] not in {1, 2}
            or run["status"] not in {"pass", "partial", "fail"}
            or SHA256.fullmatch(str(run["commandConfigSha256"])) is None
            or IMAGE_DIGEST.fullmatch(str(run["containerImageSha256"])) is None
        ):
            raise ValueError("run fragment fields or values are invalid")
        if run["selectionSha256"] != sha(authority_paths[1]):
            raise ValueError("run is not bound to the frozen selection")
        metrics = obj(run["metrics"], "metrics")
        for name, value_metric in metrics.items():
            if name not in REPORTED_METRICS:
                raise ValueError("run contains an unfrozen common metric")
            if value_metric != "not-applicable" and (
                isinstance(value_metric, bool)
                or not isinstance(value_metric, (int, float))
                or not math.isfinite(float(value_metric))
            ):
                raise ValueError("metric must be finite or not-applicable")
        if not isinstance(run["rawArtifacts"], list):
            raise ValueError("raw artifacts must be a list")
        artifact_paths: set[str] = set()
        for raw_artifact in cast("list[object]", run["rawArtifacts"]):
            artifact = obj(raw_artifact, "raw artifact")
            artifact_path = PurePosixPath(str(artifact.get("path")))
            if (
                set(artifact) != {"byteSize", "path", "sha256"}
                or artifact_path.is_absolute()
                or not artifact_path.parts
                or any(part in {"", ".", ".."} for part in artifact_path.parts)
                or artifact_path.as_posix() in artifact_paths
                or isinstance(artifact.get("byteSize"), bool)
                or not isinstance(artifact.get("byteSize"), int)
                or cast("int", artifact["byteSize"]) < 0
                or SHA256.fullmatch(str(artifact.get("sha256"))) is None
            ):
                raise ValueError("raw artifact hash record is invalid")
            artifact_paths.add(artifact_path.as_posix())
        resources = obj(run["resources"], "resources")
        if set(resources) != {"peakHostMemoryBytes", "peakVramBytes", "wallTimeSeconds"} or any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            or value < 0
            for value in resources.values()
        ):
            raise ValueError("resource measurements are invalid")
        run["runRecordSha256"] = sha(path)
        runs.append(run)
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        grouped[(run["candidateId"], run["cohort"], run["segmentId"])].append(run)
    repeatability: list[dict[str, object]] = []
    for key, pair in sorted(grouped.items()):
        reasons: list[str] = []
        deltas: dict[str, object] = {}
        if sorted(run["runIndex"] for run in pair) != [1, 2]:
            reasons.append("TWO_FRESH_RUNS_REQUIRED")
        elif pair[0]["status"] != pair[1]["status"]:
            reasons.append("RUN_STATUS_CHANGED")
        elif (
            pair[0]["containerImageSha256"] != pair[1]["containerImageSha256"]
            or pair[0]["commandConfigSha256"] != pair[1]["commandConfigSha256"]
        ):
            reasons.append("EXECUTION_AUTHORITY_CHANGED")
        else:
            left_metrics = obj(pair[0]["metrics"], "metrics")
            right_metrics = obj(pair[1]["metrics"], "metrics")
            if set(left_metrics) != set(right_metrics):
                reasons.append("METRIC_SET_CHANGED")
            else:
                for name in sorted(left_metrics):
                    left, right = left_metrics[name], right_metrics[name]
                    if left == "not-applicable" and right == "not-applicable":
                        deltas[name] = "not-applicable"
                    elif name not in COUNT_METRICS and name not in TOLERANCES:
                        deltas[name] = "observed-no-frozen-repeatability-limit"
                    elif (
                        isinstance(left, (int, float))
                        and not isinstance(left, bool)
                        and isinstance(right, (int, float))
                        and not isinstance(right, bool)
                    ):
                        delta, tolerance = metric_delta(name, float(left), float(right))
                        deltas[name] = {"delta": delta, "tolerance": tolerance}
                        if delta > tolerance:
                            reasons.append(f"METRIC_DELTA_EXCEEDED:{name}")
                    else:
                        reasons.append(f"METRIC_APPLICABILITY_CHANGED:{name}")
        repeatability.append(
            {
                "candidateId": key[0],
                "cohort": key[1],
                "deltas": deltas,
                "reasons": reasons,
                "segmentId": key[2],
                "status": "pass" if not reasons else "fail",
            }
        )
    record = {
        "authority": "evaluation-only-proposal-output",
        "exportManifestSha256": sha(authority_paths[0]),
        "hostCapabilities": host,
        "hostCapabilitiesSha256": sha(authority_paths[3]),
        "inputClass": export["inputClass"],
        "inputEnvelopeSha256": export["envelopeSha256"],
        "policySha256": sha(authority_paths[2]),
        "productionPromotion": "prohibited",
        "repeatability": repeatability,
        "runs": runs,
        "schemaVersion": SCHEMA,
        "selectionSha256": sha(authority_paths[1]),
        "verdicts": {
            "physicalCaptureCompatibility": "not-run"
            if export["inputClass"] == "benchmark-fixture"
            else "requires-review",
            "representativeAccuracy": "not-run",
            "runtimeExecutable": "pass"
            if runs and all(run["status"] != "fail" for run in runs)
            else "fail",
        },
    }
    output = Path(args.output)
    if (
        not output.is_absolute()
        or output.exists()
        or output.is_symlink()
        or not output.parent.is_dir()
    ):
        raise ValueError("output must be a new absolute regular-file path")
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as target:
        target.write(canonical(record) + b"\n")
    print(json.dumps({"output": str(output), "sha256": sha(output)}, sort_keys=True))


if __name__ == "__main__":
    main()
