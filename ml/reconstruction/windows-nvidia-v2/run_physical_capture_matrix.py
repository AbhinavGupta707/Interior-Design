#!/usr/bin/env python3
"""Run one reproducible C14.10 physical-capture COLMAP/gsplat matrix repeat."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Literal, cast

from capture_benchmark import canonical_bytes, safe_root, sha256_file

MatcherMode = Literal["exhaustive", "sequential-mobile"]
ExecutionProfileName = Literal["adapter-probe", "control-25", "quality-full"]

STAGE_KEYS = frozenset(
    [
        "colmap.analyzer",
        "colmap.convert",
        "colmap.features",
        "colmap.fusion",
        "colmap.input",
        "colmap.mapper",
        "colmap.matching",
        "colmap.patchmatch",
        "colmap.sm120",
        "colmap.undistort",
        "colmap.validation",
        "gsplat.fit",
        "gsplat.prepare",
        "prior.analyzer",
        "prior.convert",
        "prior.generate",
        "prior.triangulate",
        "priorDense.fusion",
        "priorDense.patchmatch",
        "priorDense.undistort",
        "priorDense.validation",
    ]
)
REPORTED_METRICS = frozenset(
    [
        "cameraMedianRotationErrorDegrees",
        "cameraMedianTranslationDirectionErrorDegrees",
        "depthAbsRel",
        "depthCompleteness",
        "depthRmseMetres",
        "disconnectedComponentCount",
        "eligibleFrameCount",
        "finiteDepthCount",
        "finitePointCount",
        "focalDeviationPixels",
        "fScore",
        "heldoutLpips",
        "heldoutPsnrDb",
        "heldoutSsim",
        "meanReprojectionErrorPixels",
        "meanTrackLength",
        "missingCoverageFraction",
        "occludedCoverageFraction",
        "outputBytes",
        "pointToPlaneRmseMetres",
        "principalPointDeviationPixels",
        "registeredFrameCount",
        "scaleEstimate",
        "spatialCoverageFraction",
        "temporalDepthDrift",
        "wallTimeSeconds",
    ]
)


def canonical(value: object) -> bytes:
    return canonical_bytes(value)


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_bytes())
    if not isinstance(value, dict):
        raise ValueError(f"JSON object required: {path}")
    return value


def write_new(path: Path, value: object) -> None:
    if path.exists() or path.is_symlink():
        raise ValueError(f"new file required: {path}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(canonical(value) + b"\n")


def private_existing(path: Path, label: str, *, directory: bool = False) -> Path:
    if (
        not path.is_absolute()
        or not str(path).startswith("/home/")
        or path.is_symlink()
        or (not path.is_dir() if directory else not path.is_file())
    ):
        kind = "directory" if directory else "file"
        raise ValueError(f"{label} must be a real private WSL ext4 {kind}")
    return path.resolve()


def make_directory(path: Path) -> None:
    if path.exists() or path.is_symlink():
        raise ValueError(f"fresh directory required: {path}")
    path.mkdir(mode=0o700, parents=True)
    path.chmod(0o700)


def restrict_tree(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_symlink():
            raise ValueError(f"symlink forbidden in run output: {path}")
        if path.is_dir():
            path.chmod(0o700)
        elif path.is_file():
            if path.stat().st_nlink != 1:
                raise ValueError(f"hard link forbidden in run output: {path}")
            path.chmod(0o600)
        else:
            raise ValueError(f"special file forbidden in run output: {path}")
    root.chmod(0o700)


def tree_sha256(root: Path) -> str:
    rows: list[dict[str, object]] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("symlink in derived input")
        if path.is_file():
            rows.append(
                {
                    "byteSize": path.stat().st_size,
                    "path": path.relative_to(root).as_posix(),
                    "sha256": sha256_file(path),
                }
            )
    return sha_bytes(canonical(rows))


def directory_bytes(roots: list[Path]) -> int:
    total = 0
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            try:
                if path.is_file() and not path.is_symlink():
                    total += path.stat().st_size
            except FileNotFoundError:
                continue
    return total


def gpu_sample() -> tuple[int, int, int]:
    completed = subprocess.run(
        [
            "nvidia-smi",
            "--id=0",
            "--query-gpu=memory.total,memory.used,utilization.gpu",
            "--format=csv,noheader,nounits",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    total, used, utilization = (
        int(value.strip()) for value in completed.stdout.splitlines()[0].split(",")
    )
    return total * 1024**2, used * 1024**2, utilization


def wait_for_vram(required_free_bytes: int) -> dict[str, int]:
    deadline = time.monotonic() + 60
    while True:
        total, used, utilization = gpu_sample()
        free = total - used
        if free >= required_free_bytes:
            return {
                "freeBytes": free,
                "totalBytes": total,
                "usedBytes": used,
                "utilizationPercent": utilization,
            }
        if time.monotonic() >= deadline:
            raise RuntimeError("BASELINE_VRAM_HEADROOM_UNAVAILABLE")
        time.sleep(2)


def memory_bytes(value: str) -> int:
    matched = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([KMGTP]?i?B)", value.strip())
    if matched is None:
        return 0
    units = {
        "B": 1,
        "KB": 1000,
        "MB": 1000**2,
        "GB": 1000**3,
        "TB": 1000**4,
        "KiB": 1024,
        "MiB": 1024**2,
        "GiB": 1024**3,
        "TiB": 1024**4,
    }
    return round(float(matched.group(1)) * units[matched.group(2)])


def container_memory(name: str) -> int:
    completed = subprocess.run(
        ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", name],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        return 0
    return memory_bytes(completed.stdout.strip().split("/", 1)[0])


def execution_boundary(resource_profile: dict[str, Any]) -> dict[str, object]:
    return {
        "capDropAll": True,
        "cpus": resource_profile["cpuLimit"],
        "gpuDevice": "0",
        "memoryLimitBytes": resource_profile["memoryLimitBytes"],
        "network": "none",
        "noNewPrivileges": True,
        "pidsLimit": resource_profile["pidLimit"],
        "readOnlyRoot": True,
        "scratchLimitBytes": resource_profile["scratchLimitBytes"],
        "taskVramLimitBytes": resource_profile["taskVramLimitBytes"],
        "tmpfs": "/tmp:rw,noexec,nosuid,nodev,size=2g",
        "user": f"{os.getuid()}:{os.getgid()}",
    }


def docker_command(
    *,
    name: str,
    image: str,
    mounts: list[tuple[Path, str, bool]],
    command: list[str],
    resource_profile: dict[str, Any],
    entrypoint: str | None = None,
    environment: dict[str, str] | None = None,
) -> list[str]:
    argv = [
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
        str(resource_profile["cpuLimit"]),
        "--memory",
        str(resource_profile["memoryLimitBytes"]),
        "--pids-limit",
        str(resource_profile["pidLimit"]),
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--env",
        "HOME=/tmp",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=2g",
    ]
    for key, value in sorted((environment or {}).items()):
        argv.extend(("--env", f"{key}={value}"))
    for source, destination, read_only in mounts:
        mount = f"type=bind,src={source},dst={destination}"
        argv.extend(("--mount", mount + (",readonly" if read_only else "")))
    if entrypoint is not None:
        argv.extend(("--entrypoint", entrypoint))
    return [*argv, image, *command]


def stop_container(name: str) -> None:
    subprocess.run(["docker", "stop", "--timeout", "10", name], capture_output=True)
    subprocess.run(["docker", "rm", "--force", name], capture_output=True)


def run_sampled(
    *,
    name: str,
    argv: list[str],
    log_path: Path,
    scratch_roots: list[Path],
    repository: Path,
    timeout_seconds: int,
    vram_limit_bytes: int,
) -> dict[str, Any]:
    baseline = wait_for_vram(vram_limit_bytes)
    baseline_used = baseline["usedBytes"]
    started = time.perf_counter()
    peak_vram = 0
    peak_memory = 0
    peak_utilization = 0
    peak_scratch = directory_bytes(scratch_roots)
    samples = 0
    timed_out = False
    with log_path.open("wb") as log:
        process = subprocess.Popen(argv, cwd=repository, stdout=log, stderr=subprocess.STDOUT)
        while process.poll() is None:
            if time.perf_counter() - started >= timeout_seconds:
                timed_out = True
                stop_container(name)
                break
            try:
                _, used, utilization = gpu_sample()
                peak_vram = max(peak_vram, used - baseline_used, 0)
                peak_utilization = max(peak_utilization, utilization)
            except (OSError, subprocess.SubprocessError, ValueError):
                pass
            peak_memory = max(peak_memory, container_memory(name))
            if samples % 4 == 0:
                peak_scratch = max(peak_scratch, directory_bytes(scratch_roots))
            samples += 1
            time.sleep(0.25)
        try:
            exit_code = process.wait(timeout=30 if timed_out else None)
        except subprocess.TimeoutExpired:
            process.send_signal(signal.SIGTERM)
            try:
                exit_code = process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                exit_code = process.wait()
    peak_scratch = max(peak_scratch, directory_bytes(scratch_roots))
    return {
        "argv": argv,
        "baseline": baseline,
        "elapsedSeconds": time.perf_counter() - started,
        "exitCode": exit_code,
        "logPath": log_path.name,
        "logSha256": sha256_file(log_path),
        "name": name,
        "resources": {
            "peakGpuUtilizationPercent": peak_utilization,
            "peakHostMemoryBytes": peak_memory,
            "peakVramBytesAboveBaseline": peak_vram,
            "sampleCount": samples,
            "scratchBytes": peak_scratch,
        },
        "timedOut": timed_out,
        "timeoutSeconds": timeout_seconds,
    }


def run_host(
    argv: list[str], log_path: Path, repository: Path, timeout_seconds: int
) -> dict[str, Any]:
    started = time.perf_counter()
    timed_out = False
    with log_path.open("wb") as log:
        process = subprocess.Popen(argv, cwd=repository, stdout=log, stderr=subprocess.STDOUT)
        try:
            exit_code = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            exit_code = process.wait()
            timed_out = True
    return {
        "argv": argv,
        "elapsedSeconds": time.perf_counter() - started,
        "exitCode": exit_code,
        "logPath": log_path.name,
        "logSha256": sha256_file(log_path),
        "name": log_path.stem,
        "resources": {
            "peakGpuUtilizationPercent": 0,
            "peakHostMemoryBytes": 0,
            "peakVramBytesAboveBaseline": 0,
            "sampleCount": 0,
            "scratchBytes": 0,
        },
        "timedOut": timed_out,
        "timeoutSeconds": timeout_seconds,
    }


def aggregate_resources(records: list[dict[str, Any]], roots: list[Path]) -> dict[str, int | float]:
    resources = [cast("dict[str, int]", record["resources"]) for record in records]
    return {
        "peakHostMemoryBytes": max(
            (resource["peakHostMemoryBytes"] for resource in resources), default=0
        ),
        "peakVramBytes": max(
            (resource["peakVramBytesAboveBaseline"] for resource in resources), default=0
        ),
        "scratchBytes": max(
            max((resource["scratchBytes"] for resource in resources), default=0),
            directory_bytes(roots),
        ),
        "wallTimeSeconds": sum(float(record["elapsedSeconds"]) for record in records),
    }


def artifact(path: Path, label: str) -> dict[str, object]:
    return {"byteSize": path.stat().st_size, "path": label, "sha256": sha256_file(path)}


def existing_artifacts(
    paths: list[tuple[Path, str]], fallbacks: list[Path]
) -> list[dict[str, object]]:
    artifacts = [
        artifact(path, label) for path, label in paths if path.is_file() and not path.is_symlink()
    ]
    if artifacts:
        return artifacts
    fallback = next(
        (path for path in fallbacks if path.is_file() and not path.is_symlink()),
        None,
    )
    if fallback is None:
        raise ValueError("no regular failure artifact is available")
    return [artifact(fallback, "failure.log")]


def analyzer_metrics(path: Path) -> dict[str, int | float]:
    content = path.read_text(encoding="utf-8", errors="replace")

    def value(pattern: str) -> int | float:
        matched = re.search(pattern, content)
        if matched is None:
            raise ValueError(f"analyzer metric missing: {pattern}")
        raw = matched.group(1)
        return float(raw) if "." in raw else int(raw)

    return {
        "registeredFrameCount": value(r"Registered images:\s+([0-9]+)"),
        "finitePointCount": value(r"Points:\s+([0-9]+)"),
        "meanTrackLength": value(r"Mean track length:\s+([0-9.]+)"),
        "meanReprojectionErrorPixels": value(r"Mean reprojection error:\s+([0-9.]+)px"),
    }


def metrics(**values: int | float | str) -> dict[str, object]:
    result: dict[str, object] = {name: "not-applicable" for name in REPORTED_METRICS}
    result.update(values)
    return result


def matcher_plan(mode: MatcherMode, sample_count: int | None) -> dict[str, object]:
    pair_policy: dict[str, object]
    if mode == "sequential-mobile":
        pair_policy = {
            "loopDetection": False,
            "overlap": 10,
            "quadraticOverlap": True,
            "source": "explicit-COLMAP-4.1.1-default-ordered-policy",
        }
    else:
        pair_policy = {"source": "accepted-C14.8-exhaustive-policy"}
    return {
        "captureOrderFilenames": True,
        "mode": mode,
        "pairPolicy": pair_policy,
        "sampleCount": sample_count,
    }


def matching_command(mode: MatcherMode) -> list[str]:
    common = [
        "--default_random_seed",
        "0",
        "--database_path",
        "/c8/work/database.db",
        "--FeatureMatching.use_gpu",
        "0",
        "--FeatureMatching.num_threads",
        "1",
        "--FeatureMatching.max_num_matches",
        "32768",
        "--FeatureMatching.guided_matching",
        "1",
        "--SiftMatching.cpu_brute_force_matcher",
        "1",
        "--TwoViewGeometry.random_seed",
        "0",
    ]
    if mode == "exhaustive":
        return ["exhaustive_matcher", *common]
    return [
        "sequential_matcher",
        *common,
        "--SequentialMatching.overlap",
        "10",
        "--SequentialMatching.quadratic_overlap",
        "1",
        "--SequentialMatching.loop_detection",
        "0",
        "--SequentialMatching.num_threads",
        "1",
    ]


def colmap_steps(mode: MatcherMode) -> list[tuple[str, list[str], str | None]]:
    return [
        ("sm120", [], "/usr/local/bin/c8-sm120-probe"),
        (
            "features",
            [
                "feature_extractor",
                "--default_random_seed",
                "0",
                "--database_path",
                "/c8/work/database.db",
                "--image_path",
                "/c14/input/images",
                "--ImageReader.camera_model",
                "PINHOLE",
                "--FeatureExtraction.use_gpu",
                "0",
                "--FeatureExtraction.num_threads",
                "1",
                "--FeatureExtraction.max_image_size",
                "3200",
                "--SiftExtraction.max_num_features",
                "16384",
            ],
            None,
        ),
        ("matching", matching_command(mode), None),
        (
            "mapper",
            [
                "mapper",
                "--default_random_seed",
                "0",
                "--database_path",
                "/c8/work/database.db",
                "--image_path",
                "/c14/input/images",
                "--output_path",
                "/c8/work/sparse",
                "--Mapper.multiple_models",
                "0",
                "--Mapper.num_threads",
                "1",
                "--Mapper.random_seed",
                "0",
            ],
            None,
        ),
        ("analyzer", ["model_analyzer", "--path", "/c8/work/sparse/0"], None),
        (
            "undistort",
            [
                "image_undistorter",
                "--image_path",
                "/c14/input/images",
                "--input_path",
                "/c8/work/sparse/0",
                "--output_path",
                "/c8/work/dense",
                "--output_type",
                "COLMAP",
                "--max_image_size",
                "3200",
            ],
            None,
        ),
        (
            "patchmatch",
            [
                "patch_match_stereo",
                "--workspace_path",
                "/c8/work/dense",
                "--workspace_format",
                "COLMAP",
                "--PatchMatchStereo.gpu_index",
                "0",
                "--PatchMatchStereo.geom_consistency",
                "true",
                "--PatchMatchStereo.max_image_size",
                "3200",
            ],
            None,
        ),
        (
            "fusion",
            [
                "stereo_fusion",
                "--workspace_path",
                "/c8/work/dense",
                "--workspace_format",
                "COLMAP",
                "--input_type",
                "geometric",
                "--output_path",
                "/c8/output/fused.ply",
            ],
            None,
        ),
        (
            "convert",
            [
                "model_converter",
                "--input_path",
                "/c8/work/sparse/0",
                "--output_path",
                "/c8/work/model-text",
                "--output_type",
                "TXT",
            ],
            None,
        ),
    ]


def validate_database_order(database: Path, input_manifest: Path) -> dict[str, object]:
    manifest = load_object(input_manifest)
    frames = cast("list[dict[str, object]]", manifest.get("frames"))
    expected_names = [cast("str", frame["imageName"]) for frame in frames]
    capture_indices = [cast("int", frame["captureIndex"]) for frame in frames]
    if (
        manifest.get("schemaVersion") != "c14-10-ordered-colmap-input-v2"
        or manifest.get("imageOrder") != "capture-order"
        or capture_indices != sorted(capture_indices)
        or expected_names != sorted(expected_names)
    ):
        raise ValueError("derived COLMAP input is not in declared capture order")
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        actual_names = [
            cast("str", row[0])
            for row in connection.execute("SELECT name FROM images ORDER BY image_id")
        ]
    if actual_names != expected_names:
        raise ValueError("COLMAP database image IDs do not follow capture order")
    return {
        "captureOrderSha256": sha_bytes(canonical(capture_indices)),
        "databaseImageCount": len(actual_names),
        "namesAligned": True,
        "schemaVersion": "c14-10-colmap-database-order-v1",
    }


def matcher_dependency_failure(records: list[dict[str, Any]], database: Path) -> str | None:
    matching = next(
        (record for record in records if cast("str", record.get("name", "")).endswith("-matching")),
        None,
    )
    if matching is None or matching.get("timedOut") is not False or matching.get("exitCode") != 0:
        return "UPSTREAM_MATCH_DATABASE_INCOMPLETE"
    if not database.is_file() or database.is_symlink():
        return "FEATURE_DATABASE_UNAVAILABLE"
    return None


def adapter_command(
    *,
    package: Path,
    command: Literal["colmap-input", "colmap-prior"],
    export_root: Path,
    selection: Path,
    cohort: str,
    segment_id: str,
    output: Path,
    sample_count: int | None,
    database: Path | None = None,
) -> list[str]:
    argv = [
        sys.executable,
        str(package / "capture_benchmark.py"),
        command,
        "--export-root",
        str(export_root),
        "--selection",
        str(selection),
        "--cohort",
        cohort,
        "--segment-id",
        segment_id,
        "--ordered-image-names",
    ]
    if sample_count is not None:
        argv.extend(("--ordered-sample-count", str(sample_count)))
    if database is not None:
        argv.extend(("--database", str(database)))
    argv.extend(("--output", str(output)))
    return argv


def gsplat_prepare_command(
    *,
    package: Path,
    export_root: Path,
    selection: Path,
    cohort: str,
    segment_id: str,
    model: Path,
    output: Path,
    sample_count: int | None,
    maximum_initial_gaussians: int,
) -> list[str]:
    argv = [
        "unshare",
        "--user",
        "--map-root-user",
        "--net",
        "--",
        sys.executable,
        "-B",
        str(package / "prepare_gsplat_capture.py"),
        "--export-root",
        str(export_root),
        "--selection",
        str(selection),
        "--cohort",
        cohort,
        "--segment-id",
        segment_id,
        "--model",
        str(model),
        "--output",
        str(output),
        "--ordered-image-names",
    ]
    if sample_count is not None:
        argv.extend(("--ordered-sample-count", str(sample_count)))
    argv.extend(("--maximum-initial-gaussians", str(maximum_initial_gaussians)))
    argv.extend(("--steps", "100"))
    return argv


def config_sha(
    candidate: str,
    plan: dict[str, object],
    execution_profile: ExecutionProfileName,
    resource_profile: dict[str, Any],
) -> str:
    configs: dict[str, object] = {
        "colmap-unconstrained": {
            "dense": "geometric-max3200",
            "imageModel": "PINHOLE",
            "matcherPlan": plan,
            "maxFeatures": 16384,
            "maxImageSize": 3200,
            "seed": 0,
            "threads": 1,
        },
        "colmap-arkit-prior": {
            "clearPoints": True,
            "matcherPlan": plan,
            "poseAuthority": "immutable-arkit-prior-proposal",
            "refineIntrinsics": False,
            "seed": 0,
            "threads": 1,
        },
        "gsplat-direct": {
            "geometrySource": "same-run-arkit-prior",
            "method": "fixed-geometry-global-rgb-gain",
            "seed": 0,
            "steps": 100,
        },
    }
    return sha_bytes(
        canonical(
            {
                "candidate": configs[candidate],
                "executionProfile": execution_profile,
                "resourceProfile": resource_profile,
            }
        )
    )


def controls_sha(candidate: str) -> str:
    controls: dict[str, object] = {
        "colmap-unconstrained": {
            "cpuFeatureExtraction": True,
            "cpuMatching": True,
            "defaultRandomSeed": 0,
            "mapperRandomSeed": 0,
            "numThreads": 1,
            "patchMatchGpu": 0,
        },
        "colmap-arkit-prior": {
            "defaultRandomSeed": 0,
            "mapperRandomSeed": 0,
            "numThreads": 1,
            "poseAuthority": "immutable-arkit-prior-proposal",
        },
        "gsplat-direct": {
            "cublasWorkspaceConfig": ":4096:8",
            "deterministicAlgorithms": True,
            "gsplatBackward": "disabled",
            "optimizer": "cpu-float64-adam-global-rgb-gain",
            "seed": 0,
            "tf32": False,
        },
    }
    return sha_bytes(canonical(controls[candidate]))


def fragment(
    *,
    candidate: str,
    cohort: str,
    segment_id: str,
    run_index: int,
    derived_sha256: str,
    result_metrics: dict[str, object],
    resources: dict[str, int | float],
    artifacts: list[dict[str, object]],
    failure_code: str | None,
    selection_sha256: str,
    policy_sha256: str,
    image_id: str,
    plan: dict[str, object],
    execution_profile: ExecutionProfileName,
    resource_profile: dict[str, Any],
) -> dict[str, object]:
    return {
        "candidateId": candidate,
        "cohort": cohort,
        "commandConfigSha256": config_sha(candidate, plan, execution_profile, resource_profile),
        "containerImageSha256": image_id,
        "derivedInputSha256": derived_sha256,
        "deterministicControlsSha256": controls_sha(candidate),
        "execution": execution_boundary(resource_profile),
        "executionProfile": execution_profile,
        "failureCode": failure_code,
        "metrics": result_metrics,
        "policySha256": policy_sha256,
        "rawArtifacts": artifacts,
        "resources": resources,
        "runIndex": run_index,
        "seed": 0,
        "segmentId": segment_id,
        "resourceProfileSha256": sha_bytes(canonical(resource_profile)),
        "selectionSha256": selection_sha256,
        "status": "pass" if failure_code is None else "fail",
    }


def inspect_image(image_id: str) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ValueError("image ID must be an exact sha256 identifier")
    completed = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image_id],
        check=True,
        capture_output=True,
        text=True,
    )
    if completed.stdout.strip() != image_id:
        raise ValueError("Docker image resolution changed the frozen image ID")


def validate_repository(
    repository: Path, product_source_commit: str, evaluation_harness_commit: str
) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", product_source_commit):
        raise ValueError("product source commit must be an exact 40-character SHA")
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if head != evaluation_harness_commit:
        raise RuntimeError("EVALUATION_HARNESS_SHA_MISMATCH")
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", product_source_commit, head],
        cwd=repository,
        check=False,
    )
    if ancestor.returncode != 0:
        raise RuntimeError("PRODUCT_SOURCE_NOT_ANCESTOR")
    dirty = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if dirty:
        raise RuntimeError("SOURCE_TREE_NOT_EXACT_CLEAN")


def validate_evaluation_plan(
    path: Path,
    *,
    repository: Path,
    product_source_commit: str,
    colmap_image: str,
    gsplat_image: str,
    matcher_mode: MatcherMode,
    sample_count: int | None,
    expected_frame_count: int,
    execution_profile: ExecutionProfileName,
    run_index: int,
) -> tuple[str, dict[str, Any]]:
    if (
        not path.is_absolute()
        or path.is_symlink()
        or not path.is_file()
        or not path.resolve().is_relative_to(repository.resolve())
    ):
        raise ValueError("evaluation plan must be a regular file in the repository")
    plan = load_object(path)
    if (
        plan.get("schemaVersion") != "c14-10-physical-evaluation-plan-v3"
        or plan.get("productSourceCommit") != product_source_commit
    ):
        raise ValueError("evaluation plan source contract is invalid")
    images = cast("dict[str, object]", plan.get("images"))
    if images.get("colmap") != colmap_image or images.get("gsplat") != gsplat_image:
        raise ValueError("evaluation plan image contract is invalid")
    datasets = cast("list[dict[str, object]]", plan.get("datasets"))
    if expected_frame_count not in {dataset.get("fullFrameCount") for dataset in datasets}:
        raise ValueError("evaluation plan does not contain the requested dataset")
    lanes = cast("dict[str, dict[str, object]]", plan.get("lanes"))
    lane_name = {
        "adapter-probe": "adapterEndToEndProbe",
        "control-25": "ordered25ExhaustiveControl",
        "quality-full": "qualityFullSequentialMobile",
    }[execution_profile]
    lane = lanes.get(lane_name, {})
    matcher = cast("dict[str, object]", lane.get("matcher"))
    if (
        matcher.get("mode") != matcher_mode
        or lane.get("repeats") != (1 if execution_profile == "adapter-probe" else 2)
        or lane.get("sampleCount") != sample_count
    ):
        raise ValueError("requested lane differs from the frozen evaluation plan")
    if execution_profile == "adapter-probe" and (
        lane.get("counted") is not False
        or lane.get("datasetFrameCount") != expected_frame_count
        or run_index != 1
    ):
        raise ValueError("adapter probe scope differs from the frozen plan")
    if execution_profile == "quality-full" and (
        matcher_mode != "sequential-mobile" or sample_count is not None
    ):
        raise ValueError("quality-full scope differs from the frozen plan")
    if execution_profile == "quality-full":
        stop_rule = cast("dict[str, object]", plan.get("firstPassStopRule"))
        if (
            stop_rule.get("fullQualityRepeat2") != "not-run"
            or lane.get("repeat2Decision") != "not-run-first-pass-sufficient"
        ):
            raise ValueError("quality-full stop rule differs from the frozen plan")
        if run_index != 1:
            raise ValueError("quality-full repeat 2 is closed by the frozen stop rule")
    if execution_profile == "control-25" and (matcher_mode != "exhaustive" or sample_count != 25):
        raise ValueError("control-25 scope differs from the frozen plan")
    if matcher_mode == "sequential-mobile" and matcher != {
        "loopDetection": False,
        "mode": "sequential-mobile",
        "overlap": 10,
        "quadraticOverlap": True,
    }:
        raise ValueError("sequential matcher policy differs from the frozen plan")
    rules = cast("dict[str, object]", plan.get("executionRules"))
    if (
        rules.get("stageConcurrency") != 1
        or rules.get("datasetConcurrency") != 1
        or rules.get("sparseThreads") != 1
    ):
        raise ValueError("evaluation execution rules are invalid")
    determinism = cast("dict[str, object]", plan.get("determinism"))
    maximum_initial_gaussians = determinism.get("maximumInitialGaussians")
    if (
        maximum_initial_gaussians != 20_000
        or determinism.get("initialGaussianSampling") != "sha256-ranked-colmap-record-v1"
        or determinism.get("gsplatManifestByteLimit") != 4 * 1024 * 1024
    ):
        raise ValueError("gsplat manifest compatibility contract is invalid")
    profiles = cast("dict[str, dict[str, object]]", plan.get("resourceProfiles"))
    profile_name = lane.get("resourceProfile")
    resource_profile = profiles.get(cast("str", profile_name), {})
    required_limits = (
        "cpuLimit",
        "memoryLimitBytes",
        "pidLimit",
        "scratchLimitBytes",
        "taskVramLimitBytes",
    )
    if not isinstance(profile_name, str) or any(
        not isinstance(resource_profile.get(key), int) for key in required_limits
    ):
        raise ValueError("evaluation resource profile limits are invalid")
    stage_timeouts = cast("dict[str, object]", resource_profile.get("stageTimeoutSeconds"))
    if set(stage_timeouts) != STAGE_KEYS or any(
        not isinstance(value, int) or value <= 0 for value in stage_timeouts.values()
    ):
        raise ValueError("evaluation stage timeout contract is invalid")
    validated_profile = dict(resource_profile)
    validated_profile["name"] = profile_name
    validated_profile["maximumInitialGaussians"] = maximum_initial_gaussians
    return sha256_file(path), validated_profile


def resolve_segment_id(segments: list[dict[str, object]], requested: str | None) -> str:
    matching = (
        segments
        if requested is None
        else [segment for segment in segments if segment.get("segmentId") == requested]
    )
    if len(matching) != 1:
        raise ValueError("selection does not contain exactly one requested segment")
    segment_id = matching[0].get("segmentId")
    if not isinstance(segment_id, str) or not segment_id:
        raise ValueError("selection segment ID is invalid")
    return segment_id


def execute(args: argparse.Namespace) -> None:
    repository = Path(__file__).resolve().parents[3]
    package = Path(__file__).resolve().parent
    validate_repository(repository, args.product_source_commit, args.evaluation_harness_commit)
    evaluation_plan_sha256, resource_profile = validate_evaluation_plan(
        Path(args.evaluation_plan),
        repository=repository,
        product_source_commit=args.product_source_commit,
        colmap_image=args.colmap_image,
        gsplat_image=args.gsplat_image,
        matcher_mode=args.matcher_mode,
        sample_count=args.sample_count,
        expected_frame_count=args.expected_frame_count,
        execution_profile=args.execution_profile,
        run_index=args.run_index,
    )
    stage_timeouts = cast("dict[str, int]", resource_profile["stageTimeoutSeconds"])
    scratch_limit_bytes = cast("int", resource_profile["scratchLimitBytes"])
    vram_limit_bytes = cast("int", resource_profile["taskVramLimitBytes"])
    maximum_initial_gaussians = cast("int", resource_profile["maximumInitialGaussians"])
    inspect_image(args.colmap_image)
    inspect_image(args.gsplat_image)
    export_root = private_existing(Path(args.export_root), "export root", directory=True)
    selection_path = private_existing(Path(args.selection), "selection")
    policy_path = private_existing(Path(args.policy), "policy")
    host_path = private_existing(Path(args.host_capabilities), "host capabilities")
    authority_root = private_existing(Path(args.authority_root), "authority root", directory=True)
    output_root = safe_root(Path(args.output_root), create=False)
    if not str(output_root).startswith("/home/") or output_root.is_symlink():
        raise ValueError("output root must remain on private WSL ext4")
    if not re.fullmatch(r"[a-z0-9-]+", args.record_stem):
        raise ValueError("record stem is invalid")

    selection = load_object(selection_path)
    policy = load_object(policy_path)
    host = load_object(host_path)
    if policy.get("selectionSha256") != sha256_file(selection_path):
        raise ValueError("policy does not bind the exact selection")
    images = cast("dict[str, dict[str, object]]", host.get("images"))
    if (
        images.get("colmap", {}).get("id") != args.colmap_image
        or images.get("gsplat", {}).get("id") != args.gsplat_image
    ):
        raise ValueError("host capabilities do not bind the exact images")
    cohorts = cast("dict[str, dict[str, object]]", selection.get("cohorts"))
    normal = cast("dict[str, object]", cohorts.get("normal"))
    inclusive = cast("dict[str, object]", cohorts.get("inclusive"))
    if normal != inclusive:
        raise ValueError("normal/inclusive deduplication is not valid for this capture")
    segments = cast("list[dict[str, object]]", normal.get("segments"))
    segment_id = resolve_segment_id(segments, args.segment_id)
    matching_segment = next(
        segment for segment in segments if segment.get("segmentId") == segment_id
    )
    full_count = len(cast("list[object]", matching_segment.get("frames")))
    if full_count != args.expected_frame_count:
        raise ValueError("full capture frame count differs from the frozen plan")
    effective_count = args.sample_count or full_count
    if args.matcher_mode == "sequential-mobile" and args.sample_count is not None:
        raise ValueError("sequential-mobile is reserved for the complete capture")
    if args.matcher_mode == "exhaustive" and args.sample_count not in (25, 32):
        raise ValueError("exhaustive scope is reserved for the declared probe or control")

    run_root = output_root / f"{args.record_stem}-r{args.run_index}"
    make_directory(run_root)
    logs = run_root / "logs"
    make_directory(logs)
    derived = run_root / "colmap-input"
    input_record = run_host(
        adapter_command(
            package=package,
            command="colmap-input",
            export_root=export_root,
            selection=selection_path,
            cohort=args.cohort,
            segment_id=segment_id,
            output=derived,
            sample_count=args.sample_count,
        ),
        logs / "colmap-input.log",
        repository,
        stage_timeouts["colmap.input"],
    )
    if input_record["exitCode"] != 0:
        raise RuntimeError("COLMAP_INPUT_FAILED")
    input_manifest = load_object(derived / "colmap-input.json")
    if len(cast("list[object]", input_manifest.get("frames"))) != effective_count:
        raise ValueError("derived input frame count differs from the frozen plan")
    derived_sha256 = sha_bytes(
        canonical(
            {
                "cohort": args.cohort,
                "colmapInputSha256": tree_sha256(derived),
                "segmentId": segment_id,
                "selectionSha256": sha256_file(selection_path),
            }
        )
    )
    selection_sha256 = sha256_file(selection_path)
    policy_sha256 = sha256_file(policy_path)
    plan = matcher_plan(args.matcher_mode, args.sample_count)

    work = run_root / "colmap-work"
    output = run_root / "colmap-output"
    make_directory(work)
    make_directory(work / "sparse")
    make_directory(work / "model-text")
    make_directory(output)
    records: list[dict[str, Any]] = []
    failure: str | None = None
    order_validation = run_root / "database-order-validation.json"
    name_prefix = sha_bytes(canonical([args.record_stem, args.run_index, segment_id]))[:16]
    for step, command, entrypoint in colmap_steps(args.matcher_mode):
        if failure is not None:
            break
        name = f"c1410-{name_prefix}-{step}"
        record = run_sampled(
            name=name,
            argv=docker_command(
                name=name,
                image=args.colmap_image,
                mounts=[
                    (derived, "/c14/input", True),
                    (work, "/c8/work", False),
                    (output, "/c8/output", False),
                ],
                command=command,
                entrypoint=entrypoint,
                resource_profile=resource_profile,
            ),
            log_path=logs / f"colmap-{step}.log",
            scratch_roots=[work, output],
            repository=repository,
            timeout_seconds=stage_timeouts[f"colmap.{step}"],
            vram_limit_bytes=vram_limit_bytes,
        )
        records.append(record)
        if record["timedOut"]:
            failure = "COMMAND_TIMEOUT"
        elif record["exitCode"] != 0:
            failure = f"COLMAP_{step.upper()}_FAILED"
        elif record["resources"]["peakVramBytesAboveBaseline"] > vram_limit_bytes:
            failure = "RESOURCE_CEILING_EXCEEDED_VRAM"
        elif record["resources"]["scratchBytes"] > scratch_limit_bytes:
            failure = "RESOURCE_CEILING_EXCEEDED_SCRATCH"
        elif step == "features":
            try:
                write_new(
                    order_validation,
                    validate_database_order(work / "database.db", derived / "colmap-input.json"),
                )
            except (OSError, ValueError, sqlite3.Error):
                failure = "DATABASE_IMAGE_ORDER_MISMATCH"

    validation = run_root / "colmap-validation.json"
    sparse: dict[str, int | float] = {}
    if failure is None:
        validation_record = run_host(
            [
                sys.executable,
                str(package / "validate_colmap_outputs.py"),
                "--dense-root",
                str(work / "dense"),
                "--ply",
                str(output / "fused.ply"),
            ],
            validation,
            repository,
            stage_timeouts["colmap.validation"],
        )
        records.append(validation_record)
        if validation_record["exitCode"] != 0:
            failure = "COLMAP_OUTPUT_VALIDATION_FAILED"
        else:
            try:
                sparse = analyzer_metrics(logs / "colmap-analyzer.log")
                dense = cast("dict[str, object]", load_object(validation).get("ply"))
                if (
                    sparse["registeredFrameCount"] < 2
                    or sparse["finitePointCount"] <= 0
                    or dense.get("payloadValidated") is not True
                    or not isinstance(dense.get("vertexCount"), int)
                    or cast("int", dense["vertexCount"]) <= 0
                ):
                    failure = "COLMAP_ALGORITHM_GATE_FAILED"
            except (OSError, ValueError, KeyError, TypeError):
                failure = "COLMAP_METRIC_EXTRACTION_FAILED"
    unconstrained_resources = aggregate_resources(records, [work, output])
    unconstrained_metrics = metrics(
        eligibleFrameCount=effective_count,
        outputBytes=sum(path.stat().st_size for path in output.rglob("*") if path.is_file()),
        wallTimeSeconds=unconstrained_resources["wallTimeSeconds"],
        **sparse,
    )
    fragments = run_root / "fragments"
    make_directory(fragments)
    unconstrained_path = fragments / "colmap-unconstrained.json"
    fallback_logs = [
        logs / f"colmap-{cast('str', record['name']).split('-')[-1]}.log"
        for record in reversed(records)
    ]
    unconstrained_artifacts = existing_artifacts(
        [
            (output / "fused.ply", "fused.ply"),
            (work / "model-text/cameras.txt", "model-text/cameras.txt"),
            (work / "model-text/images.txt", "model-text/images.txt"),
            (work / "model-text/points3D.txt", "model-text/points3D.txt"),
            (validation, "validation.json"),
            (logs / "colmap-analyzer.log", "analyzer.log"),
            (order_validation, "database-order-validation.json"),
        ],
        [*fallback_logs, logs / "colmap-input.log"],
    )
    write_new(
        unconstrained_path,
        fragment(
            candidate="colmap-unconstrained",
            cohort=args.cohort,
            segment_id=segment_id,
            run_index=args.run_index,
            derived_sha256=derived_sha256,
            result_metrics=unconstrained_metrics,
            resources=unconstrained_resources,
            artifacts=unconstrained_artifacts,
            failure_code=failure,
            selection_sha256=selection_sha256,
            policy_sha256=policy_sha256,
            image_id=args.colmap_image,
            plan=plan,
            execution_profile=args.execution_profile,
            resource_profile=resource_profile,
        ),
    )

    prior_records: list[dict[str, Any]] = []
    prior_failure = matcher_dependency_failure(records, work / "database.db")
    prior_work = run_root / "prior-work"
    prior_input = run_root / "prior-input"
    prior_output = run_root / "prior-output"
    make_directory(prior_work)
    make_directory(prior_output)
    make_directory(prior_output / "sparse")
    make_directory(prior_output / "model-text")
    if prior_failure is None:
        shutil.copy2(work / "database.db", prior_work / "database.db")
        (prior_work / "database.db").chmod(0o600)
        prior_record = run_host(
            adapter_command(
                package=package,
                command="colmap-prior",
                export_root=export_root,
                selection=selection_path,
                cohort=args.cohort,
                segment_id=segment_id,
                output=prior_input,
                sample_count=args.sample_count,
                database=prior_work / "database.db",
            ),
            logs / "prior-generate.log",
            repository,
            stage_timeouts["prior.generate"],
        )
        prior_records.append(prior_record)
        if prior_record["exitCode"] != 0:
            prior_failure = "ARKIT_PRIOR_GENERATION_FAILED"
    prior_steps = [
        (
            "triangulate",
            [
                "point_triangulator",
                "--default_random_seed",
                "0",
                "--database_path",
                "/c8/work/database.db",
                "--image_path",
                "/c14/input/images",
                "--input_path",
                "/c14/prior",
                "--output_path",
                "/c8/output/sparse",
                "--clear_points",
                "1",
                "--refine_intrinsics",
                "0",
                "--Mapper.num_threads",
                "1",
                "--Mapper.random_seed",
                "0",
            ],
        ),
        ("analyzer", ["model_analyzer", "--path", "/c8/output/sparse"]),
        (
            "convert",
            [
                "model_converter",
                "--input_path",
                "/c8/output/sparse",
                "--output_path",
                "/c8/output/model-text",
                "--output_type",
                "TXT",
            ],
        ),
    ]
    for step, command in prior_steps:
        if prior_failure is not None:
            break
        name = f"c1410-{name_prefix}-prior-{step}"
        record = run_sampled(
            name=name,
            argv=docker_command(
                name=name,
                image=args.colmap_image,
                mounts=[
                    (derived, "/c14/input", True),
                    (prior_input, "/c14/prior", True),
                    (prior_work, "/c8/work", False),
                    (prior_output, "/c8/output", False),
                ],
                command=command,
                resource_profile=resource_profile,
            ),
            log_path=logs / f"prior-{step}.log",
            scratch_roots=[prior_work, prior_output],
            repository=repository,
            timeout_seconds=stage_timeouts[f"prior.{step}"],
            vram_limit_bytes=vram_limit_bytes,
        )
        prior_records.append(record)
        if record["timedOut"]:
            prior_failure = "COMMAND_TIMEOUT"
        elif record["exitCode"] != 0:
            prior_failure = f"ARKIT_PRIOR_{step.upper()}_FAILED"
    prior_sparse: dict[str, int | float] = {}
    if prior_failure is None:
        try:
            prior_sparse = analyzer_metrics(logs / "prior-analyzer.log")
            if prior_sparse["registeredFrameCount"] < 2 or prior_sparse["finitePointCount"] <= 0:
                prior_failure = "ARKIT_PRIOR_ALGORITHM_GATE_FAILED"
        except (OSError, ValueError, KeyError):
            prior_failure = "ARKIT_PRIOR_METRIC_EXTRACTION_FAILED"
    prior_resources = aggregate_resources(prior_records, [prior_work, prior_output])
    prior_metrics = metrics(
        eligibleFrameCount=effective_count,
        outputBytes=sum(path.stat().st_size for path in prior_output.rglob("*") if path.is_file()),
        wallTimeSeconds=prior_resources["wallTimeSeconds"],
        **prior_sparse,
    )
    prior_artifacts = existing_artifacts(
        [
            (prior_output / "model-text/cameras.txt", "model-text/cameras.txt"),
            (prior_output / "model-text/images.txt", "model-text/images.txt"),
            (prior_output / "model-text/points3D.txt", "model-text/points3D.txt"),
            (prior_input / "prior-manifest.json", "prior-manifest.json"),
            (logs / "prior-analyzer.log", "analyzer.log"),
        ],
        [logs / "prior-generate.log", logs / "colmap-input.log"],
    )
    prior_path = fragments / "colmap-arkit-prior.json"
    write_new(
        prior_path,
        fragment(
            candidate="colmap-arkit-prior",
            cohort=args.cohort,
            segment_id=segment_id,
            run_index=args.run_index,
            derived_sha256=derived_sha256,
            result_metrics=prior_metrics,
            resources=prior_resources,
            artifacts=prior_artifacts,
            failure_code=prior_failure,
            selection_sha256=selection_sha256,
            policy_sha256=policy_sha256,
            image_id=args.colmap_image,
            plan=plan,
            execution_profile=args.execution_profile,
            resource_profile=resource_profile,
        ),
    )

    prior_dense_records: list[dict[str, Any]] = []
    prior_dense_failure = prior_failure
    prior_dense_validation = run_root / "prior-dense-validation.json"
    prior_dense_vertices: int | None = None
    prior_dense_steps = [
        (
            "undistort",
            [
                "image_undistorter",
                "--image_path",
                "/c14/input/images",
                "--input_path",
                "/c8/output/sparse",
                "--output_path",
                "/c8/work/dense",
                "--output_type",
                "COLMAP",
                "--max_image_size",
                "3200",
            ],
        ),
        (
            "patchmatch",
            [
                "patch_match_stereo",
                "--workspace_path",
                "/c8/work/dense",
                "--workspace_format",
                "COLMAP",
                "--PatchMatchStereo.gpu_index",
                "0",
                "--PatchMatchStereo.geom_consistency",
                "true",
                "--PatchMatchStereo.max_image_size",
                "3200",
            ],
        ),
        (
            "fusion",
            [
                "stereo_fusion",
                "--workspace_path",
                "/c8/work/dense",
                "--workspace_format",
                "COLMAP",
                "--input_type",
                "geometric",
                "--output_path",
                "/c8/output/fused.ply",
            ],
        ),
    ]
    for step, command in prior_dense_steps:
        if prior_dense_failure is not None:
            break
        name = f"c1410-{name_prefix}-prior-dense-{step}"
        record = run_sampled(
            name=name,
            argv=docker_command(
                name=name,
                image=args.colmap_image,
                mounts=[
                    (derived, "/c14/input", True),
                    (prior_work, "/c8/work", False),
                    (prior_output, "/c8/output", False),
                ],
                resource_profile=resource_profile,
                command=command,
            ),
            log_path=logs / f"prior-dense-{step}.log",
            scratch_roots=[prior_work, prior_output],
            repository=repository,
            timeout_seconds=stage_timeouts[f"priorDense.{step}"],
            vram_limit_bytes=vram_limit_bytes,
        )
        prior_dense_records.append(record)
        if record["timedOut"]:
            prior_dense_failure = "COMMAND_TIMEOUT"
        elif record["exitCode"] != 0:
            prior_dense_failure = f"ARKIT_PRIOR_DENSE_{step.upper()}_FAILED"
        elif record["resources"]["peakVramBytesAboveBaseline"] > vram_limit_bytes:
            prior_dense_failure = "RESOURCE_CEILING_EXCEEDED_VRAM"
        elif record["resources"]["scratchBytes"] > scratch_limit_bytes:
            prior_dense_failure = "RESOURCE_CEILING_EXCEEDED_SCRATCH"
    if prior_failure is None and prior_dense_failure is None:
        validation_record = run_host(
            [
                sys.executable,
                str(package / "validate_colmap_outputs.py"),
                "--dense-root",
                str(prior_work / "dense"),
                "--ply",
                str(prior_output / "fused.ply"),
            ],
            prior_dense_validation,
            repository,
            stage_timeouts["priorDense.validation"],
        )
        prior_dense_records.append(validation_record)
        if validation_record["exitCode"] != 0:
            prior_dense_failure = "ARKIT_PRIOR_DENSE_VALIDATION_FAILED"
        else:
            dense = cast("dict[str, object]", load_object(prior_dense_validation).get("ply"))
            if (
                dense.get("payloadValidated") is not True
                or not isinstance(dense.get("vertexCount"), int)
                or cast("int", dense["vertexCount"]) <= 0
            ):
                prior_dense_failure = "ARKIT_PRIOR_DENSE_VALIDATION_FAILED"
            else:
                prior_dense_vertices = cast("int", dense["vertexCount"])
    prior_dense_resources = aggregate_resources(prior_dense_records, [prior_work, prior_output])
    prior_dense_artifacts = existing_artifacts(
        [
            (prior_output / "fused.ply", "fused.ply"),
            (prior_dense_validation, "validation.json"),
        ],
        [logs / "prior-generate.log", logs / "colmap-input.log"],
    )
    prior_dense_record = {
        "artifacts": prior_dense_artifacts,
        "failureCode": prior_dense_failure,
        "resources": prior_dense_resources,
        "status": (
            "not-run"
            if prior_failure is not None
            else "pass"
            if prior_dense_failure is None
            else "fail"
        ),
        "vertexCount": prior_dense_vertices,
    }
    write_new(run_root / "prior-dense-record.json", prior_dense_record)

    gsplat_records: list[dict[str, Any]] = []
    gsplat_failure: str | None = None
    gsplat_input = run_root / "gsplat-input"
    gsplat_output = run_root / "gsplat-output"
    make_directory(gsplat_input)
    make_directory(gsplat_output)
    required_model = [
        prior_output / "model-text/cameras.txt",
        prior_output / "model-text/images.txt",
        prior_output / "model-text/points3D.txt",
    ]
    if prior_failure is not None or not all(path.is_file() for path in required_model):
        gsplat_failure = "ARKIT_PRIOR_GEOMETRY_UNAVAILABLE"
    else:
        prepare_record = run_host(
            gsplat_prepare_command(
                package=package,
                export_root=export_root,
                selection=selection_path,
                cohort=args.cohort,
                segment_id=segment_id,
                model=prior_output / "model-text",
                output=gsplat_input,
                sample_count=args.sample_count,
                maximum_initial_gaussians=maximum_initial_gaussians,
            ),
            logs / "gsplat-prepare.log",
            repository,
            stage_timeouts["gsplat.prepare"],
        )
        gsplat_records.append(prepare_record)
        if prepare_record["exitCode"] != 0:
            gsplat_failure = "GSPLAT_PREPARATION_FAILED"
    if gsplat_failure is None:
        name = f"c1410-{name_prefix}-gsplat"
        gsplat_record = run_sampled(
            name=name,
            argv=docker_command(
                name=name,
                image=args.gsplat_image,
                mounts=[
                    (gsplat_input, "/c8/input", True),
                    (gsplat_output, "/c8/output", False),
                ],
                command=["/opt/c8/direct_gsplat_capture.py"],
                entrypoint="python",
                environment={"CUBLAS_WORKSPACE_CONFIG": ":4096:8"},
                resource_profile=resource_profile,
            ),
            log_path=logs / "gsplat-direct.log",
            scratch_roots=[gsplat_input, gsplat_output],
            repository=repository,
            timeout_seconds=stage_timeouts["gsplat.fit"],
            vram_limit_bytes=vram_limit_bytes,
        )
        gsplat_records.append(gsplat_record)
        if gsplat_record["timedOut"]:
            gsplat_failure = "COMMAND_TIMEOUT"
        elif gsplat_record["exitCode"] != 0:
            gsplat_failure = "GSPLAT_DIRECT_FAILED"
        elif gsplat_record["resources"]["peakVramBytesAboveBaseline"] > vram_limit_bytes:
            gsplat_failure = "RESOURCE_CEILING_EXCEEDED_VRAM"
        elif gsplat_record["resources"]["scratchBytes"] > scratch_limit_bytes:
            gsplat_failure = "RESOURCE_CEILING_EXCEEDED_SCRATCH"
    result: dict[str, Any] = {}
    if gsplat_failure is None:
        try:
            result = load_object(gsplat_output / "appearance-result.json")
            if result.get("algorithmVerdict") != "passed":
                gsplat_failure = "GSPLAT_ALGORITHM_GATE_FAILED"
        except (OSError, ValueError, json.JSONDecodeError):
            gsplat_failure = "GSPLAT_RESULT_INVALID"
    gsplat_resources = aggregate_resources(gsplat_records, [gsplat_input, gsplat_output])
    if isinstance(result.get("peakGpuMemoryBytes"), int):
        gsplat_resources["peakVramBytes"] = max(
            int(gsplat_resources["peakVramBytes"]), result["peakGpuMemoryBytes"]
        )
    if isinstance(result.get("peakHostMemoryBytes"), int):
        gsplat_resources["peakHostMemoryBytes"] = max(
            int(gsplat_resources["peakHostMemoryBytes"]), result["peakHostMemoryBytes"]
        )
    appearance_input = (
        load_object(gsplat_input / "appearance-input.json")
        if (gsplat_input / "appearance-input.json").is_file()
        else {}
    )
    gsplat_metrics = metrics(
        eligibleFrameCount=len(cast("list[object]", appearance_input.get("frames", []))),
        finitePointCount=len(cast("list[object]", appearance_input.get("initialGaussians", []))),
        heldoutPsnrDb=result.get("heldOutPsnrDb", "not-applicable"),
        outputBytes=sum(path.stat().st_size for path in gsplat_output.rglob("*") if path.is_file()),
        wallTimeSeconds=gsplat_resources["wallTimeSeconds"],
    )
    gsplat_artifacts = existing_artifacts(
        [
            (gsplat_input / "capture-preparation.json", "capture-preparation.json"),
            (gsplat_output / "appearance.ply", "appearance.ply"),
            (
                gsplat_output / "appearance-checkpoint.json",
                "appearance-checkpoint.json",
            ),
            (gsplat_output / "appearance-result.json", "appearance-result.json"),
        ],
        [logs / "gsplat-prepare.log", logs / "colmap-input.log"],
    )
    gsplat_path = fragments / "gsplat-direct.json"
    write_new(
        gsplat_path,
        fragment(
            candidate="gsplat-direct",
            cohort=args.cohort,
            segment_id=segment_id,
            run_index=args.run_index,
            derived_sha256=derived_sha256,
            result_metrics=gsplat_metrics,
            resources=gsplat_resources,
            artifacts=gsplat_artifacts,
            failure_code=gsplat_failure,
            selection_sha256=selection_sha256,
            policy_sha256=policy_sha256,
            image_id=args.gsplat_image,
            plan=plan,
            execution_profile=args.execution_profile,
            resource_profile=resource_profile,
        ),
    )

    is_counted = args.execution_profile != "adapter-probe"
    write_new(
        run_root / "private-command-records.json",
        {
            "authority": (
                "private-c14-10-physical-counted-raw-evidence"
                if is_counted
                else "private-c14-10-adapter-probe-raw-evidence"
            ),
            "colmap": records,
            "evaluationPlanSha256": evaluation_plan_sha256,
            "executionProfile": args.execution_profile,
            "evaluationHarnessCommit": args.evaluation_harness_commit,
            "gsplat": gsplat_records,
            "prior": prior_records,
            "priorDense": prior_dense_records,
            "productSourceCommit": args.product_source_commit,
            "resourceProfile": resource_profile,
            "runIndex": args.run_index,
        },
    )
    record_path = authority_root / f"{args.record_stem}-r{args.run_index}.json"
    write_new(
        record_path,
        {
            "authority": (
                "private-proposal-only" if is_counted else "private-diagnostic-adapter-probe-only"
            ),
            "counted": is_counted,
            "cohort": args.cohort,
            "cohortDeduplication": "inclusive-identical-not-rerun",
            "evaluationHarnessCommit": args.evaluation_harness_commit,
            "evaluationPlanSha256": evaluation_plan_sha256,
            "hostCapabilitiesSha256": sha256_file(host_path),
            "inputEnvelopeSha256": selection["envelopeSha256"],
            "executionProfile": args.execution_profile,
            "matcherPlan": plan,
            "open3d": {
                "reason": "EXACT_BOUND_DEPTH_ABSENT",
                "status": "abstained",
            },
            "priorDense": prior_dense_record,
            "productSourceCommit": args.product_source_commit,
            "runIndex": args.run_index,
            "resourceProfile": resource_profile,
            "runs": [
                load_object(unconstrained_path),
                load_object(prior_path),
                load_object(gsplat_path),
            ],
            "schemaVersion": "c14-10-physical-matrix-v3",
            "selectionSha256": selection_sha256,
        },
    )
    restrict_tree(run_root)
    record_path.chmod(0o600)
    print(
        json.dumps(
            {
                "counted": is_counted,
                "effectiveFrameCount": effective_count,
                "executionProfile": args.execution_profile,
                "recordSha256": sha256_file(record_path),
                "runIndex": args.run_index,
            },
            sort_keys=True,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product-source-commit", required=True)
    parser.add_argument("--evaluation-harness-commit", required=True)
    parser.add_argument("--evaluation-plan", required=True)
    parser.add_argument("--export-root", required=True)
    parser.add_argument("--selection", required=True)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--host-capabilities", required=True)
    parser.add_argument("--authority-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--record-stem", required=True)
    parser.add_argument("--segment-id")
    parser.add_argument("--cohort", choices=("normal",), default="normal")
    parser.add_argument("--expected-frame-count", type=int, required=True)
    parser.add_argument("--sample-count", type=int)
    parser.add_argument(
        "--execution-profile",
        choices=("adapter-probe", "control-25", "quality-full"),
        required=True,
    )
    parser.add_argument(
        "--matcher-mode",
        choices=("exhaustive", "sequential-mobile"),
        required=True,
    )
    parser.add_argument("--run-index", choices=(1, 2), type=int, required=True)
    parser.add_argument("--colmap-image", required=True)
    parser.add_argument("--gsplat-image", required=True)
    return parser


def main() -> None:
    try:
        execute(build_parser().parse_args())
    except (
        OSError,
        RuntimeError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.SubprocessError,
        json.JSONDecodeError,
        sqlite3.Error,
    ) as error:
        print(f"physical capture matrix failed: {error}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
