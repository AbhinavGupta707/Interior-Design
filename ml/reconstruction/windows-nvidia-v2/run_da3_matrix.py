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

CANDIDATES = {"da3-large-1.1", "da3-small"}
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
        if not separator or candidate not in CANDIDATES or candidate in result:
            raise ValueError("model roots require one unique frozen candidate=absolute-path")
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


def registry_candidates(path: Path, image_id: str) -> dict[str, dict[str, Any]]:
    value = json.loads(path.read_bytes())
    if value.get("schemaVersion") != "c14-10-learned-candidate-registry-v1":
        raise ValueError("candidate registry schema is invalid")
    candidates = {
        item["candidateId"]: item
        for item in value["candidates"]
        if item.get("executionState") == "viable-quarantined-evaluation"
    }
    if set(candidates) != CANDIDATES:
        raise ValueError("candidate registry viable set is not frozen")
    if any(item.get("imageId") != image_id for item in candidates.values()):
        raise ValueError("candidate registry image ID is not frozen")
    return candidates


def run_logged(command: list[str], log_path: Path, timeout: int) -> int:
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
            "argvSha256": hashlib.sha256(canonical_bytes(command)).hexdigest(),
            "exitCode": completed.returncode,
            "stderr": completed.stderr,
            "stdout": completed.stdout,
            "timedOut": False,
            "wallSeconds": time.monotonic() - started,
        }
        private_write(log_path, canonical_bytes(payload) + b"\n")
        return completed.returncode
    except subprocess.TimeoutExpired as error:
        payload = {
            "argvSha256": hashlib.sha256(canonical_bytes(command)).hexdigest(),
            "exitCode": None,
            "stderr": (error.stderr or "") if isinstance(error.stderr, str) else "",
            "stdout": (error.stdout or "") if isinstance(error.stdout, str) else "",
            "timedOut": True,
            "wallSeconds": time.monotonic() - started,
        }
        private_write(log_path, canonical_bytes(payload) + b"\n")
        return 124


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


def execute(args: argparse.Namespace) -> None:
    if shutil.which("docker") is None:
        raise RuntimeError("Docker is required")
    image_id = args.image_id
    inspect_image(image_id)
    registry = private_existing(Path(args.registry), "registry")
    frozen = registry_candidates(registry, image_id)
    selection = private_existing(Path(args.selection), "selection")
    export_root = private_existing(Path(args.export_root), "export root")
    model_roots = parse_model_roots(args.model_root)
    selected = tuple(args.candidate)
    if len(set(selected)) != len(selected) or any(item not in CANDIDATES for item in selected):
        raise ValueError("candidate list must be unique and frozen")
    if set(model_roots) != set(selected):
        raise ValueError("each selected candidate requires exactly one model root")
    output_root = safe_root(Path(args.output_root), create=True)
    if not str(output_root).startswith("/home/"):
        raise ValueError("output root must remain on private WSL ext4")
    selection_value = json.loads(selection.read_bytes())
    failures: list[dict[str, Any]] = []
    registry_sha = sha256_file(registry)
    for candidate_id in selected:
        candidate = frozen[candidate_id]
        model_root = model_roots[candidate_id]
        if sha256_file(model_root / "model.safetensors") != candidate["weight"]["sha256"]:
            raise ValueError("model weight differs from the frozen registry")
        for cohort in COHORTS:
            for segment in selection_value["cohorts"][cohort]["segments"]:
                segment_id = segment["segmentId"]
                segment_key = hashlib.sha256(segment_id.encode()).hexdigest()[:12]
                input_root = output_root / "inputs" / candidate_id / cohort / segment_key
                input_root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                prepare_input(
                    cohort=cohort,
                    export_root=export_root,
                    output=input_root,
                    segment_id=segment_id,
                    selection=selection,
                )
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
                    code = run_logged(command, run_root / "runner-log.json", TIMEOUT_SECONDS)
                    if code != 0:
                        subprocess.run(
                            ["docker", "rm", "--force", name],
                            check=False,
                            capture_output=True,
                            text=True,
                        )
                        failures.append(
                            {
                                "candidateId": candidate_id,
                                "cohort": cohort,
                                "exitCode": code,
                                "runIndex": run_index,
                                "segmentKey": segment_key,
                            }
                        )
                        continue
                    run_paths.append(run_root / "candidate-result.json")
                if len(run_paths) == 2:
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
                    subprocess.run(command, check=True, capture_output=True, text=True)
    record = {
        "candidateCount": len(selected),
        "failureCount": len(failures),
        "failures": failures,
        "imageId": image_id,
        "processRes": args.process_res,
        "registrySha256": registry_sha,
        "schemaVersion": "c14-10-da3-matrix-run-v1",
        "selectionSha256": sha256_file(selection),
    }
    private_write(output_root / "matrix-result.json", canonical_bytes(record) + b"\n")
    print(json.dumps({"failureCount": len(failures), "output": str(output_root)}))


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
