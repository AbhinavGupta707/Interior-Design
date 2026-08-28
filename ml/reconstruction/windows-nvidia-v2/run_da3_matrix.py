#!/usr/bin/env python3
"""Run the frozen DA3 candidate matrix in hardened offline containers."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from capture_benchmark import canonical_bytes, private_write, safe_root, sha256_file
from da3_metrics import load_result

EXECUTABLE_CANDIDATES = {"da3-small"}
COHORTS = ("normal", "inclusive")
TIMEOUT_SECONDS = 45 * 60


def private_existing(path: Path, label: str) -> Path:
    if (
        not path.is_absolute()
        or not str(path).startswith("/home/")
        or path.is_symlink()
        or not path.exists()
    ):
        raise ValueError(f"{label} must be a real private WSL ext4 path")
    return path.resolve()


def parse_model_roots(values: list[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        candidate, separator, raw_path = value.partition("=")
        if not separator or candidate not in EXECUTABLE_CANDIDATES or candidate in result:
            raise ValueError("model roots require one unique executable candidate=absolute-path")
        result[candidate] = private_existing(Path(raw_path), "model root")
    return result


def inspect_image(image_id: str) -> None:
    if not image_id.startswith("sha256:") or len(image_id) != 71:
        raise ValueError("image ID must be an exact sha256 identifier")
    completed = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image_id],
        check=True,
        capture_output=True,
        text=True,
    )
    if completed.stdout.strip() != image_id:
        raise ValueError("Docker image resolution changed the frozen image ID")


def registry_candidates(
    path: Path, image_id: str
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    value = json.loads(path.read_bytes())
    if value.get("schemaVersion") != "c14-10-learned-candidate-registry-v1":
        raise ValueError("candidate registry schema is invalid")
    candidates = {
        item["candidateId"]: item
        for item in value["candidates"]
        if item.get("executionState") == "viable-quarantined-evaluation"
    }
    if set(candidates) != EXECUTABLE_CANDIDATES:
        raise ValueError("candidate registry executable set is not frozen")
    if any(item.get("imageId") != image_id for item in candidates.values()):
        raise ValueError("candidate registry image ID is not frozen")
    execution = value.get("constraints", {}).get("execution")
    required_limits = {
        "cpuLimit": 12,
        "gpu": 0,
        "memoryLimitBytes": 34359738368,
        "pidLimit": 512,
        "processResolution": 392,
        "retainedOutputLimitBytes": 17179869184,
        "runCount": 2,
        "taskVramLimitBytes": 16106127360,
        "timeoutSeconds": TIMEOUT_SECONDS,
        "tmpfsLimitBytes": 2147483648,
    }
    if not isinstance(execution, dict) or any(
        execution.get(key) != expected for key, expected in required_limits.items()
    ):
        raise ValueError("candidate registry execution limits are not frozen")
    if execution.get("network") != "none":
        raise ValueError("candidate registry must freeze network none")
    return candidates, execution


def regular_hash(path: Path, expected: str, label: str) -> None:
    if path.is_symlink() or not path.is_file() or sha256_file(path) != expected:
        raise ValueError(f"{label} differs from the frozen registry")


def validate_model_root(model_root: Path, candidate: dict[str, Any]) -> None:
    weight = model_root / candidate["weight"]["file"]
    regular_hash(weight, candidate["weight"]["sha256"], "model weight")
    if weight.stat().st_size != candidate["weight"]["sizeBytes"]:
        raise ValueError("model weight size differs from the frozen registry")
    regular_hash(model_root / "config.json", candidate["modelConfigSha256"], "model config")
    regular_hash(model_root / "README.md", candidate["modelReadmeSha256"], "model card")


def directory_bytes(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        if item.is_symlink():
            raise ValueError("run output must not contain symlinks")
        if item.is_file():
            total += item.stat().st_size
    return total


def run_logged(command: list[str], log_path: Path, timeout: int) -> tuple[int, bool]:
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
        payload = {
            "argv": command,
            "argvSha256": hashlib.sha256(canonical_bytes(command)).hexdigest(),
            "exitCode": completed.returncode,
            "stderr": completed.stderr,
            "stdout": completed.stdout,
            "timedOut": False,
            "wallSeconds": time.monotonic() - started,
        }
        private_write(log_path, canonical_bytes(payload) + b"\n")
        return completed.returncode, False
    except subprocess.TimeoutExpired as error:
        payload = {
            "argv": command,
            "argvSha256": hashlib.sha256(canonical_bytes(command)).hexdigest(),
            "exitCode": None,
            "stderr": (error.stderr or "") if isinstance(error.stderr, str) else "",
            "stdout": (error.stdout or "") if isinstance(error.stdout, str) else "",
            "timedOut": True,
            "wallSeconds": time.monotonic() - started,
        }
        private_write(log_path, canonical_bytes(payload) + b"\n")
        return 124, True


def prepare_input(
    *,
    cohort: str,
    export_root: Path,
    output: Path,
    segment_id: str,
    selection: Path,
) -> None:
    command = [
        sys.executable,
        str(Path(__file__).with_name("prepare_da3_capture.py")),
        "--export-root",
        str(export_root),
        "--selection",
        str(selection),
        "--cohort",
        cohort,
        "--segment-id",
        segment_id,
        "--output",
        str(output),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


def docker_command(
    *,
    candidate_id: str,
    image_id: str,
    input_root: Path,
    model_root: Path,
    output_root: Path,
    run_index: int,
    source_commit: str,
    weight_sha256: str,
    process_res: int,
) -> tuple[str, list[str]]:
    scope = f"{candidate_id}:{input_root}:{run_index}".encode()
    name = "c14-10-" + hashlib.sha256(scope).hexdigest()[:20]
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
        "12",
        "--memory",
        "32g",
        "--pids-limit",
        "512",
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
        f"type=bind,src={output_root},dst=/c14/output",
        image_id,
        "--candidate-id",
        candidate_id,
        "--input",
        "/c14/input",
        "--model",
        "/c14/model",
        "--output",
        "/c14/output",
        "--run-index",
        str(run_index),
        "--source-commit",
        source_commit,
        "--weight-sha256",
        weight_sha256,
        "--process-res",
        str(process_res),
    ]
    return name, command


def failure(
    *,
    candidate_id: str,
    cohort: str,
    failure_code: str,
    phase: str,
    segment_key: str,
    run_index: int | None = None,
    exit_code: int | None = None,
) -> dict[str, Any]:
    return {
        "candidateId": candidate_id,
        "cohort": cohort,
        "exitCode": exit_code,
        "failureCode": failure_code,
        "phase": phase,
        "runIndex": run_index,
        "segmentKey": segment_key,
    }


def execute(args: argparse.Namespace) -> None:
    if shutil.which("docker") is None:
        raise RuntimeError("Docker is required")
    image_id = args.image_id
    inspect_image(image_id)
    registry = private_existing(Path(args.registry), "registry")
    frozen, execution_limits = registry_candidates(registry, image_id)
    if args.process_res != execution_limits["processResolution"]:
        raise ValueError("process resolution differs from the frozen registry")
    selection = private_existing(Path(args.selection), "selection")
    export_root = private_existing(Path(args.export_root), "export root")
    model_roots = parse_model_roots(args.model_root)
    selected = tuple(args.candidate)
    if len(set(selected)) != len(selected) or set(selected) != EXECUTABLE_CANDIDATES:
        raise ValueError("candidate list must contain the complete frozen executable set")
    if set(model_roots) != set(selected):
        raise ValueError("each executable candidate requires exactly one model root")
    output_root = safe_root(Path(args.output_root), create=True)
    if not str(output_root).startswith("/home/"):
        raise ValueError("output root must remain on private WSL ext4")
    selection_value = json.loads(selection.read_bytes())
    segment_scope_count = sum(
        len(selection_value["cohorts"][cohort]["segments"]) for cohort in COHORTS
    )
    expected_run_count = len(selected) * segment_scope_count * 2
    expected_repeatability_scope_count = len(selected) * segment_scope_count
    run_failures: list[dict[str, Any]] = []
    repeatability_failures: list[dict[str, Any]] = []
    successful_run_count = 0
    completed_repeatability_scope_count = 0
    max_peak_task_vram_bytes = 0
    max_retained_output_bytes = 0
    registry_sha = sha256_file(registry)
    for candidate_id in selected:
        candidate = frozen[candidate_id]
        model_root = model_roots[candidate_id]
        validate_model_root(model_root, candidate)
        for cohort in COHORTS:
            for segment in selection_value["cohorts"][cohort]["segments"]:
                segment_id = segment["segmentId"]
                segment_key = hashlib.sha256(segment_id.encode()).hexdigest()[:12]
                input_root = output_root / "inputs" / candidate_id / cohort / segment_key
                input_root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                try:
                    prepare_input(
                        cohort=cohort,
                        export_root=export_root,
                        output=input_root,
                        segment_id=segment_id,
                        selection=selection,
                    )
                except (OSError, subprocess.SubprocessError, ValueError):
                    for run_index in (1, 2):
                        run_failures.append(
                            failure(
                                candidate_id=candidate_id,
                                cohort=cohort,
                                failure_code="INPUT_PREPARATION_FAILED",
                                phase="input",
                                run_index=run_index,
                                segment_key=segment_key,
                            )
                        )
                    repeatability_failures.append(
                        failure(
                            candidate_id=candidate_id,
                            cohort=cohort,
                            failure_code="RUN_PAIR_INCOMPLETE",
                            phase="repeatability",
                            segment_key=segment_key,
                        )
                    )
                    continue
                run_paths: list[Path] = []
                for run_index in (1, 2):
                    run_root = (
                        output_root
                        / "runs"
                        / candidate_id
                        / cohort
                        / segment_key
                        / f"run-{run_index}"
                    )
                    run_root.mkdir(mode=0o700, parents=True)
                    name, command = docker_command(
                        candidate_id=candidate_id,
                        image_id=image_id,
                        input_root=input_root,
                        model_root=model_root,
                        output_root=run_root,
                        run_index=run_index,
                        source_commit=candidate["code"]["commit"],
                        weight_sha256=candidate["weight"]["sha256"],
                        process_res=args.process_res,
                    )
                    try:
                        code, timed_out = run_logged(
                            command, run_root / "runner-log.json", TIMEOUT_SECONDS
                        )
                    except OSError:
                        code, timed_out = 125, False
                    if code != 0:
                        subprocess.run(
                            ["docker", "rm", "--force", name],
                            check=False,
                            capture_output=True,
                            text=True,
                        )
                        run_failures.append(
                            failure(
                                candidate_id=candidate_id,
                                cohort=cohort,
                                exit_code=code,
                                failure_code=(
                                    "RUNTIME_TIMEOUT"
                                    if timed_out
                                    else "INFERENCE_OR_RUNTIME_FAILED"
                                ),
                                phase="runtime",
                                run_index=run_index,
                                segment_key=segment_key,
                            )
                        )
                        continue
                    result_path = run_root / "candidate-result.json"
                    try:
                        result = load_result(result_path)
                        if (
                            result.get("candidateId") != candidate_id
                            or result.get("sourceCommit") != candidate["code"]["commit"]
                            or result.get("weightSha256") != candidate["weight"]["sha256"]
                        ):
                            raise ValueError("candidate result identity differs from registry")
                        peak_vram = int(result["peakTaskVramBytes"])
                        retained_bytes = directory_bytes(run_root)
                        if peak_vram > execution_limits["taskVramLimitBytes"]:
                            raise RuntimeError("TASK_VRAM_CEILING_EXCEEDED")
                        if retained_bytes > execution_limits["retainedOutputLimitBytes"]:
                            raise RuntimeError("RETAINED_OUTPUT_CEILING_EXCEEDED")
                    except (KeyError, TypeError, ValueError, RuntimeError) as error:
                        failure_code = str(error)
                        if failure_code not in {
                            "TASK_VRAM_CEILING_EXCEEDED",
                            "RETAINED_OUTPUT_CEILING_EXCEEDED",
                        }:
                            failure_code = "RESULT_VALIDATION_FAILED"
                        run_failures.append(
                            failure(
                                candidate_id=candidate_id,
                                cohort=cohort,
                                failure_code=failure_code,
                                phase="validation",
                                run_index=run_index,
                                segment_key=segment_key,
                            )
                        )
                        continue
                    max_peak_task_vram_bytes = max(max_peak_task_vram_bytes, peak_vram)
                    max_retained_output_bytes = max(max_retained_output_bytes, retained_bytes)
                    successful_run_count += 1
                    run_paths.append(result_path)
                if len(run_paths) != 2:
                    repeatability_failures.append(
                        failure(
                            candidate_id=candidate_id,
                            cohort=cohort,
                            failure_code="RUN_PAIR_INCOMPLETE",
                            phase="repeatability",
                            segment_key=segment_key,
                        )
                    )
                    continue
                summary_path = (
                    output_root / "summaries" / candidate_id / cohort / f"{segment_key}.json"
                )
                summary_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                command = [
                    sys.executable,
                    str(Path(__file__).with_name("da3_metrics.py")),
                    "--run-one",
                    str(run_paths[0]),
                    "--run-two",
                    str(run_paths[1]),
                    "--image-id",
                    image_id,
                    "--registry-sha256",
                    registry_sha,
                    "--output",
                    str(summary_path),
                ]
                completed = subprocess.run(command, check=False, capture_output=True, text=True)
                if completed.returncode != 0:
                    repeatability_failures.append(
                        failure(
                            candidate_id=candidate_id,
                            cohort=cohort,
                            exit_code=completed.returncode,
                            failure_code="REPEATABILITY_VALIDATION_FAILED",
                            phase="repeatability",
                            segment_key=segment_key,
                        )
                    )
                    continue
                summary = json.loads(summary_path.read_bytes())
                if summary.get("comparison", {}).get("passed") is not True:
                    repeatability_failures.append(
                        failure(
                            candidate_id=candidate_id,
                            cohort=cohort,
                            failure_code="REPEATABILITY_MISMATCH",
                            phase="repeatability",
                            segment_key=segment_key,
                        )
                    )
                    continue
                completed_repeatability_scope_count += 1
    failures = run_failures + repeatability_failures
    record = {
        "acceptedCandidateIds": list(selected),
        "candidateCount": len(selected),
        "completedRepeatabilityScopeCount": completed_repeatability_scope_count,
        "expectedRepeatabilityScopeCount": expected_repeatability_scope_count,
        "expectedRunCount": expected_run_count,
        "failureCount": len(failures),
        "failures": failures,
        "imageId": image_id,
        "maxObservedPeakTaskVramBytes": max_peak_task_vram_bytes,
        "maxObservedRetainedOutputBytes": max_retained_output_bytes,
        "processRes": args.process_res,
        "registrySha256": registry_sha,
        "repeatabilityFailureCount": len(repeatability_failures),
        "runFailureCount": len(run_failures),
        "schemaVersion": "c14-10-da3-matrix-run-v2",
        "selectionSha256": sha256_file(selection),
        "successfulRunCount": successful_run_count,
    }
    private_write(output_root / "matrix-result.json", canonical_bytes(record) + b"\n")
    print(
        json.dumps(
            {
                "expectedRunCount": expected_run_count,
                "failureCount": len(failures),
                "successfulRunCount": successful_run_count,
            }
        )
    )
    if failures:
        raise SystemExit(1)


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--candidate", action="append", required=True)
    value.add_argument("--export-root", required=True)
    value.add_argument("--image-id", required=True)
    value.add_argument("--model-root", action="append", required=True)
    value.add_argument("--output-root", required=True)
    value.add_argument("--process-res", type=int, choices=(336, 392, 448, 504), default=392)
    value.add_argument("--registry", required=True)
    value.add_argument("--selection", required=True)
    value.set_defaults(function=execute)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
