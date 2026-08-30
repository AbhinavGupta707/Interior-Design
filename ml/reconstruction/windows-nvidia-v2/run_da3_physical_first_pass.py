#!/usr/bin/env python3
"""Run one frozen DA3-SMALL first pass for one complete physical capture."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from capture_benchmark import canonical_bytes, private_write, safe_root, sha256_file
from da3_metrics import load_result
from run_da3_matrix import (
    TIMEOUT_SECONDS,
    directory_bytes,
    docker_command,
    inspect_image,
    parse_model_roots,
    prepare_input,
    private_existing,
    registry_candidates,
    run_logged,
    validate_model_root,
)

PRODUCT_SOURCE_COMMIT = "62a0ed823dcd85f3355b4f24040484cff720ea75"
EXPECTED_FRAME_COUNTS = {132, 165}
IMAGE_ID = "sha256:246b7363b7ff9d2a38a688607aa9d89d6085734c1b7acc88221e00f04590e0d3"
CANDIDATE_ID = "da3-small"
RUN_INDEX = 1


def validate_repository(repository: Path, harness_commit: str) -> None:
    repository = private_existing(repository, "repository")
    head = subprocess.run(
        ["git", "-C", str(repository), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "-C", str(repository), "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    ancestor = subprocess.run(
        [
            "git",
            "-C",
            str(repository),
            "merge-base",
            "--is-ancestor",
            PRODUCT_SOURCE_COMMIT,
            harness_commit,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if head != harness_commit or dirty or ancestor.returncode != 0:
        raise ValueError("evaluation harness checkout is not the clean declared source descendant")


def validate_plan(path: Path, expected_frame_count: int) -> tuple[str, dict[str, Any]]:
    plan = json.loads(path.read_bytes())
    lane = plan.get("lanes", {}).get("da3Small", {})
    stop = plan.get("firstPassStopRule", {})
    datasets = {
        item.get("fullFrameCount") for item in plan.get("datasets", []) if isinstance(item, dict)
    }
    if (
        plan.get("schemaVersion") != "c14-10-physical-evaluation-plan-v3"
        or plan.get("productSourceCommit") != PRODUCT_SOURCE_COMMIT
        or plan.get("images", {}).get("da3Small") != IMAGE_ID
        or expected_frame_count not in datasets
        or lane.get("candidateId") != CANDIDATE_ID
        or lane.get("frameScope") != "full"
        or lane.get("firstPassOnly") is not True
        or lane.get("repeats") != 1
        or stop.get("fullQualityRepeat2") != "not-run"
        or stop.get("additionalModelsOrParameterSearch") != "forbidden"
        or plan.get("executionOrder", {}).get("da3Small")
        != ["c14-10-rectangular-132-r1", "c14-10-irregular-165-r1"]
    ):
        raise ValueError("physical evaluation first-pass stop rule is not frozen")
    profile = plan.get("resourceProfiles", {}).get("da3")
    if not isinstance(profile, dict) or profile.get("timeoutSeconds") != TIMEOUT_SECONDS:
        raise ValueError("DA3 resource profile is not frozen")
    return sha256_file(path), profile


def select_single_normal_segment(
    selection: dict[str, Any], expected_frame_count: int
) -> tuple[str, str]:
    if expected_frame_count not in EXPECTED_FRAME_COUNTS:
        raise ValueError("expected frame count is outside the declared physical datasets")
    cohorts = selection.get("cohorts")
    if not isinstance(cohorts, dict):
        raise ValueError("selection cohorts are invalid")
    normal = cohorts.get("normal", {}).get("segments")
    inclusive = cohorts.get("inclusive", {}).get("segments")
    if not isinstance(normal, list) or not isinstance(inclusive, list):
        raise ValueError("selection segment scopes are invalid")
    if len(normal) != 1 or len(inclusive) != 1:
        raise ValueError("physical DA3 first pass requires exactly one independent segment")
    if canonical_bytes(normal[0]) != canonical_bytes(inclusive[0]):
        raise ValueError("normal and inclusive selections are not byte-identical duplicates")
    segment = normal[0]
    if not isinstance(segment, dict) or not isinstance(segment.get("segmentId"), str):
        raise ValueError("selection segment identity is invalid")
    frames = segment.get("frames")
    if not isinstance(frames, list) or len(frames) != expected_frame_count:
        raise ValueError("selection does not contain the complete declared capture")
    segment_id = segment["segmentId"]
    return segment_id, hashlib.sha256(segment_id.encode()).hexdigest()[:12]


def record_payload(
    args: argparse.Namespace,
    *,
    plan_sha256: str,
    registry_sha256: str,
    selection_sha256: str,
    segment_key: str,
    status: str,
    failure_code: str | None,
    exit_code: int | None,
    timed_out: bool,
    result: dict[str, Any] | None = None,
    retained_output_bytes: int | None = None,
) -> dict[str, Any]:
    metrics: dict[str, Any] | None = None
    artifacts: dict[str, str] = {}
    if result is not None:
        metrics = {
            "coverageFraction": result["heldOutAppearance"]["coverageFraction"],
            "fullFramePsnrDb": result["heldOutAppearance"]["fullFramePsnrDb"],
            "peakHostMaxRssBytes": result["peakHostMaxRssBytes"],
            "peakTaskVramBytes": result["peakTaskVramBytes"],
            "registeredViewCount": result["registeredViewCount"],
            "retainedOutputBytes": retained_output_bytes,
            "retainedPointCount": result["geometry"]["retainedPointCount"],
            "sourceViewCount": result["sourceViewCount"],
            "wallSeconds": result["wallSeconds"],
        }
        artifacts = dict(result["artifacts"])
    return {
        "artifacts": artifacts,
        "authority": "private-proposal-evaluation-only",
        "candidateId": CANDIDATE_ID,
        "captureAlias": f"c14-10-physical-{args.expected_frame_count}",
        "cohort": "normal-deduplicated-against-inclusive",
        "counted": True,
        "evaluationHarnessCommit": args.evaluation_harness_commit,
        "evaluationPlanSha256": plan_sha256,
        "exitCode": exit_code,
        "expectedFrameCount": args.expected_frame_count,
        "failureCode": failure_code,
        "imageId": args.image_id,
        "metrics": metrics,
        "processRes": args.process_res,
        "productSourceCommit": PRODUCT_SOURCE_COMMIT,
        "registrySha256": registry_sha256,
        "runIndex": RUN_INDEX,
        "schemaVersion": "c14-10-da3-physical-first-pass-v1",
        "segmentKey": segment_key,
        "selectionSha256": selection_sha256,
        "status": status,
        "timedOut": timed_out,
    }


def seal(path: Path, payload: dict[str, Any]) -> None:
    private_write(path, canonical_bytes(payload) + b"\n")


def execute(args: argparse.Namespace) -> None:
    if shutil.which("docker") is None:
        raise RuntimeError("Docker is required")
    if args.image_id != IMAGE_ID or args.candidate != CANDIDATE_ID:
        raise ValueError("DA3 physical candidate or image differs from the frozen lane")
    repository = private_existing(Path(args.repository), "repository")
    validate_repository(repository, args.evaluation_harness_commit)
    plan_path = private_existing(Path(args.plan), "plan")
    plan_sha, profile = validate_plan(plan_path, args.expected_frame_count)
    inspect_image(args.image_id)
    registry = private_existing(Path(args.registry), "registry")
    frozen, limits = registry_candidates(registry, args.image_id)
    if (
        args.process_res != limits["processResolution"]
        or profile.get("cpuLimit") != limits["cpuLimit"]
        or profile.get("memoryLimitBytes") != limits["memoryLimitBytes"]
        or profile.get("pidLimit") != limits["pidLimit"]
        or profile.get("retainedOutputLimitBytes") != limits["retainedOutputLimitBytes"]
        or profile.get("taskVramLimitBytes") != limits["taskVramLimitBytes"]
    ):
        raise ValueError("DA3 plan and registry resource limits differ")
    selection_path = private_existing(Path(args.selection), "selection")
    export_root = private_existing(Path(args.export_root), "export root")
    segment_id, segment_key = select_single_normal_segment(
        json.loads(selection_path.read_bytes()), args.expected_frame_count
    )
    model_roots = parse_model_roots(args.model_root)
    if set(model_roots) != {CANDIDATE_ID}:
        raise ValueError("exactly one frozen DA3-SMALL model root is required")
    candidate = frozen[CANDIDATE_ID]
    model_root = model_roots[CANDIDATE_ID]
    validate_model_root(model_root, candidate)
    output_root = safe_root(Path(args.output_root), create=True)
    if not str(output_root).startswith("/home/"):
        raise ValueError("output root must remain on private WSL ext4")
    record_path = Path(args.record)
    if (
        not record_path.is_absolute()
        or not str(record_path).startswith("/home/")
        or record_path.parent.resolve() != record_path.parent
        or record_path.exists()
        or record_path.is_symlink()
    ):
        raise ValueError("authority record must be a fresh private WSL ext4 path")
    selection_sha = sha256_file(selection_path)
    registry_sha = sha256_file(registry)
    input_root = output_root / "input"
    try:
        prepare_input(
            cohort="normal",
            export_root=export_root,
            output=input_root,
            segment_id=segment_id,
            selection=selection_path,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        seal(
            record_path,
            record_payload(
                args,
                plan_sha256=plan_sha,
                registry_sha256=registry_sha,
                selection_sha256=selection_sha,
                segment_key=segment_key,
                status="fail",
                failure_code="INPUT_PREPARATION_FAILED",
                exit_code=None,
                timed_out=False,
            ),
        )
        raise SystemExit(1) from None
    prepared = json.loads((input_root / "da3-input.json").read_bytes())
    if len(prepared.get("frames", [])) != args.expected_frame_count:
        raise ValueError("prepared DA3 input is not the complete declared capture")
    run_root = output_root / "run-1"
    run_root.mkdir(mode=0o700)
    name, command = docker_command(
        candidate_id=CANDIDATE_ID,
        image_id=args.image_id,
        input_root=input_root,
        model_root=model_root,
        output_root=run_root,
        run_index=RUN_INDEX,
        source_commit=candidate["code"]["commit"],
        weight_sha256=candidate["weight"]["sha256"],
        process_res=args.process_res,
    )
    try:
        exit_code, timed_out = run_logged(command, run_root / "runner-log.json", TIMEOUT_SECONDS)
    except OSError:
        exit_code, timed_out = 125, False
    if exit_code != 0:
        subprocess.run(
            ["docker", "rm", "--force", name],
            check=False,
            capture_output=True,
            text=True,
        )
        seal(
            record_path,
            record_payload(
                args,
                plan_sha256=plan_sha,
                registry_sha256=registry_sha,
                selection_sha256=selection_sha,
                segment_key=segment_key,
                status="fail",
                failure_code="RUNTIME_TIMEOUT" if timed_out else "INFERENCE_OR_RUNTIME_FAILED",
                exit_code=exit_code,
                timed_out=timed_out,
            ),
        )
        raise SystemExit(1)
    try:
        result = load_result(run_root / "candidate-result.json")
        if (
            result.get("candidateId") != CANDIDATE_ID
            or result.get("sourceCommit") != candidate["code"]["commit"]
            or result.get("weightSha256") != candidate["weight"]["sha256"]
            or result.get("runIndex") != RUN_INDEX
            or result.get("sourceViewCount") != args.expected_frame_count
        ):
            raise ValueError("candidate result identity differs from the frozen first pass")
        retained_bytes = directory_bytes(run_root)
        if int(result["peakTaskVramBytes"]) > limits["taskVramLimitBytes"]:
            raise RuntimeError("TASK_VRAM_CEILING_EXCEEDED")
        if retained_bytes > limits["retainedOutputLimitBytes"]:
            raise RuntimeError("RETAINED_OUTPUT_CEILING_EXCEEDED")
        for name, expected_sha in result["artifacts"].items():
            artifact = run_root / name
            if (
                artifact.is_symlink()
                or not artifact.is_file()
                or sha256_file(artifact) != expected_sha
            ):
                raise ValueError("candidate artifact differs from the sealed result")
    except (KeyError, TypeError, ValueError, RuntimeError) as error:
        code = str(error)
        if code not in {
            "TASK_VRAM_CEILING_EXCEEDED",
            "RETAINED_OUTPUT_CEILING_EXCEEDED",
        }:
            code = "RESULT_VALIDATION_FAILED"
        seal(
            record_path,
            record_payload(
                args,
                plan_sha256=plan_sha,
                registry_sha256=registry_sha,
                selection_sha256=selection_sha,
                segment_key=segment_key,
                status="fail",
                failure_code=code,
                exit_code=0,
                timed_out=False,
            ),
        )
        raise SystemExit(1) from None
    record = record_payload(
        args,
        plan_sha256=plan_sha,
        registry_sha256=registry_sha,
        selection_sha256=selection_sha,
        segment_key=segment_key,
        status="pass",
        failure_code=None,
        exit_code=0,
        timed_out=False,
        result=result,
        retained_output_bytes=retained_bytes,
    )
    seal(record_path, record)
    print(
        json.dumps(
            {
                "recordSha256": sha256_file(record_path),
                "status": "pass",
                "viewCount": result["sourceViewCount"],
            },
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--candidate", choices=(CANDIDATE_ID,), required=True)
    value.add_argument("--evaluation-harness-commit", required=True)
    value.add_argument("--expected-frame-count", type=int, choices=(132, 165), required=True)
    value.add_argument("--export-root", required=True)
    value.add_argument("--image-id", required=True)
    value.add_argument("--model-root", action="append", required=True)
    value.add_argument("--output-root", required=True)
    value.add_argument("--plan", required=True)
    value.add_argument("--process-res", type=int, choices=(392,), default=392)
    value.add_argument("--record", required=True)
    value.add_argument("--registry", required=True)
    value.add_argument("--repository", required=True)
    value.add_argument("--selection", required=True)
    value.set_defaults(function=execute)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
