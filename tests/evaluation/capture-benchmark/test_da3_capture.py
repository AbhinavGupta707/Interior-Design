from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

pytest.importorskip("numpy", reason="DA3 evaluation runtime is optional")
pytest.importorskip("PIL", reason="DA3 evaluation runtime is optional")

import numpy as np  # type: ignore[import-not-found]  # noqa: E402
from PIL import Image  # type: ignore[import-not-found]

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "ml/reconstruction/windows-nvidia-v2"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, PACKAGE / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    sys.path.insert(0, str(PACKAGE))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(PACKAGE))
    return module


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_input(tmp_path: Path) -> Path:
    root = tmp_path / "input"
    images = root / "images"
    images.mkdir(parents=True)
    image = images / "frame.png"
    Image.new("RGB", (4, 3), (10, 20, 30)).save(image)
    manifest = {
        "authority": "proposal-only-learned-input-copy",
        "cohort": "normal",
        "frames": [
            {
                "cameraIntrinsics": [4.0, 4.0, 2.0, 1.5],
                "heightPixels": 3,
                "imageName": image.name,
                "imageSha256": sha256(image),
                "sampleId": "fixture",
                "widthPixels": 4,
                "worldToCamera": np.eye(4).reshape(-1).tolist(),
            }
        ],
        "heldOutPolicy": "last-frame-when-four-or-more",
        "schemaVersion": "c14-10-da3-input-v1",
        "segmentId": "fixture-segment",
        "selectionSha256": "a" * 64,
        "sourceCoordinateSystem": "arkit-segment-converted-to-opencv-world-to-camera",
        "sourceUnit": "metres-from-arkit-not-independently-validated",
    }
    (root / "da3-input.json").write_bytes(
        json.dumps(manifest, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
        + b"\n"
    )
    return root


def test_input_is_hash_bound_and_symlink_rejected(tmp_path: Path) -> None:
    module = load("da3_capture")
    root = make_input(tmp_path)
    manifest, paths = module.load_input(root)
    assert manifest["authority"] == "proposal-only-learned-input-copy"
    assert len(paths) == 1
    paths[0].write_bytes(paths[0].read_bytes() + b"tamper")
    with pytest.raises(ValueError, match="hash mismatch"):
        module.load_input(root)

    root = make_input(tmp_path / "second")
    original = root / "images/frame.png"
    external = tmp_path / "external.png"
    original.rename(external)
    os.symlink(external, original)
    with pytest.raises(ValueError, match="confined regular file"):
        module.load_input(root)


def test_similarity_alignment_recovers_known_transform() -> None:
    module = load("da3_capture")
    source = np.asarray([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
    rotation = np.asarray([[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    translation = np.asarray([4.0, -2.0, 1.0])
    target = 2.5 * (source @ rotation.T) + translation
    recovered_rotation, recovered_translation, scale, residual = module.umeyama(source, target)
    assert recovered_rotation == pytest.approx(rotation)
    assert recovered_translation == pytest.approx(translation)
    assert scale == pytest.approx(2.5)
    assert residual < 1e-12


def test_binary_ply_is_private_and_not_replaced(tmp_path: Path) -> None:
    module = load("da3_capture")
    path = tmp_path / "points.ply"
    module.write_binary_ply(
        path,
        np.asarray([[1.0, 2.0, 3.0]], dtype=np.float32),
        np.asarray([[4, 5, 6]], dtype=np.uint8),
    )
    assert path.read_bytes().startswith(b"ply\nformat binary_little_endian 1.0\n")
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError, match="replace"):
        module.write_binary_ply(
            path,
            np.asarray([[1.0, 2.0, 3.0]], dtype=np.float32),
            np.asarray([[4, 5, 6]], dtype=np.uint8),
        )


def test_private_renderer_reads_adapter_binary_ply(tmp_path: Path) -> None:
    capture = load("da3_capture")
    renderer = load("render_ply_views")
    path = tmp_path / "points.ply"
    capture.write_binary_ply(
        path,
        np.asarray([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]], dtype=np.float32),
        np.asarray([[7, 8, 9], [10, 11, 12]], dtype=np.uint8),
    )
    points, colours, source_count = renderer.load_ply(path, max_points=10)
    assert source_count == 2
    np.testing.assert_allclose(points, [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    assert colours.tolist() == [[7, 8, 9], [10, 11, 12]]


def test_repeatable_zero_coverage_is_failed_quality() -> None:
    metrics = load("da3_metrics")
    base = {
        "artifacts": {
            "held-out-render.png": "a" * 64,
            "proposal-cameras.json": "b" * 64,
            "proposal-points.ply": "c" * 64,
        },
        "candidateId": "da3-small",
        "cohort": "normal",
        "configSha256": "d" * 64,
        "geometry": {"retainedPointCount": 42},
        "heldOutAppearance": {"coverageFraction": 0.0, "fullFramePsnrDb": 5.5},
        "inputManifestSha256": "e" * 64,
        "peakHostMaxRssBytes": 100,
        "peakTaskVramBytes": 200,
        "registeredViewCount": 4,
        "segmentId": "private-segment",
        "selectionSha256": "f" * 64,
        "sourceCommit": "1" * 40,
        "sourceViewCount": 4,
        "wallSeconds": 1.0,
        "weightSha256": "2" * 64,
    }
    first = dict(base, runIndex=1)
    second = dict(base, runIndex=2)
    comparison = metrics.compare(first, second)
    assert comparison["passed"] is True
    assert comparison["artifactHashesExact"] is True
    assert comparison["heldOutQualityStatus"] == "FAILED_ZERO_COVERAGE"
    assert comparison["connectivity"]["componentCount"] is None
    assert comparison["connectivity"]["connectedViewCount"] is None
    assert comparison["connectivity"]["status"] == "NOT RUN"


def test_runner_registry_excludes_conflicted_large_candidate() -> None:
    runner = load("run_da3_matrix")
    registry = PACKAGE / "c14-10-learned-candidates.json"
    image_id = "sha256:246b7363b7ff9d2a38a688607aa9d89d6085734c1b7acc88221e00f04590e0d3"
    candidates, limits = runner.registry_candidates(registry, image_id)
    assert set(candidates) == {"da3-small"}
    assert limits["processResolution"] == 392
    assert limits["taskVramLimitBytes"] == 15 * 1024**3
    assert limits["retainedOutputLimitBytes"] == 16 * 1024**3

    value = json.loads(registry.read_bytes())
    large = next(
        candidate
        for candidate in value["candidates"]
        if candidate["candidateId"] == "da3-large-1.1"
    )
    assert large["executionState"] == "blocked-after-independent-review"
    assert "CONFLICTING_OFFICIAL_WEIGHT_LICENCE_METADATA" in large["blockedReasons"]


def test_runner_hash_binds_weight_config_and_model_card(tmp_path: Path) -> None:
    runner = load("run_da3_matrix")
    model_root = tmp_path / "model"
    model_root.mkdir()
    weight = model_root / "model.safetensors"
    config = model_root / "config.json"
    readme = model_root / "README.md"
    weight.write_bytes(b"weight")
    config.write_bytes(b"config")
    readme.write_bytes(b"model card")
    candidate = {
        "modelConfigSha256": sha256(config),
        "modelReadmeSha256": sha256(readme),
        "weight": {
            "file": weight.name,
            "sha256": sha256(weight),
            "sizeBytes": weight.stat().st_size,
        },
    }
    runner.validate_model_root(model_root, candidate)
    config.write_bytes(b"tampered")
    with pytest.raises(ValueError, match="model config differs"):
        runner.validate_model_root(model_root, candidate)


def test_runner_command_keeps_gpu_and_container_isolation(tmp_path: Path) -> None:
    runner = load("run_da3_matrix")
    _, command = runner.docker_command(
        candidate_id="da3-small",
        image_id="sha256:" + "a" * 64,
        input_root=tmp_path / "input",
        model_root=tmp_path / "model",
        output_root=tmp_path / "output",
        run_index=1,
        source_commit="b" * 40,
        weight_sha256="c" * 64,
        process_res=392,
    )
    assert "--rm" in command
    assert command[command.index("--network") + 1] == "none"
    assert command[command.index("--gpus") + 1] == "device=0"
    assert command[command.index("--read-only")]
    assert command[command.index("--user") + 1] == f"{os.getuid()}:{os.getgid()}"
    assert command[command.index("--env") + 1] == "HOME=/tmp"


def test_physical_first_pass_deduplicates_identical_complete_cohorts() -> None:
    runner = load("run_da3_physical_first_pass")
    segment = {
        "frames": [{"sampleId": str(index)} for index in range(132)],
        "segmentId": "private-segment",
    }
    selection = {
        "cohorts": {
            "inclusive": {"segments": [segment]},
            "normal": {"segments": [segment]},
        }
    }
    segment_id, segment_key = runner.select_single_normal_segment(selection, 132)
    assert segment_id == "private-segment"
    assert segment_key == hashlib.sha256(segment_id.encode()).hexdigest()[:12]


def test_physical_first_pass_rejects_nonidentical_or_incomplete_cohorts() -> None:
    runner = load("run_da3_physical_first_pass")
    normal = {
        "frames": [{"sampleId": str(index)} for index in range(132)],
        "segmentId": "s",
    }
    inclusive = json.loads(json.dumps(normal))
    inclusive["frames"].append({"sampleId": "extra"})
    selection = {
        "cohorts": {
            "inclusive": {"segments": [inclusive]},
            "normal": {"segments": [normal]},
        }
    }
    with pytest.raises(ValueError, match="byte-identical"):
        runner.select_single_normal_segment(selection, 132)
    selection["cohorts"]["inclusive"]["segments"] = [normal]
    with pytest.raises(ValueError, match="complete declared capture"):
        runner.select_single_normal_segment(selection, 165)


def test_physical_first_pass_plan_closes_second_repeats(tmp_path: Path) -> None:
    runner = load("run_da3_physical_first_pass")
    plan_path = PACKAGE / "c14-10-physical-evaluation-plan.json"
    plan_sha, profile = runner.validate_plan(plan_path, 132)
    assert len(plan_sha) == 64
    assert profile["timeoutSeconds"] == 2700
    plan = json.loads(plan_path.read_bytes())
    assert plan["lanes"]["da3Small"]["repeats"] == 1
    assert plan["lanes"]["qualityFullSequentialMobile"]["repeats"] == 2
    assert (
        plan["lanes"]["qualityFullSequentialMobile"]["repeat2Decision"]
        == "not-run-first-pass-sufficient"
    )
    assert plan["firstPassStopRule"]["fullQualityRepeat2"] == "not-run"
    assert plan["lanes"]["da3Small"]["weightSha256"] == runner.WEIGHT_SHA256

    mismatched = json.loads(json.dumps(plan))
    mismatched["lanes"]["da3Small"]["weightSha256"] = "0" * 64
    mismatched_path = tmp_path / "mismatched-plan.json"
    mismatched_path.write_text(json.dumps(mismatched), encoding="utf-8")
    with pytest.raises(ValueError, match="first-pass stop rule"):
        runner.validate_plan(mismatched_path, 132)


def test_private_side_by_side_viewer_is_complete_and_path_redacted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    viewer = load("build_private_side_by_side_viewer")
    sources = []
    for capture in viewer.CAPTURES:
        for lane in viewer.LANES:
            key = f"{capture}/{lane}"
            root = tmp_path / capture / lane
            root.mkdir(parents=True)
            artifacts = {}
            for index, view in enumerate(viewer.VIEWS):
                image = root / f"{view}.png"
                Image.new("RGB", (2, 2), (index, 20, 30)).save(image)
                artifacts[image.name] = sha256(image)
            (root / "inspection.json").write_text(
                json.dumps(
                    {
                        "artifacts": artifacts,
                        "inputSha256": "a" * 64,
                        "renderedPointCount": 2,
                        "schemaVersion": "c14-10-private-ply-inspection-v1",
                        "sourceVertexCount": 2,
                    }
                ),
                encoding="utf-8",
            )
            sources.append(f"{key}={root}")
    output = tmp_path / "viewer"
    output.mkdir()
    monkeypatch.setattr(viewer, "private_existing", lambda path, _label: path)
    monkeypatch.setattr(viewer, "private_output", lambda path: path)
    viewer.build(SimpleNamespace(output=str(output), source=sources))
    manifest = json.loads((output / "viewer-manifest.json").read_bytes())
    assert manifest["schemaVersion"] == "c14-10-private-side-by-side-viewer-v1"
    assert len(manifest["records"]) == 12
    assert len(list((output / "assets").glob("*.png"))) == 36
    viewer_html = (output / "index.html").read_text(encoding="utf-8")
    assert str(tmp_path) not in viewer_html
    assert "no-dimensional-or-representative-accuracy" in manifest["claims"]
    with pytest.raises(ValueError, match="every declared capture"):
        viewer.parse_sources(sources[:-1])
