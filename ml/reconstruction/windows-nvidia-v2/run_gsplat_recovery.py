#!/usr/bin/env python3
"""Run the paired C14.10 gsplat manifest-compatibility recovery lane."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any, cast

from run_physical_capture_matrix import (
    aggregate_resources,
    docker_command,
    execution_boundary,
    existing_artifacts,
    gsplat_prepare_command,
    inspect_image,
    load_object,
    make_directory,
    metrics,
    private_existing,
    resolve_segment_id,
    restrict_tree,
    run_host,
    run_sampled,
    safe_root,
    sha256_file,
    validate_repository,
    write_new,
)

SOURCE_PLAN_SCHEMA = "c14-10-physical-matrix-v3"
RECOVERY_PLAN_SCHEMA = "c14-10-physical-evaluation-plan-v3"
RECOVERY_RECORD_SCHEMA = "c14-10-gsplat-manifest-recovery-v1"
RECOVERY_PROFILE = "qualityFull"
RECOVERY_LANE = "gsplatManifestRecovery"


def regular_model_files(root: Path) -> dict[str, Path]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("source prior model must be a real directory")
    files = {name: root / name for name in ("cameras.txt", "images.txt", "points3D.txt")}
    if any(path.is_symlink() or not path.is_file() for path in files.values()):
        raise ValueError("source prior model is incomplete")
    if any(path.resolve().parent != root.resolve() for path in files.values()):
        raise ValueError("source prior model escapes its root")
    return files


def validate_recovery_plan(
    path: Path,
    *,
    repository: Path,
    product_source_commit: str,
    expected_frame_count: int,
    source_record_sha256: str,
    gsplat_image: str,
) -> tuple[str, dict[str, Any], dict[str, Any], dict[str, Any]]:
    if (
        not path.is_absolute()
        or path.is_symlink()
        or not path.is_file()
        or not path.resolve().is_relative_to(repository.resolve())
    ):
        raise ValueError("evaluation plan must be a regular repository file")
    plan = load_object(path)
    if (
        plan.get("schemaVersion") != RECOVERY_PLAN_SCHEMA
        or plan.get("productSourceCommit") != product_source_commit
        or cast("dict[str, object]", plan.get("images")).get("gsplat") != gsplat_image
    ):
        raise ValueError("recovery evaluation plan source contract is invalid")
    recovery = cast("dict[str, Any]", plan.get("gsplatManifestRecovery"))
    source = cast(
        "dict[str, Any]",
        cast("dict[str, object]", recovery.get("sourceRecords")).get(str(expected_frame_count)),
    )
    expected_source = {
        132: (51_811, 8_397_973),
        165: (90_679, 14_578_210),
    }[expected_frame_count]
    if (
        recovery.get("countedAs") != "paired-adapter-compatibility-ablation"
        or recovery.get("pairedRule")
        != "execute once for both datasets before any repeat-2 decision"
        or recovery.get("maximumInitialGaussians") != 20_000
        or recovery.get("manifestByteLimit") != 4 * 1024 * 1024
        or recovery.get("sampling") != "sha256-ranked-colmap-record-v1"
        or source.get("recordSha256") != source_record_sha256
        or (
            source.get("fullInitialGaussianCount"),
            source.get("manifestBytes"),
        )
        != expected_source
    ):
        raise ValueError("recovery evidence contract is invalid")
    lane = cast("dict[str, Any]", cast("dict[str, object]", plan.get("lanes")).get(RECOVERY_LANE))
    if lane != {
        "candidateId": "gsplat-direct",
        "countedAs": "paired-adapter-compatibility-ablation",
        "frameScope": "full",
        "initialGaussianLimit": 20_000,
        "repeats": 1,
        "resourceProfile": RECOVERY_PROFILE,
        "sourceLane": "qualityFullSequentialMobile",
        "sourceRunIndex": 1,
    }:
        raise ValueError("recovery lane differs from the frozen plan")
    profile = dict(
        cast(
            "dict[str, Any]",
            cast("dict[str, object]", plan.get("resourceProfiles")).get(RECOVERY_PROFILE),
        )
    )
    required_limits = (
        "cpuLimit",
        "memoryLimitBytes",
        "pidLimit",
        "scratchLimitBytes",
        "taskVramLimitBytes",
    )
    timeouts = cast("dict[str, object]", profile.get("stageTimeoutSeconds"))
    if (
        any(not isinstance(profile.get(key), int) for key in required_limits)
        or not isinstance(timeouts.get("gsplat.prepare"), int)
        or not isinstance(timeouts.get("gsplat.fit"), int)
    ):
        raise ValueError("recovery resource profile is invalid")
    profile["name"] = RECOVERY_PROFILE
    profile["maximumInitialGaussians"] = recovery["maximumInitialGaussians"]
    return sha256_file(path), recovery, source, profile


def validate_source_record(
    record: dict[str, Any],
    *,
    record_sha256: str,
    recovery: dict[str, Any],
    source: dict[str, Any],
    expected_frame_count: int,
    product_source_commit: str,
    selection_sha256: str,
    policy_sha256: str,
) -> None:
    candidates = {
        cast("str", candidate.get("candidateId")): cast("dict[str, Any]", candidate)
        for candidate in cast("list[dict[str, object]]", record.get("runs"))
    }
    prior = candidates.get("colmap-arkit-prior", {})
    failed_gsplat = candidates.get("gsplat-direct", {})
    prior_metrics = cast("dict[str, object]", prior.get("metrics"))
    gsplat_metrics = cast("dict[str, object]", failed_gsplat.get("metrics"))
    if (
        record_sha256 != source.get("recordSha256")
        or record.get("schemaVersion") != SOURCE_PLAN_SCHEMA
        or record.get("counted") is not True
        or record.get("executionProfile") != "quality-full"
        or record.get("runIndex") != 1
        or record.get("productSourceCommit") != product_source_commit
        or record.get("evaluationHarnessCommit") != recovery.get("sourceEvaluationHarnessCommit")
        or record.get("evaluationPlanSha256") != recovery.get("sourceEvaluationPlanSha256")
        or record.get("selectionSha256") != selection_sha256
        or prior.get("status") != "pass"
        or prior_metrics.get("eligibleFrameCount") != expected_frame_count
        or prior_metrics.get("registeredFrameCount") != expected_frame_count
        or prior_metrics.get("finitePointCount") != source.get("fullInitialGaussianCount")
        or failed_gsplat.get("status") != "fail"
        or failed_gsplat.get("failureCode") != "GSPLAT_DIRECT_FAILED"
        or gsplat_metrics.get("eligibleFrameCount") != expected_frame_count
        or gsplat_metrics.get("finitePointCount") != source.get("fullInitialGaussianCount")
        or failed_gsplat.get("policySha256") != policy_sha256
    ):
        raise ValueError("sealed source record is not eligible for recovery")


def validate_source_geometry(
    source_run_root: Path,
    *,
    source: dict[str, Any],
    selection_sha256: str,
) -> tuple[Path, dict[str, str]]:
    original_input = source_run_root / "gsplat-input/appearance-input.json"
    original_preparation_path = source_run_root / "gsplat-input/capture-preparation.json"
    if (
        original_input.is_symlink()
        or not original_input.is_file()
        or original_input.stat().st_size != source.get("manifestBytes")
        or original_preparation_path.is_symlink()
        or not original_preparation_path.is_file()
    ):
        raise ValueError("failed source manifest evidence differs from the frozen plan")
    original_input_record = load_object(original_input)
    if len(cast("list[object]", original_input_record.get("initialGaussians"))) != source.get(
        "fullInitialGaussianCount"
    ):
        raise ValueError("failed source manifest point count differs from the frozen plan")
    original_preparation = load_object(original_preparation_path)
    if (
        original_preparation.get("schemaVersion") != "c14-10-gsplat-preparation-v3"
        or original_preparation.get("selectionSha256") != selection_sha256
    ):
        raise ValueError("failed source preparation evidence is invalid")
    model_root = source_run_root / "prior-output/model-text"
    model_files = regular_model_files(model_root)
    model_hashes = {name: sha256_file(path) for name, path in model_files.items()}
    if model_hashes != original_preparation.get("modelFileSha256"):
        raise ValueError("sealed prior model differs from the failed source preparation")
    return model_root, model_hashes


def execute(args: argparse.Namespace) -> None:
    repository = Path(__file__).resolve().parents[3]
    package = Path(__file__).resolve().parent
    validate_repository(repository, args.product_source_commit, args.evaluation_harness_commit)
    source_record_path = private_existing(Path(args.source_record), "source record")
    source_record_sha256 = sha256_file(source_record_path)
    plan_sha256, recovery, source, profile = validate_recovery_plan(
        Path(args.evaluation_plan),
        repository=repository,
        product_source_commit=args.product_source_commit,
        expected_frame_count=args.expected_frame_count,
        source_record_sha256=source_record_sha256,
        gsplat_image=args.gsplat_image,
    )
    inspect_image(args.gsplat_image)

    export_root = private_existing(Path(args.export_root), "export root", directory=True)
    selection_path = private_existing(Path(args.selection), "selection")
    policy_path = private_existing(Path(args.policy), "policy")
    host_path = private_existing(Path(args.host_capabilities), "host capabilities")
    authority_root = private_existing(Path(args.authority_root), "authority root", directory=True)
    source_run_root = private_existing(
        Path(args.source_run_root), "source run root", directory=True
    )
    output_root = safe_root(Path(args.output_root), create=False)
    if (
        not str(output_root).startswith("/home/")
        or output_root.is_symlink()
        or not source_run_root.resolve().is_relative_to(
            Path("/home/abhinav/private/home-design-c14-10").resolve()
        )
        or source_record_path.resolve().parent != authority_root.resolve()
    ):
        raise ValueError("recovery paths must remain within private WSL ext4 authority roots")

    selection = load_object(selection_path)
    policy = load_object(policy_path)
    host = load_object(host_path)
    selection_sha256 = sha256_file(selection_path)
    policy_sha256 = sha256_file(policy_path)
    if (
        policy.get("selectionSha256") != selection_sha256
        or cast("dict[str, dict[str, object]]", host.get("images")).get("gsplat", {}).get("id")
        != args.gsplat_image
    ):
        raise ValueError("selection, policy, or host image binding is invalid")
    cohorts = cast("dict[str, dict[str, object]]", selection.get("cohorts"))
    normal = cast("dict[str, object]", cohorts.get("normal"))
    inclusive = cast("dict[str, object]", cohorts.get("inclusive"))
    if normal != inclusive:
        raise ValueError("normal/inclusive deduplication is invalid")
    segments = cast("list[dict[str, object]]", normal.get("segments"))
    segment_id = resolve_segment_id(segments, None)
    segment = next(item for item in segments if item.get("segmentId") == segment_id)
    if len(cast("list[object]", segment.get("frames"))) != args.expected_frame_count:
        raise ValueError("recovery frame count differs from the frozen plan")

    source_record = load_object(source_record_path)
    validate_source_record(
        source_record,
        record_sha256=source_record_sha256,
        recovery=recovery,
        source=source,
        expected_frame_count=args.expected_frame_count,
        product_source_commit=args.product_source_commit,
        selection_sha256=selection_sha256,
        policy_sha256=policy_sha256,
    )
    model_root, model_hashes = validate_source_geometry(
        source_run_root,
        source=source,
        selection_sha256=selection_sha256,
    )

    run_root = output_root / "gsplat-recovery-r1"
    make_directory(run_root)
    logs = run_root / "logs"
    gsplat_input = run_root / "gsplat-input"
    gsplat_output = run_root / "gsplat-output"
    make_directory(logs)
    make_directory(gsplat_input)
    make_directory(gsplat_output)
    timeouts = cast("dict[str, int]", profile["stageTimeoutSeconds"])
    maximum_initial_gaussians = cast("int", profile["maximumInitialGaussians"])
    records: list[dict[str, Any]] = []
    failure: str | None = None

    prepare_record = run_host(
        gsplat_prepare_command(
            package=package,
            export_root=export_root,
            selection=selection_path,
            cohort="normal",
            segment_id=segment_id,
            model=model_root,
            output=gsplat_input,
            sample_count=None,
            maximum_initial_gaussians=maximum_initial_gaussians,
        ),
        logs / "gsplat-prepare.log",
        repository,
        timeouts["gsplat.prepare"],
    )
    records.append(prepare_record)
    if prepare_record["timedOut"]:
        failure = "COMMAND_TIMEOUT"
    elif prepare_record["exitCode"] != 0:
        failure = "GSPLAT_RECOVERY_PREPARATION_FAILED"

    preparation: dict[str, Any] = {}
    appearance_input: dict[str, Any] = {}
    if failure is None:
        preparation = load_object(gsplat_input / "capture-preparation.json")
        appearance_input = load_object(gsplat_input / "appearance-input.json")
        sampling = cast("dict[str, object]", preparation.get("initialGaussianSampling"))
        if (
            preparation.get("schemaVersion") != "c14-10-gsplat-preparation-v4"
            or preparation.get("modelFileSha256") != model_hashes
            or preparation.get("selectionSha256") != selection_sha256
            or sampling.get("rule") != recovery.get("sampling")
            or sampling.get("sourceCount") != source.get("fullInitialGaussianCount")
            or sampling.get("retainedCount") != maximum_initial_gaussians
            or sampling.get("maximumCount") != maximum_initial_gaussians
            or sampling.get("manifestByteLimit") != recovery.get("manifestByteLimit")
            or sampling.get("manifestBytes")
            != (gsplat_input / "appearance-input.json").stat().st_size
            or cast("int", sampling["manifestBytes"]) > cast("int", recovery["manifestByteLimit"])
            or len(cast("list[object]", appearance_input.get("frames")))
            != args.expected_frame_count
            or len(cast("list[object]", appearance_input.get("initialGaussians")))
            != maximum_initial_gaussians
        ):
            failure = "GSPLAT_RECOVERY_COMPATIBILITY_GATE_FAILED"

    result: dict[str, Any] = {}
    if failure is None:
        name = f"c1410-recovery-{args.expected_frame_count}-{source_record_sha256[:12]}"
        fit_record = run_sampled(
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
                resource_profile=profile,
            ),
            log_path=logs / "gsplat-direct.log",
            scratch_roots=[gsplat_input, gsplat_output],
            repository=repository,
            timeout_seconds=timeouts["gsplat.fit"],
            vram_limit_bytes=cast("int", profile["taskVramLimitBytes"]),
        )
        records.append(fit_record)
        if fit_record["timedOut"]:
            failure = "COMMAND_TIMEOUT"
        elif fit_record["exitCode"] != 0:
            failure = "GSPLAT_DIRECT_FAILED"
        elif fit_record["resources"]["peakVramBytesAboveBaseline"] > profile["taskVramLimitBytes"]:
            failure = "RESOURCE_CEILING_EXCEEDED_VRAM"
        elif fit_record["resources"]["scratchBytes"] > profile["scratchLimitBytes"]:
            failure = "RESOURCE_CEILING_EXCEEDED_SCRATCH"

    if failure is None:
        try:
            result = load_object(gsplat_output / "appearance-result.json")
            if result.get("algorithmVerdict") != "passed":
                failure = "GSPLAT_ALGORITHM_GATE_FAILED"
        except (OSError, ValueError, json.JSONDecodeError):
            failure = "GSPLAT_RESULT_INVALID"

    resources = aggregate_resources(records, [gsplat_input, gsplat_output])
    if isinstance(result.get("peakGpuMemoryBytes"), int):
        resources["peakVramBytes"] = max(
            cast("int", resources["peakVramBytes"]), cast("int", result["peakGpuMemoryBytes"])
        )
    if isinstance(result.get("peakHostMemoryBytes"), int):
        resources["peakHostMemoryBytes"] = max(
            cast("int", resources["peakHostMemoryBytes"]),
            cast("int", result["peakHostMemoryBytes"]),
        )
    retained_count = len(cast("list[object]", appearance_input.get("initialGaussians", [])))
    frame_count = len(cast("list[object]", appearance_input.get("frames", [])))
    artifacts = existing_artifacts(
        [
            (gsplat_input / "capture-preparation.json", "capture-preparation.json"),
            (gsplat_output / "appearance.ply", "appearance.ply"),
            (gsplat_output / "appearance-checkpoint.json", "appearance-checkpoint.json"),
            (gsplat_output / "appearance-result.json", "appearance-result.json"),
        ],
        [logs / "gsplat-prepare.log", logs / "gsplat-direct.log"],
    )
    candidate = {
        "candidateId": "gsplat-direct",
        "containerImageSha256": args.gsplat_image,
        "execution": execution_boundary(profile),
        "failureCode": failure,
        "metrics": metrics(
            eligibleFrameCount=frame_count,
            finitePointCount=retained_count,
            heldoutPsnrDb=result.get("heldOutPsnrDb", "not-applicable"),
            heldoutSsim=result.get("heldOutSsim", "not-applicable"),
            heldoutLpips=result.get("heldOutLpips", "not-applicable"),
            outputBytes=sum(
                path.stat().st_size for path in gsplat_output.rglob("*") if path.is_file()
            ),
            wallTimeSeconds=resources["wallTimeSeconds"],
        ),
        "rawArtifacts": artifacts,
        "resources": resources,
        "status": "pass" if failure is None else "fail",
    }
    record = {
        "authority": "private-proposal-evaluation-only",
        "candidate": candidate,
        "cohort": "normal",
        "counted": True,
        "evaluationHarnessCommit": args.evaluation_harness_commit,
        "evaluationPlanSha256": plan_sha256,
        "executionProfile": "gsplat-manifest-recovery",
        "hostCapabilitiesSha256": sha256_file(host_path),
        "inputEnvelopeSha256": selection.get("envelopeSha256"),
        "policySha256": policy_sha256,
        "productSourceCommit": args.product_source_commit,
        "recovery": {
            "failureRetention": recovery["failureRetention"],
            "manifestByteLimit": recovery["manifestByteLimit"],
            "maximumInitialGaussians": maximum_initial_gaussians,
            "sampling": recovery["sampling"],
            "sourceEvaluationHarnessCommit": recovery["sourceEvaluationHarnessCommit"],
            "sourceEvaluationPlanSha256": recovery["sourceEvaluationPlanSha256"],
            "sourceFullInitialGaussianCount": source["fullInitialGaussianCount"],
            "sourceManifestBytes": source["manifestBytes"],
            "sourceModelFileSha256": model_hashes,
            "sourceRecordSha256": source_record_sha256,
        },
        "runIndex": 1,
        "schemaVersion": RECOVERY_RECORD_SCHEMA,
        "selectionSha256": selection_sha256,
    }
    record_path = authority_root / "gsplat-recovery-r1.json"
    write_new(record_path, record)
    restrict_tree(run_root)
    record_path.chmod(0o600)
    print(
        json.dumps(
            {
                "counted": True,
                "expectedFrameCount": args.expected_frame_count,
                "recordSha256": sha256_file(record_path),
                "status": candidate["status"],
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
    parser.add_argument("--source-record", required=True)
    parser.add_argument("--source-run-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--expected-frame-count", choices=(132, 165), type=int, required=True)
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
    ) as error:
        print(f"gsplat recovery failed: {error}")
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
