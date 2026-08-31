#!/usr/bin/env python3
"""Run resumable, staged private VGGT non-commercial research scopes."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from capture_benchmark import canonical_bytes, private_write, safe_root, sha256_file

SCHEMA = "c14-10-vggt-nc-research-candidate-registry-v1"
RESULT_SCHEMA = "c14-10-vggt-nc-result-v1"
STAGES = (4, 16, 48, 165)
PRIVATE_ROOT = Path("/home")


def stages_through(maximum: int) -> tuple[int, ...]:
    if maximum not in STAGES:
        raise ValueError("maximum stage is not frozen")
    return tuple(stage for stage in STAGES if stage <= maximum)


def validate_resumable_record(
    record: dict[str, Any],
    image_id: str,
    registry_sha256: str,
    candidate_id: str,
    stage: int,
    run_index: int,
) -> None:
    expected = {
        "candidateId": candidate_id,
        "imageId": image_id,
        "registrySha256": registry_sha256,
        "runIndex": run_index,
        "stageFrameCount": stage,
    }
    if any(record.get(key) != value for key, value in expected.items()):
        raise ValueError("resumable stage identity differs from the current freeze")


def private_existing(path: Path, label: str) -> Path:
    if not path.is_absolute() or path.is_symlink() or not path.exists():
        raise ValueError(f"{label} must be a private WSL ext4 path")
    resolved = path.resolve()
    if resolved == PRIVATE_ROOT or not resolved.is_relative_to(PRIVATE_ROOT):
        raise ValueError(f"{label} must be a private WSL ext4 path")
    return resolved


def resumable_root(path: Path) -> Path:
    if (
        not path.is_absolute()
        or path.is_symlink()
        or path.resolve(strict=False) == PRIVATE_ROOT
        or not path.resolve(strict=False).is_relative_to(PRIVATE_ROOT)
    ):
        raise ValueError("output root must remain private WSL ext4")
    return safe_root(path) if path.exists() else safe_root(path, create=True)


def load_registry(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    value = json.loads(path.read_bytes())
    if value.get("schemaVersion") != SCHEMA:
        raise ValueError("candidate registry schema is invalid")
    candidates = {
        item["candidateId"]: item
        for item in value["candidates"]
        if item.get("executionState") == "viable-non-commercial-research-only"
    }
    if set(candidates) != {"vggt-1b-nc-direct", "vggt-slam-2-nc-no-loop"}:
        raise ValueError("executable candidate set is not frozen")
    freeze = value.get("executionFreeze")
    if (
        not isinstance(freeze, dict)
        or freeze.get("network") != "none"
        or freeze.get("runCount") != 2
        or not str(freeze.get("imageId", "")).startswith("sha256:")
        or len(str(freeze.get("imageId", ""))) != 71
        or len(str(freeze.get("environmentAuditSha256", ""))) != 64
        or len(str(freeze.get("inputManifestSha256", ""))) != 64
        or len(str(freeze.get("selectionSha256", ""))) != 64
        or not isinstance(freeze.get("segmentId"), str)
    ):
        raise ValueError("execution limits are not frozen")
    return candidates, freeze


def inspect_image(image_id: str) -> None:
    completed = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image_id],
        check=True,
        capture_output=True,
        text=True,
    )
    if completed.stdout.strip() != image_id:
        raise ValueError("container image identity changed")


def retained_bytes(root: Path) -> int:
    total = 0
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("stage output contains a symlink")
        if path.is_file():
            total += path.stat().st_size
    return total


def contains_nonfinite_number(value: object) -> bool:
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, list):
        return any(contains_nonfinite_number(item) for item in value)
    if isinstance(value, dict):
        return any(contains_nonfinite_number(item) for item in value.values())
    return False


def validate_candidate_result(
    *,
    result: object,
    candidate_id: str,
    candidate: dict[str, Any],
    stage: int,
    run_index: int,
    scope: Path,
    freeze: dict[str, Any],
) -> bool:
    if not isinstance(result, dict) or contains_nonfinite_number(result):
        return False
    weight = candidate.get("weight")
    source = candidate.get("code", {}).get("vggtFork", candidate.get("code"))
    required_identity = {
        "authority": "strictly-private-non-commercial-research-proposal-only",
        "candidateId": candidate_id,
        "commercialUse": "PROHIBITED_REEVALUATION_REQUIRED",
        "dimensionalAccuracy": "NOT RUN",
        "inputManifestSha256": freeze["inputManifestSha256"],
        "modelRevision": weight.get("revision") if isinstance(weight, dict) else None,
        "productionAuthority": "none",
        "representativeAccuracy": "NOT RUN",
        "runIndex": run_index,
        "schemaVersion": RESULT_SCHEMA,
        "slamSourceCommit": "35327ac28b7d193df9ccc39ba6346052bb6f1207",
        "sourceCommit": source.get("commit") if isinstance(source, dict) else None,
        "sourceViewCount": stage,
        "segmentId": freeze["segmentId"],
        "selectionSha256": freeze["selectionSha256"],
        "weightSha256": weight.get("sha256") if isinstance(weight, dict) else None,
    }
    if any(result.get(key) != expected for key, expected in required_identity.items()):
        return False
    integers = (result.get("registeredViewCount"), result.get("finitePointCount"))
    if (
        any(not isinstance(value, int) or isinstance(value, bool) for value in integers)
        or result["registeredViewCount"] != stage
        or not 1 <= result["finitePointCount"] <= freeze["maxPoints"]
        or not isinstance(result.get("peakTaskVramBytes"), int)
        or isinstance(result.get("peakTaskVramBytes"), bool)
        or result["peakTaskVramBytes"] < 0
    ):
        return False
    held_out = result.get("heldOutAppearance")
    if stage == 165:
        if not isinstance(held_out, dict) or held_out.get("trainingFrameCount") != 164:
            return False
    elif held_out != "NOT RUN":
        return False
    artifacts = result.get("artifacts")
    if not isinstance(artifacts, dict) or not all(
        isinstance(name, str) and isinstance(digest, str) for name, digest in artifacts.items()
    ):
        return False
    expected_names = {"proposal-points.ply", "proposal-cameras.json"}
    if stage == 165:
        expected_names.add("held-out-render.png")
    if set(artifacts) != expected_names:
        return False
    for name, digest in artifacts.items():
        path = scope / name
        if Path(name).name != name or path.is_symlink() or not path.is_file():
            return False
        if len(digest) != 64 or sha256_file(path) != digest:
            return False
    return True


def validate_resumable_pass(
    *,
    record: dict[str, Any],
    candidate_id: str,
    candidate: dict[str, Any],
    stage: int,
    run_index: int,
    scope: Path,
    freeze: dict[str, Any],
) -> None:
    result_path = scope / "candidate-result.json"
    if result_path.is_symlink() or not result_path.is_file():
        raise ValueError("resumable passing result is missing or invalid")
    try:
        result = json.loads(result_path.read_bytes())
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("resumable passing result is missing or invalid") from error
    if record.get("resultSha256") != sha256_file(result_path) or not validate_candidate_result(
        result=result,
        candidate_id=candidate_id,
        candidate=candidate,
        stage=stage,
        run_index=run_index,
        scope=scope,
        freeze=freeze,
    ):
        raise ValueError("resumable passing result differs from its sealed stage")


def docker_command(
    *,
    candidate_id: str,
    candidate: dict[str, Any],
    image_id: str,
    input_root: Path,
    model_root: Path,
    output: Path,
    stage: int,
    run_index: int,
    freeze: dict[str, Any],
) -> list[str]:
    weight = candidate.get("weight")
    if weight is None:
        raise ValueError("hybrid weight must be resolved before command construction")
    name = (
        "c14-10-vggt-"
        + hashlib.sha256(f"{candidate_id}:{stage}:{run_index}:{output}".encode()).hexdigest()[:16]
    )
    command = [
        "docker",
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--gpus",
        "device=0",
        "--cpus",
        str(freeze["cpuLimit"]),
        "--memory",
        str(freeze["memoryLimitBytes"]),
        "--pids-limit",
        str(freeze["pidLimit"]),
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--env",
        "HOME=/tmp",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=2g",
        "--mount",
        f"type=bind,src={input_root},dst=/c14/input,readonly",
        "--mount",
        f"type=bind,src={model_root},dst=/c14/model,readonly",
        "--mount",
        f"type=bind,src={output},dst=/c14/output",
        image_id,
        "--candidate-id",
        candidate_id,
        "--input",
        "/c14/input",
        "--model",
        "/c14/model",
        "--output",
        "/c14/output",
        "--source-commit",
        candidate["code"].get("vggtFork", candidate["code"])["commit"],
        "--slam-source-commit",
        "35327ac28b7d193df9ccc39ba6346052bb6f1207",
        "--model-revision",
        weight["revision"],
        "--weight-sha256",
        weight["sha256"],
        "--model-readme-sha256",
        weight["modelCardSha256"],
        "--model-config-sha256",
        weight["modelConfigSha256"],
        "--run-index",
        str(run_index),
        "--frame-limit",
        str(stage),
        "--submap-size",
        str(freeze["submapSize"]),
        "--max-points",
        str(freeze["maxPoints"]),
        "--task-vram-limit-bytes",
        str(freeze["taskVramLimitBytes"]),
        "--seed",
        "0",
    ]
    if stage == 165:
        command.append("--held-out")
    return command


def run_scope(command: list[str], output: Path, timeout: int) -> dict[str, Any]:
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False
        )
        timed_out = False
        exit_code = completed.returncode
        stdout, stderr = completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as error:
        timed_out = True
        exit_code = 124
        stdout = error.stdout if isinstance(error.stdout, str) else ""
        stderr = error.stderr if isinstance(error.stderr, str) else ""
        name = command[command.index("--name") + 1]
        cleanup = subprocess.run(
            ["docker", "rm", "--force", name],
            capture_output=True,
            check=False,
            text=True,
        )
        stderr += f"\ntimeout cleanup exit code: {cleanup.returncode}"
    return {
        "argvSha256": hashlib.sha256(canonical_bytes(command)).hexdigest(),
        "exitCode": exit_code,
        "stderr": stderr[-16000:],
        "stdout": stdout[-16000:],
        "timedOut": timed_out,
        "wallSeconds": time.monotonic() - started,
        "output": str(output),
    }


def execute(args: argparse.Namespace) -> None:
    registry_path = private_existing(Path(args.registry), "registry")
    input_root = private_existing(Path(args.input), "input")
    model_root = private_existing(Path(args.model), "model")
    environment_audit = private_existing(Path(args.environment_audit), "environment audit")
    output_root = resumable_root(Path(args.output_root))
    if output_root == PRIVATE_ROOT or not output_root.is_relative_to(PRIVATE_ROOT):
        raise ValueError("output root must remain private WSL ext4")
    candidates, freeze = load_registry(registry_path)
    if args.image_id != freeze["imageId"]:
        raise ValueError("requested image differs from the frozen image")
    if sha256_file(environment_audit) != freeze["environmentAuditSha256"]:
        raise ValueError("environment audit differs from the frozen evidence")
    input_manifest = input_root / "da3-input.json"
    if (
        input_manifest.is_symlink()
        or not input_manifest.is_file()
        or sha256_file(input_manifest) != freeze["inputManifestSha256"]
    ):
        raise ValueError("input manifest differs from the frozen evidence")
    direct_weight = candidates["vggt-1b-nc-direct"]["weight"]
    candidates["vggt-slam-2-nc-no-loop"]["weight"] = direct_weight
    inspect_image(args.image_id)
    registry_sha256 = sha256_file(registry_path)
    summary: dict[str, Any] = {
        "authority": "private-non-commercial-research-only",
        "imageId": args.image_id,
        "maximumStageFrameCount": args.max_stage,
        "registrySha256": registry_sha256,
        "schemaVersion": "c14-10-vggt-nc-staged-matrix-v1",
        "scopes": [],
    }
    summary_path = output_root / f"matrix-summary-through-{args.max_stage}.json"
    if summary_path.exists():
        raise ValueError("matrix summary for this maximum stage already exists")
    for candidate_id in args.candidate:
        candidate = candidates[candidate_id]
        stop_candidate = False
        for stage in stages_through(args.max_stage):
            for run_index in (1, 2) if stage == 165 else (1,):
                scope = output_root / candidate_id / f"stage-{stage}" / f"run-{run_index}"
                record_path = scope / "stage-record.json"
                if record_path.is_symlink():
                    raise ValueError("resumable stage record is unsafe")
                if record_path.exists():
                    if not record_path.is_file():
                        raise ValueError("resumable stage record is not a regular file")
                    try:
                        prior = json.loads(record_path.read_bytes())
                    except (json.JSONDecodeError, UnicodeDecodeError) as error:
                        raise ValueError("resumable stage record is invalid") from error
                    if not isinstance(prior, dict):
                        raise ValueError("resumable stage record is invalid")
                    validate_resumable_record(
                        prior,
                        args.image_id,
                        registry_sha256,
                        candidate_id,
                        stage,
                        run_index,
                    )
                    if prior.get("status") == "pass":
                        validate_resumable_pass(
                            record=prior,
                            candidate_id=candidate_id,
                            candidate=candidate,
                            stage=stage,
                            run_index=run_index,
                            scope=scope,
                            freeze=freeze,
                        )
                    summary["scopes"].append(prior)
                    if prior.get("status") == "pass":
                        continue
                    stop_candidate = True
                    break
                scope.mkdir(parents=True, mode=0o700)
                command = docker_command(
                    candidate_id=candidate_id,
                    candidate=candidate,
                    image_id=args.image_id,
                    input_root=input_root,
                    model_root=model_root,
                    output=scope,
                    stage=stage,
                    run_index=run_index,
                    freeze=freeze,
                )
                execution = run_scope(command, scope, int(freeze["stageTimeoutSeconds"]))
                unsafe_output = False
                try:
                    retained_output_bytes: int | None = retained_bytes(scope)
                except ValueError:
                    retained_output_bytes = None
                    unsafe_output = True
                result_path = scope / "candidate-result.json"
                result = None
                if (
                    execution["exitCode"] == 0
                    and not unsafe_output
                    and not result_path.is_symlink()
                    and result_path.is_file()
                ):
                    try:
                        result = json.loads(result_path.read_bytes())
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        result = None
                failure = None
                if execution["timedOut"]:
                    failure = "STAGE_TIMEOUT"
                elif execution["exitCode"] != 0:
                    failure = "CANDIDATE_RUNTIME_FAILED"
                elif unsafe_output:
                    failure = "UNSAFE_STAGE_OUTPUT"
                elif result is None or not validate_candidate_result(
                    result=result,
                    candidate_id=candidate_id,
                    candidate=candidate,
                    stage=stage,
                    run_index=run_index,
                    scope=scope,
                    freeze=freeze,
                ):
                    failure = "INVALID_CANDIDATE_RESULT"
                elif result.get("peakTaskVramBytes", 0) > freeze["taskVramLimitBytes"]:
                    failure = "TASK_VRAM_CEILING_EXCEEDED"
                elif (
                    retained_output_bytes is not None
                    and retained_output_bytes > freeze["scratchLimitBytes"]
                ):
                    failure = "RETAINED_OUTPUT_CEILING_EXCEEDED"
                record = {
                    "candidateId": candidate_id,
                    "imageId": args.image_id,
                    "registrySha256": registry_sha256,
                    "stageFrameCount": stage,
                    "runIndex": run_index,
                    "status": "pass" if failure is None else "fail",
                    "failureCode": failure,
                    "execution": execution,
                    "retainedOutputBytes": retained_output_bytes,
                    "resultSha256": sha256_file(result_path) if result else None,
                }
                private_write(record_path, canonical_bytes(record) + b"\n")
                summary["scopes"].append(record)
                if failure is not None:
                    stop_candidate = True
                    break
            if stop_candidate:
                break
    private_write(summary_path, canonical_bytes(summary) + b"\n")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--registry", required=True)
    value.add_argument("--image-id", required=True)
    value.add_argument("--input", required=True)
    value.add_argument("--model", required=True)
    value.add_argument("--environment-audit", required=True)
    value.add_argument("--output-root", required=True)
    value.add_argument("--max-stage", type=int, choices=STAGES, required=True)
    value.add_argument(
        "--candidate",
        action="append",
        choices=("vggt-1b-nc-direct", "vggt-slam-2-nc-no-loop"),
        required=True,
    )
    value.set_defaults(function=execute)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
