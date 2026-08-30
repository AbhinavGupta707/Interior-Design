from __future__ import annotations

import importlib.util
import inspect
import json
from pathlib import Path
from types import ModuleType

import numpy as np  # type: ignore[import-not-found]
import pytest

ROOT = Path(__file__).parents[3]
PACKAGE = ROOT / "ml" / "reconstruction" / "windows-nvidia-v2"


def load_adapter() -> ModuleType:
    spec = importlib.util.spec_from_file_location("vggt_nc_capture", PACKAGE / "vggt_nc_capture.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_runner(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.syspath_prepend(str(PACKAGE))
    spec = importlib.util.spec_from_file_location(
        "run_vggt_nc_research", PACKAGE / "run_vggt_nc_research.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_registry_freezes_only_two_noncommercial_executables() -> None:
    value = json.loads((PACKAGE / "c14-10-vggt-nc-research-candidates.json").read_bytes())
    executable = {
        item["candidateId"]
        for item in value["candidates"]
        if item["executionState"] == "viable-non-commercial-research-only"
    }
    assert executable == {"vggt-1b-nc-direct", "vggt-slam-2-nc-no-loop"}
    assert value["quarantine"] == {
        "canonicalGeometry": "prohibited",
        "commercialUse": "prohibited",
        "futureCommercialEvaluation": (
            "must-repeat-with-appropriately-licensed-weights-or-another-"
            "commercially-permissible-model"
        ),
        "productionRouting": "prohibited",
        "storage": "private-wsl-ext4-only",
    }
    slam3r = next(item for item in value["candidates"] if item["candidateId"] == "slam3r")
    assert slam3r["executionState"] == "outside-bounded-scope"
    assert "NON_COMMERCIAL_RESTRICTION_REMAINS_APPLICABLE" not in json.dumps(slam3r)
    cut3r = next(item for item in value["candidates"] if item["candidateId"] == "cut3r")
    assert cut3r["executionState"] == "outside-bounded-scope"
    for candidate_id in ("mast3r-vitlarge-512", "dust3r-vitlarge-512"):
        candidate = next(
            item for item in value["candidates"] if item["candidateId"] == candidate_id
        )
        assert candidate["executionState"] == "outside-bounded-scope"
        assert candidate["unresolvedConditions"]
    da3_large = next(
        item for item in value["candidates"] if item["candidateId"] == "da3-large-1.1"
    )
    assert da3_large["executionState"].startswith("outside-bounded-scope")
    omega = next(
        item for item in value["candidates"] if item["candidateId"] == "vggt-omega-1.4b"
    )
    assert omega["executionState"] == "abstained"
    assert "LICENCE_USE_IMPLIES_UNAUTHORISED_TERMS_ACCEPTANCE" in omega["blockedReasons"]
    hybrid = next(
        item for item in value["candidates"] if item["candidateId"] == "vggt-slam-2-nc-no-loop"
    )
    assert hybrid["loopClosureEvaluation"].startswith("NOT RUN")
    assert hybrid["upstreamPerformanceClaim"].startswith("none:")
    direct = next(
        item for item in value["candidates"] if item["candidateId"] == "vggt-1b-nc-direct"
    )
    assert direct["code"]["tree"] == "09959d2ea242d7a52ab37e1d1ad79dce9b7248a6"
    assert direct["weight"]["licenceId"] == "CC-BY-NC-4.0"
    assert value["dependencyChain"]["auditResult"].startswith("PASS_OFFLINE_IMAGE")
    assert value["executionFreeze"]["imageId"] == (
        "sha256:3f8eeb4923eeb559dcaef4074125403411aabaac5f83f4f1ac6f6888966a6d8e"
    )
    assert value["executionFreeze"]["environmentAuditSha256"] == (
        "3b3506010c2f0774efe48d3085bd991291b7c5867faf7afd68e4fcbbf11184c0"
    )
    assert value["executionFreeze"]["inputManifestSha256"] == (
        "04e6b1b0802508e5019c5b500d0d2f49fa331a6c6804ee686e1ecbee929ca46e"
    )


def test_runtime_chain_excludes_unjustified_optional_models() -> None:
    requirements = (PACKAGE / "requirements-vggt-nc.in").read_text()
    dockerfile = (PACKAGE / "Dockerfile.vggt-nc").read_text()
    for forbidden in ("salad", "sam3", "perception", "gradio", "viser", "open3d"):
        assert forbidden not in requirements.lower()
        assert forbidden not in dockerfile.lower()
    assert "safetensors" in requirements
    assert "model.pt" not in (PACKAGE / "vggt_nc_capture.py").read_text()
    assert "model.load_state_dict" in (PACKAGE / "vggt_nc_capture.py").read_text()
    assert "model.track_head = None" in (PACKAGE / "vggt_nc_capture.py").read_text()
    assert (
        "torch.use_deterministic_algorithms(True)" in (PACKAGE / "vggt_nc_capture.py").read_text()
    )
    offline_patch = (PACKAGE / "vggt-spark-offline.patch").read_text()
    assert "PyTorchModelHubMixin" in offline_patch
    assert "class VGGT(nn.Module):" in offline_patch


def test_direct_vggt_uses_the_upstream_model_precision_boundary() -> None:
    adapter = load_adapter()
    source = inspect.getsource(adapter.direct)
    assert "torch.autocast" not in source
    assert "with torch.no_grad():" in source
    assert "depth.float().cpu().numpy()" in source
    assert "points[mask]" in source
    assert "points.cpu().numpy()" not in source


def test_container_boundary_is_offline_nonroot_and_readonly_compatible() -> None:
    dockerfile = (PACKAGE / "Dockerfile.vggt-nc").read_text()
    overlay = (PACKAGE / "Dockerfile.vggt-nc-overlay").read_text()
    assert "HF_HUB_OFFLINE=1" in dockerfile
    assert "USER 65532:65532" in dockerfile
    assert "TORCH_HOME=/nonexistent/torch-cache" in dockerfile
    assert "apt-get purge --yes cuda-keyring cuda-libraries-13-2" in dockerfile
    assert "../libssl3t64/copyright" in dockerfile
    assert "ENTRYPOINT" in dockerfile
    assert "FROM ${SEALED_BASE_IMAGE}" in overlay
    assert "apt-get" not in overlay
    assert "pip install" not in overlay
    assert "USER 65532:65532" in overlay
    assert "vggt_nc_capture.py" in overlay
    runner = (PACKAGE / "run_vggt_nc_research.py").read_text()
    adapter = (PACKAGE / "vggt_nc_capture.py").read_text()
    assert '"--task-vram-limit-bytes"' in runner
    assert '"docker", "rm", "--force"' in runner
    assert "environmentAuditSha256" in runner
    assert "enforce_vram_ceiling(args.task_vram_limit_bytes)" in adapter


def test_environment_audit_limits_cuda_metapackage_exception() -> None:
    source = (PACKAGE / "audit_vggt_nc_environment.py").read_text()

    assert 'metadata["Name"] != "cuda-toolkit"' in source
    assert 'distribution.version != "13.2.1"' in source
    assert 'expected_prefix = "cuda_toolkit-13.2.1.dist-info/"' in source
    assert "zero-code-metapackage" in source
    assert (
        '"/opt/c14-10-vggt/vggt_nc_capture.py"' in source
    )
    assert "a81ded95615441e2bde6e7a01a09e3267b8a97d939ae142ca6ee1af10c4b06ec" in source


def test_private_classifier_is_exact_offline_and_non_authoritative() -> None:
    source = (PACKAGE / "classify_vggt_nc_private_views.py").read_text()
    assert "local_files_only=True" in source
    assert 'os.environ["HF_HUB_OFFLINE"] = "1"' in source
    assert 'os.environ["TRANSFORMERS_OFFLINE"] = "1"' in source
    assert "612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b" in source
    assert "private-local-heuristic-not-representative-accuracy" in source


def test_parser_rejects_unfrozen_stage_sizes() -> None:
    adapter = load_adapter()
    parser = adapter.parser()
    with pytest.raises(SystemExit):
        parser.parse_args(
            [
                "--candidate-id",
                "vggt-1b-nc-direct",
                "--input",
                "/tmp/input",
                "--model",
                "/tmp/model",
                "--output",
                "/tmp/output",
                "--source-commit",
                "a",
                "--slam-source-commit",
                "b",
                "--model-revision",
                "c",
                "--weight-sha256",
                "d",
                "--model-readme-sha256",
                "e",
                "--model-config-sha256",
                "f",
                "--run-index",
                "1",
                "--frame-limit",
                "47",
                "--task-vram-limit-bytes",
                "1024",
            ]
        )


def test_similarity_alignment_recovers_known_transform() -> None:
    adapter = load_adapter()
    source = np.asarray([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 3.0]])
    rotation = np.asarray([[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    target = 2.5 * (source @ rotation.T) + np.asarray([4.0, -3.0, 2.0])
    recovered_rotation, translation, scale, residual = adapter.umeyama(source, target)
    assert np.allclose(recovered_rotation, rotation)
    assert np.allclose(translation, [4.0, -3.0, 2.0])
    assert scale == pytest.approx(2.5)
    assert residual < 1e-12


def test_self_normalised_occupancy_is_bounded() -> None:
    adapter = load_adapter()
    points = np.asarray(
        [[x, y, z] for x in range(4) for y in range(4) for z in range(4)], dtype=np.float32
    )
    value = adapter.occupied_voxel_fraction(points, resolution=4)
    assert 0.0 < value <= 1.0


def test_camera_diagnostics_label_identical_prior_agreement_as_not_accuracy() -> None:
    adapter = load_adapter()
    extrinsics = np.repeat(np.eye(4)[None, ...], 4, axis=0)
    extrinsics[:, 0, 3] = [0.0, -1.0, -2.0, -3.0]
    frames = [{"worldToCamera": value.reshape(-1).tolist()} for value in extrinsics]
    result = adapter.camera_diagnostics(extrinsics, frames)
    assert result["authority"] == "agreement-to-retained-arkit-prior-not-independent-accuracy"
    assert result["positionRmseMetresNotIndependentlyValidated"] == pytest.approx(0.0)
    assert result["orientationMedianDegrees"] == pytest.approx(0.0)


def test_private_write_never_overwrites(tmp_path: Path) -> None:
    adapter = load_adapter()
    target = tmp_path / "record.json"
    adapter.private_write(target, b"first")
    with pytest.raises(FileExistsError):
        adapter.private_write(target, b"second")
    assert target.read_bytes() == b"first"


def test_runner_retained_bytes_rejects_links(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = load_runner(monkeypatch)
    (tmp_path / "artifact.bin").write_bytes(b"1234")
    assert module.retained_bytes(tmp_path) == 4
    (tmp_path / "unsafe-link").symlink_to(tmp_path / "artifact.bin")
    with pytest.raises(ValueError, match="symlink"):
        module.retained_bytes(tmp_path)


def test_runner_requires_one_explicit_frozen_maximum_stage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_runner(monkeypatch)
    parser = module.parser()
    common = [
        "--registry",
        "/home/private/registry.json",
        "--image-id",
        "sha256:" + "0" * 64,
        "--input",
        "/home/private/input",
        "--model",
        "/home/private/model",
        "--environment-audit",
        "/home/private/audit.json",
        "--output-root",
        "/home/private/output",
        "--candidate",
        "vggt-1b-nc-direct",
    ]
    with pytest.raises(SystemExit):
        parser.parse_args(common)
    parsed = parser.parse_args([*common, "--max-stage", "48"])
    assert parsed.max_stage == 48
    with pytest.raises(SystemExit):
        parser.parse_args([*common, "--max-stage", "49"])

    assert module.stages_through(4) == (4,)
    assert module.stages_through(48) == (4, 16, 48)
    assert module.stages_through(165) == (4, 16, 48, 165)
    with pytest.raises(ValueError, match="not frozen"):
        module.stages_through(49)


def test_runner_refuses_stage_records_from_another_freeze(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_runner(monkeypatch)
    matching = {"imageId": "sha256:image", "registrySha256": "registry"}
    module.validate_resumable_record(matching, "sha256:image", "registry")
    with pytest.raises(ValueError, match="identity differs"):
        module.validate_resumable_record(matching, "sha256:other", "registry")
    with pytest.raises(ValueError, match="identity differs"):
        module.validate_resumable_record(matching, "sha256:image", "other")


def test_runner_reopens_the_same_safe_root_for_later_gates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = load_runner(monkeypatch)
    existing = module.resumable_root(tmp_path)
    assert existing == tmp_path
    fresh = module.resumable_root(tmp_path / "fresh")
    assert fresh.is_dir()
    assert module.resumable_root(fresh) == fresh


def test_runner_independently_validates_candidate_result_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = load_runner(monkeypatch)
    artifacts = {
        "proposal-points.ply": b"ply",
        "proposal-cameras.json": b"{}\n",
    }
    hashes: dict[str, str] = {}
    for name, payload in artifacts.items():
        path = tmp_path / name
        path.write_bytes(payload)
        hashes[name] = module.sha256_file(path)
    candidate = {
        "code": {"commit": "source"},
        "weight": {"revision": "revision", "sha256": "weight"},
    }
    result = {
        "artifacts": hashes,
        "authority": "strictly-private-non-commercial-research-proposal-only",
        "candidateId": "vggt-1b-nc-direct",
        "commercialUse": "PROHIBITED_REEVALUATION_REQUIRED",
        "dimensionalAccuracy": "NOT RUN",
        "finitePointCount": 2,
        "heldOutAppearance": "NOT RUN",
        "inputManifestSha256": "input",
        "modelRevision": "revision",
        "peakTaskVramBytes": 1,
        "productionAuthority": "none",
        "registeredViewCount": 4,
        "representativeAccuracy": "NOT RUN",
        "runIndex": 1,
        "schemaVersion": module.RESULT_SCHEMA,
        "slamSourceCommit": "35327ac28b7d193df9ccc39ba6346052bb6f1207",
        "sourceCommit": "source",
        "sourceViewCount": 4,
        "segmentId": "segment",
        "selectionSha256": "selection",
        "weightSha256": "weight",
    }
    arguments = {
        "result": result,
        "candidate_id": "vggt-1b-nc-direct",
        "candidate": candidate,
        "stage": 4,
        "run_index": 1,
        "scope": tmp_path,
        "freeze": {
            "inputManifestSha256": "input",
            "maxPoints": 500_000,
            "segmentId": "segment",
            "selectionSha256": "selection",
        },
    }
    assert module.validate_candidate_result(**arguments)
    result["cameraConsistency"] = {"positionRmse": float("nan")}
    assert not module.validate_candidate_result(**arguments)
    del result["cameraConsistency"]
    (tmp_path / "proposal-points.ply").write_bytes(b"changed")
    assert not module.validate_candidate_result(**arguments)


def test_private_viewer_is_quarantined_and_requires_every_lane() -> None:
    source = (PACKAGE / "build_vggt_nc_private_viewer.py").read_text()
    assert "strictly-private-non-commercial-research-only" in source
    assert "Future commercial evaluation requires appropriately licensed weights" in source
    assert "Patched VGGT-SLAM-derived no-loop adapter proposal" in source
    assert "SALAD loop-closure path was not run" in source
    assert "does not establish upstream VGGT-SLAM 2.0 loop-closure" in source
    assert 'LANES = ("retained-control", "vggt-direct", "vggt-slam-hybrid")' in source
    assert "https://" not in source
