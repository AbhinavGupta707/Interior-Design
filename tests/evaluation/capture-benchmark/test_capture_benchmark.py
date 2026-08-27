from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
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
    assert matrix[3] == pytest.approx(-0.25)
    assert matrix[7] == pytest.approx(0.5)
    assert matrix[11] == pytest.approx(-1.0)
    assert pose[:4] == [1.0, 0.0, 0.0, 0.0]


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


def test_common_record_enforces_frozen_two_run_repeatability(tmp_path: Path) -> None:
    authority = {
        "export.json": {
            "envelopeSha256": "a" * 64,
            "inputClass": "benchmark-fixture",
            "schemaVersion": "capture-benchmark-export-v1",
        },
        "host.json": {"schemaVersion": "c14-9-host-capabilities-v1"},
        "policy.json": {"schemaVersion": "capture-benchmark-routing-policy-v1"},
        "selection.json": {"schemaVersion": "capture-benchmark-selection-v1"},
    }
    for name, value in authority.items():
        (tmp_path / name).write_text(json.dumps(value), encoding="utf-8")
    selection_sha256 = hashlib.sha256((tmp_path / "selection.json").read_bytes()).hexdigest()
    run_paths: list[Path] = []
    for run_index, psnr in ((1, 13.0), (2, 13.02)):
        path = tmp_path / f"run-{run_index}.json"
        path.write_text(
            json.dumps(
                {
                    "candidateId": "gsplat-direct",
                    "cohort": "inclusive",
                    "commandConfigSha256": "b" * 64,
                    "containerImageSha256": "sha256:" + "c" * 64,
                    "metrics": {"heldoutPsnrDb": psnr},
                    "rawArtifacts": [{"byteSize": 1, "path": "appearance.ply", "sha256": "d" * 64}],
                    "resources": {
                        "peakHostMemoryBytes": 1,
                        "peakVramBytes": 1,
                        "wallTimeSeconds": 1,
                    },
                    "runIndex": run_index,
                    "segmentId": "segment-1",
                    "selectionSha256": selection_sha256,
                    "status": "pass",
                }
            ),
            encoding="utf-8",
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
    repeatability = json.loads(output.read_bytes())["repeatability"][0]
    assert repeatability["status"] == "fail"
    assert repeatability["reasons"] == ["METRIC_DELTA_EXCEEDED:heldoutPsnrDb"]
