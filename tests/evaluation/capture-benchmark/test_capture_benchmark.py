from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import uuid
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "ml/reconstruction/windows-nvidia-v2"


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "capture_benchmark", PACKAGE / "capture_benchmark.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_fixture(tmp_path: Path) -> Path:
    root = tmp_path / "fixture"
    subprocess.run(
        [
            sys.executable,
            str(PACKAGE / "generate_capture_benchmark_fixture.py"),
            "--output",
            str(root),
        ],
        check=True,
    )
    return root


def write_canonical(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(
            value, allow_nan=False, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        + "\n",
        encoding="utf-8",
    )
    path.chmod(0o600)


def test_fixture_verifies_and_tampering_fails(tmp_path: Path) -> None:
    module = load_module()
    root = make_fixture(tmp_path)
    manifest, envelope = module.verify_export(root)
    assert manifest["inputClass"] == "benchmark-fixture"
    assert envelope["rights"]["trainingUseConsent"] == "denied"
    image = next((root / "rgb").iterdir())
    image.write_bytes(image.read_bytes() + b"tamper")
    with pytest.raises(ValueError, match="manifest"):
        module.verify_export(root)


def test_room_story_remains_optional_in_frozen_envelope_schema(tmp_path: Path) -> None:
    module = load_module()
    root = make_fixture(tmp_path)
    envelope = json.loads((root / "envelope.json").read_bytes())
    envelope["rooms"][0].pop("story")
    module.validate_envelope_shape(envelope)

    envelope["rooms"][0]["unexpected"] = True
    with pytest.raises(ValueError, match="room fields"):
        module.validate_envelope_shape(envelope)


def test_export_access_idempotency_is_scoped_to_one_attempt() -> None:
    module = load_module()
    first_attempt = uuid.UUID("10000000-0000-4000-8000-000000000001")
    second_attempt = uuid.UUID("10000000-0000-4000-8000-000000000002")
    envelope_sha = "a" * 64
    source_id = "20000000-0000-4000-8000-000000000001"

    first = module.export_access_idempotency_key(first_attempt, envelope_sha, source_id)
    assert first == module.export_access_idempotency_key(first_attempt, envelope_sha, source_id)
    assert first != module.export_access_idempotency_key(second_attempt, envelope_sha, source_id)


def test_selection_policy_and_segment_safe_prior(tmp_path: Path) -> None:
    module = load_module()
    root = make_fixture(tmp_path)
    selection = tmp_path / "selection.json"
    module.write_selection(type("Args", (), {"export_root": str(root), "output": str(selection)})())
    value = json.loads(selection.read_bytes())
    normal = value["cohorts"]["normal"]["segments"][0]
    inclusive = value["cohorts"]["inclusive"]["segments"][0]
    assert len(normal["frames"]) == 9
    assert len(inclusive["frames"]) == 10
    assert normal["segmentId"] == inclusive["segmentId"]
    policy = tmp_path / "policy.json"
    module.write_policy(
        type(
            "Args",
            (),
            {
                "candidate_root": None,
                "export_root": str(root),
                "output": str(policy),
                "selection": str(selection),
            },
        )()
    )
    plans = json.loads(policy.read_bytes())["plans"]
    inclusive_plan = next(plan for plan in plans if plan["cohort"] == "inclusive")
    status = {item["candidateId"]: item["status"] for item in inclusive_plan["candidates"]}
    assert status["colmap-unconstrained"] == "selected"
    assert status["open3d-known-pose-tsdf"] == "selected"
    assert status["vggt-1b-commercial"] == "abstained"
    prior = tmp_path / "prior"
    module.write_colmap_prior(
        type(
            "Args",
            (),
            {
                "cohort": "inclusive",
                "database": None,
                "export_root": str(root),
                "output": str(prior),
                "segment_id": inclusive["segmentId"],
                "selection": str(selection),
            },
        )()
    )
    images = (prior / "images.txt").read_text()
    assert images.count(".png") == 10
    assert "1.2" in images


def test_world_to_camera_inverts_camera_translation() -> None:
    module = load_module()
    frame = {
        "quaternionNanounits": [0, 0, 0, 1_000_000_000],
        "translationMicrometres": {"x": 250_000, "y": -500_000, "z": 1_000_000},
    }
    matrix, pose = module.world_to_camera(frame)
    assert matrix[:3] == pytest.approx([1.0, 0.0, 0.0])
    assert matrix[4:7] == pytest.approx([0.0, -1.0, 0.0])
    assert matrix[8:11] == pytest.approx([0.0, 0.0, -1.0])
    assert matrix[3] == pytest.approx(-0.25)
    assert matrix[7] == pytest.approx(-0.5)
    assert matrix[11] == pytest.approx(1.0)
    assert pose[:4] == [0.0, 1.0, 0.0, 0.0]


def test_selection_is_recomputed_before_downstream_use(tmp_path: Path) -> None:
    module = load_module()
    root = make_fixture(tmp_path)
    selection = tmp_path / "selection.json"
    module.write_selection(type("Args", (), {"export_root": str(root), "output": str(selection)})())
    tampered = json.loads(selection.read_bytes())
    frames = tampered["cohorts"]["inclusive"]["segments"][0]["frames"]
    frames.reverse()
    write_canonical(selection, tampered)
    with pytest.raises(ValueError, match="deterministic selection"):
        module.load_selection(root, selection)


def test_fixture_arkit_camera_converts_to_identity_opencv_view() -> None:
    module = load_module()
    frame = {
        "quaternionNanounits": [1_000_000_000, 0, 0, 0],
        "translationMicrometres": {"x": 250_000, "y": -500_000, "z": 1_000_000},
    }
    matrix, pose = module.world_to_camera(frame)
    assert matrix[:3] == pytest.approx([1.0, 0.0, 0.0])
    assert matrix[4:7] == pytest.approx([0.0, 1.0, 0.0])
    assert matrix[8:11] == pytest.approx([0.0, 0.0, 1.0])
    assert matrix[3] == pytest.approx(-0.25)
    assert matrix[7] == pytest.approx(0.5)
    assert matrix[11] == pytest.approx(-1.0)
    assert pose[:4] == pytest.approx([1.0, 0.0, 0.0, 0.0])


def test_experimental_candidate_requires_dependency_lock_and_image(tmp_path: Path) -> None:
    module = load_module()
    candidate_root = tmp_path / "candidates"
    candidate_root.mkdir()
    for candidate_id in ("mast3r-vitlarge-512", "metric-video-depth-anything-small"):
        (candidate_root / candidate_id).mkdir()
    verified, failures = module.verified_experimental_candidates(candidate_root)
    assert verified == set()
    assert failures["mast3r-vitlarge-512"] == "DEPENDENCY_LOCK_AND_IMAGE_REQUIRED"
    assert failures["metric-video-depth-anything-small"] == "DEPENDENCY_LOCK_AND_IMAGE_REQUIRED"


def test_common_record_enforces_matrix_isolation_resources_and_repeatability(
    tmp_path: Path,
) -> None:
    export = {
        "envelopeSha256": "a" * 64,
        "inputClass": "benchmark-fixture",
        "schemaVersion": "capture-benchmark-export-v1",
    }
    write_canonical(tmp_path / "export.json", export)
    selection = {
        "envelopeSha256": "a" * 64,
        "exportManifestSha256": hashlib.sha256((tmp_path / "export.json").read_bytes()).hexdigest(),
        "productionAuthority": "none-proposal-only",
        "schemaVersion": "capture-benchmark-selection-v1",
    }
    write_canonical(tmp_path / "selection.json", selection)
    selection_sha256 = hashlib.sha256((tmp_path / "selection.json").read_bytes()).hexdigest()
    profiles = {
        "baseline": {
            "cpus": 12,
            "memoryGiB": 24,
            "pids": 512,
            "scratchGiB": 12,
            "timeoutMinutes": 30,
            "vramGiB": 14,
        },
        "experimental": {
            "cpus": 12,
            "memoryGiB": 32,
            "pids": 512,
            "scratchGiB": 16,
            "timeoutMinutes": 45,
            "vramGiB": 15,
        },
    }
    policy = {
        "inputEnvelopeSha256": "a" * 64,
        "plans": [
            {
                "candidates": [
                    {
                        "candidateId": "gsplat-direct",
                        "reasons": [],
                        "role": "appearance-only",
                        "status": "selected",
                    }
                ],
                "cohort": "inclusive",
                "segmentId": "segment-1",
            }
        ],
        "productionAuthority": "none-evaluation-only",
        "resourceProfiles": profiles,
        "schemaVersion": "capture-benchmark-routing-policy-v1",
        "selectionSha256": selection_sha256,
    }
    write_canonical(tmp_path / "policy.json", policy)
    policy_sha256 = hashlib.sha256((tmp_path / "policy.json").read_bytes()).hexdigest()
    image_digest = "sha256:" + "c" * 64
    write_canonical(
        tmp_path / "host.json",
        {
            "images": {"gsplat": {"id": image_digest}},
            "schemaVersion": "c14-9-host-capabilities-v1",
        },
    )
    spec = importlib.util.spec_from_file_location(
        "capture_metrics_test", PACKAGE / "capture_metrics.py"
    )
    assert spec is not None and spec.loader is not None
    metrics_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(metrics_module)
    run_paths: list[Path] = []
    for run_index, psnr in ((1, 13.0), (2, 13.02)):
        metrics: dict[str, object] = {
            name: "not-applicable" for name in metrics_module.REPORTED_METRICS
        }
        metrics["heldoutPsnrDb"] = psnr
        metrics["eligibleFrameCount"] = 10
        metrics["wallTimeSeconds"] = 1
        execution = {
            "capDropAll": True,
            "cpus": 12,
            "gpuDevice": "0",
            "network": "none" if run_index == 1 else "bridge",
            "noNewPrivileges": True,
            "pidsLimit": 512,
            "readOnlyRoot": True,
            "tmpfs": "/tmp:rw,noexec,nosuid,nodev,size=2g",
            "user": "1000:1000",
        }
        path = tmp_path / f"run-{run_index}.json"
        write_canonical(
            path,
            {
                "candidateId": "gsplat-direct",
                "cohort": "inclusive",
                "commandConfigSha256": "b" * 64,
                "containerImageSha256": image_digest,
                "derivedInputSha256": "e" * 64,
                "deterministicControlsSha256": "f" * 64,
                "execution": execution,
                "failureCode": None,
                "metrics": metrics,
                "policySha256": policy_sha256,
                "rawArtifacts": [{"byteSize": 1, "path": "appearance.ply", "sha256": "d" * 64}],
                "resources": {
                    "peakHostMemoryBytes": 1,
                    "peakVramBytes": 15 * 1024**3,
                    "scratchBytes": 1,
                    "wallTimeSeconds": 1,
                },
                "runIndex": run_index,
                "seed": 0,
                "segmentId": "segment-1",
                "selectionSha256": selection_sha256,
                "status": "pass",
            },
        )
        run_paths.append(path)
    output = tmp_path / "record.json"
    command = [
        sys.executable,
        str(PACKAGE / "capture_metrics.py"),
        "--export-manifest",
        str(tmp_path / "export.json"),
        "--selection",
        str(tmp_path / "selection.json"),
        "--policy",
        str(tmp_path / "policy.json"),
        "--host-capabilities",
        str(tmp_path / "host.json"),
        "--output",
        str(output),
    ]
    for path in run_paths:
        command.extend(("--run", str(path)))
    subprocess.run(command, check=True)
    record = json.loads(output.read_bytes())
    repeatability = record["repeatability"][0]
    assert repeatability["status"] == "fail"
    assert repeatability["reasons"] == [
        "CONTAINER_ISOLATION_MISMATCH",
        "METRIC_DELTA_EXCEEDED:heldoutPsnrDb",
        "RESOURCE_CEILING_EXCEEDED:peakVramBytes",
    ]
    assert record["denominators"]["expectedRunCount"] == 2
    assert record["verdicts"]["runtimeExecutable"] == "fail"
