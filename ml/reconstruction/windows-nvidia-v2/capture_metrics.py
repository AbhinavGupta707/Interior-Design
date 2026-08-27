#!/usr/bin/env python3
"""Build the strict immutable C14.9 record from complete two-run fragments."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any, cast

SCHEMA = "c14-9-capture-benchmark-v1"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_:-]{2,119}$")
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
BASELINE_CANDIDATES = {
    "colmap-arkit-prior",
    "colmap-unconstrained",
    "gsplat-direct",
    "open3d-known-pose-tsdf",
}
IMAGE_KEYS = {
    "colmap-arkit-prior": "colmap",
    "colmap-unconstrained": "colmap",
    "gsplat-direct": "gsplat",
    "open3d-known-pose-tsdf": "open3d",
}


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
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object")
    return cast("dict[str, Any]", value)


def secure_json(path: Path, name: str) -> tuple[dict[str, Any], bytes]:
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.resolve() != path:
        raise ValueError(f"{name} must be an absolute normalized regular file")
    info = path.lstat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or bool(info.st_mode & (stat.S_IRWXG | stat.S_IRWXO))
    ):
        raise ValueError(f"{name} must be private and non-hard-linked")
    raw = path.read_bytes()
    value = obj(json.loads(raw), name)
    if raw != canonical(value) + b"\n":
        raise ValueError(f"{name} must be exact canonical JSON")
    return value, raw


def finite_metric(value: object) -> bool:
    return value == "not-applicable" or (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
    )


def metric_delta(name: str, left: float, right: float) -> tuple[float, float]:
    if name in COUNT_METRICS:
        return abs(left - right) / max(abs(left), abs(right), 1.0), 0.01
    return abs(left - right), TOLERANCES[name]


def validate_artifacts(value: object) -> None:
    if not isinstance(value, list) or not value:
        raise ValueError("raw artifacts must be a non-empty list")
    seen: set[str] = set()
    for raw in value:
        artifact = obj(raw, "raw artifact")
        path = PurePosixPath(str(artifact.get("path")))
        if (
            set(artifact) != {"byteSize", "path", "sha256"}
            or path.is_absolute()
            or not path.parts
            or any(part in {"", ".", ".."} for part in path.parts)
            or path.as_posix() in seen
            or isinstance(artifact.get("byteSize"), bool)
            or not isinstance(artifact.get("byteSize"), int)
            or cast("int", artifact["byteSize"]) < 0
            or SHA256.fullmatch(str(artifact.get("sha256"))) is None
        ):
            raise ValueError("raw artifact hash record is invalid")
        seen.add(path.as_posix())


def expected_execution() -> dict[str, object]:
    return {
        "capDropAll": True,
        "cpus": 12,
        "gpuDevice": "0",
        "network": "none",
        "noNewPrivileges": True,
        "pidsLimit": 512,
        "readOnlyRoot": True,
        "tmpfs": "/tmp:rw,noexec,nosuid,nodev,size=2g",
        "user": "1000:1000",
    }


def gate_run(
    run: dict[str, Any],
    policy: dict[str, Any],
    host: dict[str, Any],
) -> list[str]:
    reasons: list[str] = []
    candidate_id = cast("str", run["candidateId"])
    image_key = IMAGE_KEYS.get(candidate_id, candidate_id)
    images = obj(host.get("images"), "host images")
    image = obj(images.get(image_key), "host image")
    if image.get("id") != run["containerImageSha256"]:
        reasons.append("CONTAINER_IMAGE_NOT_IN_HOST_INVENTORY")
    execution = obj(run["execution"], "execution")
    if execution != expected_execution():
        reasons.append("CONTAINER_ISOLATION_MISMATCH")
    profile_name = "baseline" if candidate_id in BASELINE_CANDIDATES else "experimental"
    profiles = obj(policy.get("resourceProfiles"), "resource profiles")
    profile = obj(profiles.get(profile_name), "resource profile")
    resources = obj(run["resources"], "resources")
    limits = {
        "peakHostMemoryBytes": cast("int", profile["memoryGiB"]) * 1024**3,
        "peakVramBytes": cast("int", profile["vramGiB"]) * 1024**3,
        "scratchBytes": cast("int", profile["scratchGiB"]) * 1024**3,
        "wallTimeSeconds": cast("int", profile["timeoutMinutes"]) * 60,
    }
    for key, ceiling in limits.items():
        if float(resources[key]) > ceiling:
            reasons.append(f"RESOURCE_CEILING_EXCEEDED:{key}")
    return reasons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-manifest", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--run", action="append", required=True)
    parser.add_argument("--host-capabilities", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    paths = {
        "export": Path(args.export_manifest),
        "selection": Path(args.selection),
        "policy": Path(args.policy),
        "host": Path(args.host_capabilities),
    }
    export, _ = secure_json(paths["export"], "export")
    selection, _ = secure_json(paths["selection"], "selection")
    policy, _ = secure_json(paths["policy"], "policy")
    host, _ = secure_json(paths["host"], "host capabilities")
    if (
        export.get("schemaVersion") != "capture-benchmark-export-v1"
        or selection.get("schemaVersion") != "capture-benchmark-selection-v1"
        or policy.get("schemaVersion") != "capture-benchmark-routing-policy-v1"
        or host.get("schemaVersion") != "c14-9-host-capabilities-v1"
        or selection.get("exportManifestSha256") != sha(paths["export"])
        or selection.get("envelopeSha256") != export.get("envelopeSha256")
        or policy.get("selectionSha256") != sha(paths["selection"])
        or policy.get("inputEnvelopeSha256") != export.get("envelopeSha256")
        or selection.get("productionAuthority") != "none-proposal-only"
        or policy.get("productionAuthority") != "none-evaluation-only"
    ):
        raise ValueError("benchmark authority schema or hash linkage mismatch")
    plans = policy.get("plans")
    if not isinstance(plans, list):
        raise ValueError("policy plans are invalid")
    selected: set[tuple[str, str, str]] = set()
    abstentions: list[dict[str, object]] = []
    for raw_plan in plans:
        plan = obj(raw_plan, "plan")
        cohort = plan.get("cohort")
        segment_id = plan.get("segmentId")
        candidates = plan.get("candidates")
        if cohort not in {"normal", "inclusive"} or not isinstance(segment_id, str):
            raise ValueError("policy plan scope is invalid")
        if not isinstance(candidates, list):
            raise ValueError("policy candidates are invalid")
        seen_candidates: set[str] = set()
        for raw_candidate in candidates:
            candidate = obj(raw_candidate, "candidate")
            candidate_id = candidate.get("candidateId")
            status = candidate.get("status")
            policy_reasons = candidate.get("reasons")
            if (
                not isinstance(candidate_id, str)
                or candidate_id in seen_candidates
                or status not in {"selected", "abstained"}
                or not isinstance(policy_reasons, list)
                or any(not isinstance(reason, str) for reason in policy_reasons)
                or (status == "selected" and policy_reasons)
                or (status == "abstained" and not policy_reasons)
            ):
                raise ValueError("policy candidate state is invalid")
            seen_candidates.add(candidate_id)
            key = (candidate_id, cast("str", cohort), segment_id)
            if status == "selected":
                if key in selected:
                    raise ValueError("policy repeats a selected candidate scope")
                selected.add(key)
            else:
                abstentions.append(
                    {
                        "candidateId": candidate_id,
                        "cohort": cohort,
                        "reasons": policy_reasons,
                        "segmentId": segment_id,
                    }
                )
    runs: list[dict[str, Any]] = []
    supplied: set[tuple[str, str, str, int]] = set()
    required_fields = {
        "candidateId",
        "cohort",
        "commandConfigSha256",
        "containerImageSha256",
        "derivedInputSha256",
        "deterministicControlsSha256",
        "execution",
        "failureCode",
        "metrics",
        "policySha256",
        "rawArtifacts",
        "resources",
        "runIndex",
        "seed",
        "segmentId",
        "selectionSha256",
        "status",
    }
    for value in args.run:
        path = Path(value)
        run, _ = secure_json(path, "run fragment")
        if (
            set(run) != required_fields
            or run.get("cohort") not in {"normal", "inclusive"}
            or run.get("runIndex") not in {1, 2}
            or run.get("status") not in {"pass", "partial", "fail"}
            or SHA256.fullmatch(str(run.get("commandConfigSha256"))) is None
            or SHA256.fullmatch(str(run.get("derivedInputSha256"))) is None
            or SHA256.fullmatch(str(run.get("deterministicControlsSha256"))) is None
            or IMAGE_DIGEST.fullmatch(str(run.get("containerImageSha256"))) is None
            or run.get("selectionSha256") != sha(paths["selection"])
            or run.get("policySha256") != sha(paths["policy"])
            or isinstance(run.get("seed"), bool)
            or not isinstance(run.get("seed"), int)
            or not 0 <= cast("int", run["seed"]) <= 2**31 - 1
        ):
            raise ValueError("run fragment fields or authority values are invalid")
        failure_code = run.get("failureCode")
        if (run["status"] == "pass" and failure_code is not None) or (
            run["status"] != "pass"
            and (not isinstance(failure_code, str) or SAFE_CODE.fullmatch(failure_code) is None)
        ):
            raise ValueError("run failure code does not match status")
        key3 = (
            cast("str", run["candidateId"]),
            cast("str", run["cohort"]),
            cast("str", run["segmentId"]),
        )
        key4 = (*key3, cast("int", run["runIndex"]))
        if key3 not in selected or key4 in supplied:
            raise ValueError("run is duplicate or not selected by the frozen policy")
        supplied.add(key4)
        metrics = obj(run["metrics"], "metrics")
        if set(metrics) != REPORTED_METRICS or not all(
            finite_metric(value_metric) for value_metric in metrics.values()
        ):
            raise ValueError("run metrics must use the complete frozen vocabulary")
        for name in COUNT_METRICS:
            value_metric = metrics[name]
            if value_metric != "not-applicable" and not float(value_metric).is_integer():
                raise ValueError("count metric must be integral or not-applicable")
        resources = obj(run["resources"], "resources")
        if set(resources) != {
            "peakHostMemoryBytes",
            "peakVramBytes",
            "scratchBytes",
            "wallTimeSeconds",
        } or any(
            isinstance(item, bool)
            or not isinstance(item, (int, float))
            or not math.isfinite(float(item))
            or item < 0
            for item in resources.values()
        ):
            raise ValueError("resource measurements are invalid")
        validate_artifacts(run["rawArtifacts"])
        run["gateReasons"] = gate_run(run, policy, host)
        run["runRecordSha256"] = sha(path)
        runs.append(run)
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        grouped[
            (
                cast("str", run["candidateId"]),
                cast("str", run["cohort"]),
                cast("str", run["segmentId"]),
            )
        ].append(run)
    repeatability: list[dict[str, object]] = []
    missing_run_count = 0
    for key in sorted(selected):
        pair = sorted(grouped.get(key, []), key=lambda item: cast("int", item["runIndex"]))
        reasons: list[str] = []
        deltas: dict[str, object] = {}
        if [run["runIndex"] for run in pair] != [1, 2]:
            reasons.append("TWO_FRESH_RUNS_REQUIRED")
            missing_run_count += 2 - len(pair)
        else:
            if any(run["status"] != "pass" for run in pair):
                reasons.append("CANDIDATE_RUN_NOT_PASS")
            reasons.extend(
                sorted(
                    {
                        cast("str", reason)
                        for run in pair
                        for reason in cast("list[object]", run["gateReasons"])
                    }
                )
            )
            same_fields = (
                "containerImageSha256",
                "commandConfigSha256",
                "derivedInputSha256",
                "deterministicControlsSha256",
                "seed",
            )
            if any(pair[0][field] != pair[1][field] for field in same_fields):
                reasons.append("DETERMINISTIC_EXECUTION_AUTHORITY_CHANGED")
            left_metrics = obj(pair[0]["metrics"], "metrics")
            right_metrics = obj(pair[1]["metrics"], "metrics")
            for name in sorted(REPORTED_METRICS):
                left, right = left_metrics[name], right_metrics[name]
                if left == "not-applicable" and right == "not-applicable":
                    deltas[name] = "not-applicable"
                elif left == "not-applicable" or right == "not-applicable":
                    reasons.append(f"METRIC_APPLICABILITY_CHANGED:{name}")
                elif name in COUNT_METRICS or name in TOLERANCES:
                    delta, tolerance = metric_delta(name, float(left), float(right))
                    deltas[name] = {"delta": delta, "tolerance": tolerance}
                    if delta > tolerance:
                        reasons.append(f"METRIC_DELTA_EXCEEDED:{name}")
                else:
                    deltas[name] = "observed-no-frozen-repeatability-limit"
        repeatability.append(
            {
                "candidateId": key[0],
                "cohort": key[1],
                "deltas": deltas,
                "reasons": sorted(set(reasons)),
                "segmentId": key[2],
                "status": "pass" if not reasons else "fail",
            }
        )
    runtime = (
        "abstained"
        if not selected
        else "pass"
        if repeatability
        and all(item["status"] == "pass" for item in repeatability)
        and missing_run_count == 0
        else "fail"
    )
    record = {
        "authority": "evaluation-only-proposal-output",
        "denominators": {
            "abstainedCandidateScopeCount": len(abstentions),
            "expectedRunCount": len(selected) * 2,
            "failedRunCount": sum(run["status"] == "fail" for run in runs),
            "isolationOrResourceViolationRunCount": sum(bool(run["gateReasons"]) for run in runs),
            "missingRunCount": missing_run_count,
            "partialRunCount": sum(run["status"] == "partial" for run in runs),
            "selectedCandidateScopeCount": len(selected),
            "suppliedRunCount": len(runs),
        },
        "exportManifestSha256": sha(paths["export"]),
        "hostCapabilities": host,
        "hostCapabilitiesSha256": sha(paths["host"]),
        "inputClass": export["inputClass"],
        "inputEnvelopeSha256": export["envelopeSha256"],
        "policyAbstentions": sorted(
            abstentions,
            key=lambda item: (
                cast("str", item["candidateId"]),
                cast("str", item["cohort"]),
                cast("str", item["segmentId"]),
            ),
        ),
        "policySha256": sha(paths["policy"]),
        "productionPromotion": "prohibited",
        "repeatability": repeatability,
        "runs": sorted(
            runs,
            key=lambda item: (
                cast("str", item["candidateId"]),
                cast("str", item["cohort"]),
                cast("str", item["segmentId"]),
                cast("int", item["runIndex"]),
            ),
        ),
        "schemaVersion": SCHEMA,
        "selectionSha256": sha(paths["selection"]),
        "verdicts": {
            "physicalCaptureCompatibility": (
                "not-run" if export["inputClass"] == "benchmark-fixture" else "requires-review"
            ),
            "representativeAccuracy": "not-run",
            "runtimeExecutable": runtime,
        },
    }
    output = Path(args.output)
    if (
        not output.is_absolute()
        or output.exists()
        or output.is_symlink()
        or output.parent.is_symlink()
        or not output.parent.is_dir()
        or output.parent.resolve() != output.parent
    ):
        raise ValueError("output must be a new absolute normalized file")
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as target:
        target.write(canonical(record) + b"\n")
    print(json.dumps({"output": str(output), "sha256": sha(output)}, sort_keys=True))


if __name__ == "__main__":
    main()
