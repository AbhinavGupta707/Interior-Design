#!/usr/bin/env python3
"""Run repeatable, rights-cleared C8 v2 acceptance on one WSL-visible GPU.

The runner never builds images, installs drivers/toolkits, or prunes Docker. It
requires exact local image IDs and a clean exact source commit. Results remain raw
acceptance material until reviewed into the typed durable evidence envelope.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import stat
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from functools import partial
from pathlib import Path
from typing import cast

SCHEMA_VERSION = "c8-blackwell-acceptance-runner-v2"
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
SAFE_NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,62}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = Path(__file__).resolve().parent
COLMAP_FIXTURE_GENERATOR = PACKAGE_ROOT / "generate_colmap_fixture.py"
GSPLAT_FIXTURE_GENERATOR = "/opt/c8/generate_gsplat_fixture.py"
VALIDATOR = PACKAGE_ROOT / "validate_colmap_outputs.py"


@dataclass(slots=True)
class ResourceSample:
    elapsed_milliseconds: int
    peak_gpu_memory_bytes_above_baseline: int
    peak_gpu_utilization_percent: int
    peak_container_memory_bytes: int
    sample_count: int
    measurement_basis: str = (
        "250ms nvidia-smi GPU-0 total-memory delta and docker-stats container memory"
    )


@dataclass(slots=True)
class CommandRecord:
    name: str
    argv: list[str]
    exit_code: int
    log_path: str
    log_sha256: str
    resources: ResourceSample


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _hashed(path: Path, root: Path) -> dict[str, object]:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"unsafe hash target: {path}")
    return {
        "byteSize": path.stat().st_size,
        "identifier": path.relative_to(root).as_posix(),
        "sha256": _sha256(path),
    }


def _prepare_directory(
    path: Path,
    *,
    empty: bool = True,
    writable_by_container: bool = False,
) -> None:
    if path.is_symlink():
        raise ValueError(f"symlink directory is forbidden: {path}")
    if path.exists():
        if not path.is_dir() or (empty and any(path.iterdir())):
            raise ValueError(f"directory must be empty: {path}")
    else:
        path.mkdir(parents=True)
    if writable_by_container:
        path.chmod(stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)


def _exact_output_root(value: str) -> Path:
    root = Path(value)
    if not root.is_absolute() or root.is_symlink():
        raise ValueError("output root must be an absolute non-symlink path")
    resolved = root.resolve()
    if resolved != root:
        raise ValueError("output root must already be normalized")
    _prepare_directory(root)
    return root


def _run_checked(argv: list[str], *, cwd: Path = REPOSITORY_ROOT) -> str:
    return subprocess.run(
        argv,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _verify_source(source_commit: str) -> None:
    if COMMIT.fullmatch(source_commit) is None:
        raise ValueError("source commit must be a full lowercase Git SHA")
    if _run_checked(["git", "rev-parse", "HEAD"]) != source_commit:
        raise ValueError("source commit does not equal checked-out HEAD")
    subprocess.run(["git", "diff", "--quiet"], cwd=REPOSITORY_ROOT, check=True)
    subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPOSITORY_ROOT, check=True)


def _verify_image(image: str) -> dict[str, object]:
    if DIGEST.fullmatch(image) is None:
        raise ValueError("images must be immutable local sha256 IDs")
    inspected = json.loads(_run_checked(["docker", "image", "inspect", image]))
    if not isinstance(inspected, list) or len(inspected) != 1:
        raise ValueError("image inspection did not return exactly one image")
    record = cast("dict[str, object]", inspected[0])
    if record.get("Id") != image:
        raise ValueError("image ID does not match the requested digest")
    config = cast("dict[str, object]", record.get("Config"))
    labels = config.get("Labels")
    return {
        "id": image,
        "labels": labels if isinstance(labels, dict) else {},
        "sizeBytes": record.get("Size"),
    }


def _gpu_values() -> tuple[int, int]:
    try:
        line = _run_checked(
            [
                "nvidia-smi",
                "--id=0",
                "--query-gpu=memory.used,utilization.gpu",
                "--format=csv,noheader,nounits",
            ]
        ).splitlines()[0]
        memory_mib, utilization = (int(value.strip()) for value in line.split(",", 1))
        return memory_mib * 1024 * 1024, utilization
    except (IndexError, OSError, subprocess.CalledProcessError, ValueError):
        return (0, 0)


def _memory_bytes(value: str) -> int:
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([KMGTP]?i?B)", value.strip())
    if match is None:
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
    return round(float(match.group(1)) * units[match.group(2)])


def _container_memory(name: str) -> int:
    try:
        output = _run_checked(
            ["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", name]
        )
        return _memory_bytes(output.split("/", 1)[0])
    except (OSError, subprocess.CalledProcessError, ValueError):
        return 0


def _container_argv(
    *,
    name: str,
    image: str,
    input_root: Path,
    work_root: Path,
    output_root: Path,
    command: tuple[str, ...],
    entrypoint: str | None = None,
) -> list[str]:
    if SAFE_NAME.fullmatch(name) is None or DIGEST.fullmatch(image) is None:
        raise ValueError("unsafe container name or image")
    for root in (input_root, work_root, output_root):
        if root.is_symlink() or not root.is_absolute() or not root.is_dir():
            raise ValueError("container roots must be absolute real directories")
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
        "12",
        "--memory",
        "24g",
        "--pids-limit",
        "512",
        "--user",
        "65532:65532",
        "--env",
        "HOME=/tmp",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=2g",
        "--mount",
        f"type=bind,src={input_root},dst=/c8/input,readonly",
        "--mount",
        f"type=bind,src={work_root},dst=/c8/work",
        "--mount",
        f"type=bind,src={output_root},dst=/c8/output",
    ]
    if entrypoint is not None:
        argv.extend(("--entrypoint", entrypoint))
    argv.append(image)
    argv.extend(command)
    return argv


def _sampled_command(
    *,
    name: str,
    argv: list[str],
    log_path: Path,
) -> CommandRecord:
    baseline_memory, _baseline_utilization = _gpu_values()
    started = time.perf_counter()
    peak_gpu_memory = 0
    peak_gpu_utilization = 0
    peak_container_memory = 0
    samples = 0
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            argv,
            cwd=REPOSITORY_ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        while process.poll() is None:
            current_memory, utilization = _gpu_values()
            peak_gpu_memory = max(peak_gpu_memory, current_memory - baseline_memory, 0)
            peak_gpu_utilization = max(peak_gpu_utilization, utilization)
            peak_container_memory = max(peak_container_memory, _container_memory(name))
            samples += 1
            time.sleep(0.25)
        exit_code = process.wait()
    resources = ResourceSample(
        elapsed_milliseconds=max(1, round((time.perf_counter() - started) * 1000)),
        peak_gpu_memory_bytes_above_baseline=peak_gpu_memory,
        peak_gpu_utilization_percent=peak_gpu_utilization,
        peak_container_memory_bytes=peak_container_memory,
        sample_count=samples,
    )
    record = CommandRecord(
        name=name,
        argv=argv,
        exit_code=exit_code,
        log_path=log_path.name,
        log_sha256=_sha256(log_path),
        resources=resources,
    )
    if exit_code != 0:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-4000:]
        raise RuntimeError(f"{name} failed with exit {exit_code}\n{tail}")
    return record


def _run_container(
    *,
    prefix: str,
    command_name: str,
    image: str,
    input_root: Path,
    work_root: Path,
    output_root: Path,
    logs_root: Path,
    command: tuple[str, ...] = (),
    entrypoint: str | None = None,
) -> CommandRecord:
    safe = f"{prefix}-{command_name}"
    argv = _container_argv(
        name=safe,
        image=image,
        input_root=input_root,
        work_root=work_root,
        output_root=output_root,
        command=command,
        entrypoint=entrypoint,
    )
    return _sampled_command(name=safe, argv=argv, log_path=logs_root / f"{safe}.log")


def _last_json(path: Path) -> dict[str, object]:
    for line in reversed(path.read_text(encoding="utf-8", errors="strict").splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return cast("dict[str, object]", value)
    raise ValueError(f"no JSON object found in {path}")


def _aggregate_resources(records: list[CommandRecord]) -> dict[str, object]:
    return {
        "elapsedMilliseconds": sum(record.resources.elapsed_milliseconds for record in records),
        "measurementBasis": records[0].resources.measurement_basis,
        "peakGpuMemoryBytes": max(
            record.resources.peak_gpu_memory_bytes_above_baseline for record in records
        ),
        "peakGpuUtilizationPercent": max(
            record.resources.peak_gpu_utilization_percent for record in records
        ),
        "peakHostMemoryBytes": max(
            record.resources.peak_container_memory_bytes for record in records
        ),
        "sampleCount": sum(record.resources.sample_count for record in records),
    }


def _colmap_profile(version: str) -> dict[str, object]:
    if version == "4.1.1":
        return {
            "featureMaxSizeOption": "--FeatureExtraction.max_image_size",
            "patchMatchMaxSize": True,
            "version": version,
        }
    if version == "3.13.0":
        return {
            "featureMaxSizeOption": "--SiftExtraction.max_image_size",
            "patchMatchMaxSize": False,
            "version": version,
        }
    raise ValueError("unsupported comparison profile")


def _colmap_run(
    *,
    run_label: str,
    image: str,
    version: str,
    fixture: Path,
    root: Path,
) -> dict[str, object]:
    profile = _colmap_profile(version)
    run_root = root / run_label
    work = run_root / "work"
    output = run_root / "output"
    logs = run_root / "logs"
    for path in (run_root, work, output, logs):
        _prepare_directory(path, writable_by_container=path in {work, output})
    (work / "sparse").mkdir(mode=0o777)
    records: list[CommandRecord] = []
    prefix = f"c8v2-{run_label}"

    records.append(
        _run_container(
            prefix=prefix,
            command_name="sm120",
            image=image,
            input_root=fixture,
            work_root=work,
            output_root=output,
            logs_root=logs,
            entrypoint="/usr/local/bin/c8-sm120-probe",
        )
    )
    feature_command = (
        "feature_extractor",
        "--database_path",
        "/c8/work/database.db",
        "--image_path",
        "/c8/input/images",
        "--ImageReader.camera_model",
        "PINHOLE",
        "--FeatureExtraction.use_gpu",
        "1",
        "--FeatureExtraction.gpu_index",
        "0",
        cast("str", profile["featureMaxSizeOption"]),
        "3200",
        "--SiftExtraction.max_num_features",
        "16384",
    )
    commands: list[tuple[str, tuple[str, ...]]] = [
        ("features", feature_command),
        (
            "matching",
            (
                "exhaustive_matcher",
                "--database_path",
                "/c8/work/database.db",
                "--FeatureMatching.use_gpu",
                "1",
                "--FeatureMatching.gpu_index",
                "0",
                "--FeatureMatching.max_num_matches",
                "32768",
                "--FeatureMatching.guided_matching",
                "1",
            ),
        ),
        (
            "mapper",
            (
                "mapper",
                "--database_path",
                "/c8/work/database.db",
                "--image_path",
                "/c8/input/images",
                "--output_path",
                "/c8/work/sparse",
            ),
        ),
        (
            "analyzer",
            ("model_analyzer", "--path", "/c8/work/sparse/0"),
        ),
        (
            "undistort",
            (
                "image_undistorter",
                "--image_path",
                "/c8/input/images",
                "--input_path",
                "/c8/input/known-model",
                "--output_path",
                "/c8/work/dense",
                "--output_type",
                "COLMAP",
                "--max_image_size",
                "3200",
            ),
        ),
    ]
    patch_match = [
        "patch_match_stereo",
        "--workspace_path",
        "/c8/work/dense",
        "--workspace_format",
        "COLMAP",
        "--PatchMatchStereo.gpu_index",
        "0",
        "--PatchMatchStereo.geom_consistency",
        "true",
    ]
    if profile["patchMatchMaxSize"] is True:
        patch_match.extend(("--PatchMatchStereo.max_image_size", "3200"))
    commands.extend(
        [
            ("patchmatch", tuple(patch_match)),
            (
                "fusion",
                (
                    "stereo_fusion",
                    "--workspace_path",
                    "/c8/work/dense",
                    "--workspace_format",
                    "COLMAP",
                    "--input_type",
                    "geometric",
                    "--output_path",
                    "/c8/output/fused.ply",
                ),
            ),
        ]
    )
    for command_name, command in commands:
        records.append(
            _run_container(
                prefix=prefix,
                command_name=command_name,
                image=image,
                input_root=fixture,
                work_root=work,
                output_root=output,
                logs_root=logs,
                command=command,
            )
        )

    validation = json.loads(
        _run_checked(
            [
                sys.executable,
                str(VALIDATOR),
                "--dense-root",
                str(work / "dense"),
                "--ply",
                str(output / "fused.ply"),
            ]
        )
    )
    analyzer = (logs / f"{prefix}-analyzer.log").read_text(
        encoding="utf-8", errors="replace"
    )

    def metric(label: str, pattern: str) -> int | float:
        match = re.search(pattern, analyzer)
        if match is None:
            raise ValueError(f"model analyzer omitted {label}")
        return float(match.group(1)) if "." in match.group(1) else int(match.group(1))

    sparse = {
        "meanReprojectionErrorPixels": metric(
            "mean reprojection error",
            r"Mean reprojection error:\\s+([0-9.]+)px",
        ),
        "observations": metric("observations", r"Observations:\\s+([0-9]+)"),
        "registeredImages": metric(
            "registered images", r"Registered images:\\s+([0-9]+)"
        ),
        "sparsePoints": metric("points", r"Points:\\s+([0-9]+)"),
    }
    ply = cast("dict[str, object]", cast("dict[str, object]", validation)["ply"])
    if sparse["registeredImages"] < 2 or sparse["sparsePoints"] <= 0:
        raise RuntimeError("COLMAP_SPARSE_ALGORITHM_GATE_FAILED")
    if version == "4.1.1" and (
        ply.get("payloadValidated") is not True
        or not isinstance(ply.get("vertexCount"), int)
        or cast("int", ply["vertexCount"]) <= 0
    ):
        raise RuntimeError("COLMAP_DENSE_ALGORITHM_GATE_FAILED")
    output_paths = [
        output / "fused.ply",
        work / "database.db",
        work / "sparse/0/cameras.bin",
        work / "sparse/0/images.bin",
        work / "sparse/0/points3D.bin",
    ]
    return {
        "algorithms": {
            "dense": validation,
            "sparse": sparse,
        },
        "commands": [asdict(record) for record in records],
        "image": image,
        "outputs": [_hashed(path, run_root) for path in output_paths],
        "profile": profile,
        "resources": _aggregate_resources(records),
        "runtimeProbe": _last_json(logs / f"{prefix}-sm120.log"),
    }


def _inspect_ply(path: Path) -> dict[str, object]:
    spec = importlib.util.spec_from_file_location("c8_output_validator", VALIDATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError("validator import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    inspect = cast("Callable[[Path], dict[str, object]]", module.inspect_ply)
    return inspect(path)


def _simple_component_run(
    *,
    component: str,
    run_index: int,
    image: str,
    fixture: Path,
    root: Path,
) -> dict[str, object]:
    run_label = f"{component}-r{run_index}"
    run_root = root / run_label
    work = run_root / "work"
    output = run_root / "output"
    logs = run_root / "logs"
    for path in (run_root, work, output, logs):
        _prepare_directory(path, writable_by_container=path in {work, output})
    prefix = f"c8v2-{run_label}"
    records = [
        _run_container(
            prefix=prefix,
            command_name="sm120",
            image=image,
            input_root=fixture,
            work_root=work,
            output_root=output,
            logs_root=logs,
            entrypoint="/usr/local/bin/c8-sm120-probe",
        ),
        _run_container(
            prefix=prefix,
            command_name="workload",
            image=image,
            input_root=fixture,
            work_root=work,
            output_root=output,
            logs_root=logs,
        ),
    ]
    workload = _last_json(logs / f"{prefix}-workload.log")
    output_paths = sorted(path for path in output.rglob("*") if path.is_file())
    result: dict[str, object] = {
        "commands": [asdict(record) for record in records],
        "image": image,
        "outputs": [_hashed(path, run_root) for path in output_paths],
        "resources": _aggregate_resources(records),
        "runtimeProbe": _last_json(logs / f"{prefix}-sm120.log"),
        "workload": workload,
    }
    if component == "appearance":
        ply = _inspect_ply(output / "appearance.ply")
        result["plyValidation"] = ply
        if (
            workload.get("algorithmVerdict") != "passed"
            or not isinstance(ply.get("vertexCount"), int)
            or cast("int", ply["vertexCount"]) <= 0
        ):
            raise RuntimeError("DIRECT_GSPLAT_ALGORITHM_GATE_FAILED")
    elif component == "open3d":
        cuda_probe = cast("dict[str, object]", workload.get("cudaTensorProbe"))
        cpu_tsdf = cast("dict[str, object]", workload.get("cpuTsdf"))
        if (
            cuda_probe.get("backend") != "CUDA"
            or cpu_tsdf.get("backend") != "legacy-cpu"
            or not isinstance(cpu_tsdf.get("vertexCount"), int)
            or not isinstance(cpu_tsdf.get("triangleCount"), int)
            or cast("int", cpu_tsdf["vertexCount"]) <= 0
            or cast("int", cpu_tsdf["triangleCount"]) <= 0
        ):
            raise RuntimeError("OPEN3D_ALGORITHM_GATE_FAILED")
    return result


def _generate_appearance_fixture(image: str, root: Path) -> dict[str, object]:
    fixture = root / "appearance-fixture"
    dummy_input = root / "fixture-generator-input"
    work = root / "fixture-generator-work"
    logs = root / "fixture-generator-logs"
    for path in (fixture, dummy_input, work, logs):
        _prepare_directory(path, writable_by_container=path in {fixture, work})
    record = _run_container(
        prefix="c8v2-fixture",
        command_name="appearance",
        image=image,
        input_root=dummy_input,
        work_root=work,
        output_root=fixture,
        logs_root=logs,
        command=(GSPLAT_FIXTURE_GENERATOR, "/c8/output"),
        entrypoint="/opt/c8/venv/bin/python",
    )
    return {
        "command": asdict(record),
        "fixture": fixture,
        "generatorResult": _last_json(logs / "c8v2-fixture-appearance.log"),
    }


def _package_hashes() -> dict[str, object]:
    names = (
        "Dockerfile.appearance",
        "Dockerfile.colmap",
        "Dockerfile.open3d",
        "requirements-appearance.lock",
        "requirements-open3d.lock",
        "generate_colmap_fixture.py",
        "generate_gsplat_fixture.py",
        "run_acceptance.py",
        "validate_colmap_outputs.py",
    )
    return {
        name: {
            "byteSize": (PACKAGE_ROOT / name).stat().st_size,
            "sha256": _sha256(PACKAGE_ROOT / name),
        }
        for name in names
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--colmap-image", required=True)
    parser.add_argument("--open3d-image", required=True)
    parser.add_argument("--appearance-image", required=True)
    parser.add_argument("--comparison-colmap-image")
    arguments = parser.parse_args()

    _verify_source(arguments.source_commit)
    root = _exact_output_root(arguments.output_root)
    images = {
        "appearance": _verify_image(arguments.appearance_image),
        "colmap": _verify_image(arguments.colmap_image),
        "open3d": _verify_image(arguments.open3d_image),
    }
    if arguments.comparison_colmap_image is not None:
        images["colmap313Comparison"] = _verify_image(arguments.comparison_colmap_image)

    fixture = root / "colmap-fixture"
    _prepare_directory(fixture)
    fixture_result = json.loads(
        _run_checked([sys.executable, str(COLMAP_FIXTURE_GENERATOR), str(fixture)])
    )
    appearance_fixture_result = _generate_appearance_fixture(
        arguments.appearance_image, root
    )
    appearance_fixture = cast("Path", appearance_fixture_result.pop("fixture"))

    results: dict[str, object] = {}
    failures: list[dict[str, str]] = []

    def attempt(name: str, operation: Callable[[], object]) -> None:
        try:
            results[name] = operation()
        except Exception as error:
            failures.append(
                {
                    "component": name,
                    "errorType": type(error).__name__,
                    "message": str(error)[-4000:],
                }
            )

    for run_index in (1, 2):
        attempt(
            f"colmap411Run{run_index}",
            partial(
                _colmap_run,
                run_label=f"colmap411-r{run_index}",
                image=arguments.colmap_image,
                version="4.1.1",
                fixture=fixture,
                root=root,
            ),
        )
        attempt(
            f"open3dRun{run_index}",
            partial(
                _simple_component_run,
                component="open3d",
                run_index=run_index,
                image=arguments.open3d_image,
                fixture=fixture,
                root=root,
            ),
        )
        attempt(
            f"appearanceRun{run_index}",
            partial(
                _simple_component_run,
                component="appearance",
                run_index=run_index,
                image=arguments.appearance_image,
                fixture=appearance_fixture,
                root=root,
            ),
        )

    if arguments.comparison_colmap_image is not None:
        attempt(
            "colmap313Comparison",
            lambda: _colmap_run(
                run_label="colmap313-comparison",
                image=arguments.comparison_colmap_image,
                version="3.13.0",
                fixture=fixture,
                root=root,
            ),
        )

    document = {
        "authority": {
            "appearance": "non-dimensional-appearance",
            "canonicalMutationAllowed": False,
            "geometry": "proposal-only",
        },
        "failures": failures,
        "fixtures": {
            "appearance": appearance_fixture_result,
            "colmap": fixture_result,
        },
        "images": images,
        "packageInputs": _package_hashes(),
        "results": results,
        "rights": {
            "basis": "creator-owned-synthetic",
            "customerDataUsed": False,
            "providerDataUsed": False,
            "serviceProcessingAllowed": True,
            "trainingAllowed": False,
        },
        "runnerCompletedAtUnixMilliseconds": round(time.time() * 1000),
        "schemaVersion": SCHEMA_VERSION,
        "sourceCommit": arguments.source_commit,
    }
    result_path = root / "acceptance-result.json"
    result_path.write_bytes(_canonical_bytes(document))
    print(
        json.dumps(
            {
                "failureCount": len(failures),
                "resultPath": str(result_path),
                "resultSha256": _sha256(result_path),
                "schemaVersion": SCHEMA_VERSION,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
