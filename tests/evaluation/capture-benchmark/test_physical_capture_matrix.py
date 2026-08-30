from __future__ import annotations

import ast
import importlib.util
import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "ml/reconstruction/windows-nvidia-v2"


def load_module(name: str, path: Path) -> ModuleType:
    sys.path.insert(0, str(PACKAGE))
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(PACKAGE))


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


def test_ordered_quantile_indices_are_deterministic_unique_and_include_endpoints() -> None:
    capture = load_module("capture_benchmark_ordered", PACKAGE / "capture_benchmark.py")
    assert capture.ordered_frame_indices(10, 4) == (0, 3, 6, 9)
    indices = capture.ordered_frame_indices(132, 25)
    assert len(indices) == len(set(indices)) == 25
    assert indices[0] == 0
    assert indices[-1] == 131
    with pytest.raises(ValueError, match="ordered sample count"):
        capture.ordered_frame_indices(10, 11)


def test_ordered_adapter_keeps_input_and_prior_names_in_capture_order(
    tmp_path: Path,
) -> None:
    capture = load_module("capture_benchmark_ordered_io", PACKAGE / "capture_benchmark.py")
    export_root = make_fixture(tmp_path)
    selection = tmp_path / "selection.json"
    capture.write_selection(SimpleNamespace(export_root=str(export_root), output=str(selection)))
    selected = json.loads(selection.read_bytes())
    segment_id = selected["cohorts"]["inclusive"]["segments"][0]["segmentId"]

    colmap_input = tmp_path / "colmap-input"
    capture.write_colmap_input(
        SimpleNamespace(
            cohort="inclusive",
            export_root=str(export_root),
            ordered_image_names=True,
            ordered_sample_count=4,
            output=str(colmap_input),
            segment_id=segment_id,
            selection=str(selection),
        )
    )
    manifest = json.loads((colmap_input / "colmap-input.json").read_bytes())
    names = [frame["imageName"] for frame in manifest["frames"]]
    assert manifest["schemaVersion"] == "c14-10-ordered-colmap-input-v2"
    assert manifest["imageOrder"] == "capture-order"
    assert manifest["sampling"] == "ordered-quantile-4-v1"
    assert [frame["captureIndex"] for frame in manifest["frames"]] == [1, 4, 7, 10]
    assert names == sorted(names)
    assert len(list((colmap_input / "images").iterdir())) == 4

    prior = tmp_path / "prior"
    capture.write_colmap_prior(
        SimpleNamespace(
            cohort="inclusive",
            database=None,
            export_root=str(export_root),
            ordered_image_names=True,
            ordered_sample_count=4,
            output=str(prior),
            segment_id=segment_id,
            selection=str(selection),
        )
    )
    prior_manifest = json.loads((prior / "prior-manifest.json").read_bytes())
    assert [frame["imageName"] for frame in prior_manifest["frames"]] == names
    assert prior_manifest["imageOrder"] == "capture-order"
    assert prior_manifest["sampling"] == "ordered-quantile-4-v1"


def test_sequential_mobile_matcher_is_explicit_offline_and_deterministic() -> None:
    runner = load_module(
        "physical_capture_runner_matcher",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    command = runner.matching_command("sequential-mobile")
    assert command[0] == "sequential_matcher"
    assert command[command.index("--default_random_seed") + 1] == "0"
    assert command[command.index("--FeatureMatching.use_gpu") + 1] == "0"
    assert command[command.index("--FeatureMatching.num_threads") + 1] == "1"
    assert command[command.index("--TwoViewGeometry.random_seed") + 1] == "0"
    assert command[command.index("--SequentialMatching.overlap") + 1] == "10"
    assert command[command.index("--SequentialMatching.quadratic_overlap") + 1] == "1"
    assert command[command.index("--SequentialMatching.loop_detection") + 1] == "0"
    assert not any("http" in argument for argument in command)


def test_matcher_dependency_gate_rejects_missing_failed_and_timed_out_matchers(
    tmp_path: Path,
) -> None:
    runner = load_module(
        "physical_capture_runner_gate",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    database = tmp_path / "database.db"
    database.write_bytes(b"db")
    successful = {"exitCode": 0, "name": "scope-matching", "timedOut": False}
    assert runner.matcher_dependency_failure([successful], database) is None
    assert runner.matcher_dependency_failure([], database) == "UPSTREAM_MATCH_DATABASE_INCOMPLETE"
    assert (
        runner.matcher_dependency_failure([{**successful, "timedOut": True}], database)
        == "UPSTREAM_MATCH_DATABASE_INCOMPLETE"
    )
    assert (
        runner.matcher_dependency_failure([{**successful, "exitCode": 1}], database)
        == "UPSTREAM_MATCH_DATABASE_INCOMPLETE"
    )
    assert (
        runner.matcher_dependency_failure([successful], tmp_path / "missing.db")
        == "FEATURE_DATABASE_UNAVAILABLE"
    )


def test_failure_artifact_uses_existing_fallback_and_never_missing_prior_log(
    tmp_path: Path,
) -> None:
    runner = load_module(
        "physical_capture_runner_fallback",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    colmap_input = tmp_path / "colmap-input.log"
    colmap_input.write_text("input failed safely", encoding="utf-8")
    artifacts = runner.existing_artifacts(
        [(tmp_path / "prior-generate.log", "prior.log")],
        [tmp_path / "prior-generate.log", colmap_input],
    )
    assert artifacts[0]["path"] == "failure.log"
    assert artifacts[0]["byteSize"] == colmap_input.stat().st_size


def test_database_order_validation_rejects_lexical_uuid_order(
    tmp_path: Path,
) -> None:
    runner = load_module(
        "physical_capture_runner_order",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    manifest = tmp_path / "colmap-input.json"
    manifest.write_text(
        json.dumps(
            {
                "frames": [
                    {"captureIndex": 1, "imageName": "000001-b.png"},
                    {"captureIndex": 2, "imageName": "000002-a.png"},
                ],
                "imageOrder": "capture-order",
                "schemaVersion": "c14-10-ordered-colmap-input-v2",
            }
        ),
        encoding="utf-8",
    )
    database = tmp_path / "database.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE images(image_id INTEGER PRIMARY KEY, name TEXT)")
        connection.execute("INSERT INTO images VALUES(1, '000001-b.png')")
        connection.execute("INSERT INTO images VALUES(2, '000002-a.png')")
    assert runner.validate_database_order(database, manifest)["namesAligned"] is True
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE images SET image_id=3 WHERE image_id=1")
        connection.execute("UPDATE images SET image_id=1 WHERE image_id=2")
        connection.execute("UPDATE images SET image_id=2 WHERE image_id=3")
    with pytest.raises(ValueError, match="capture order"):
        runner.validate_database_order(database, manifest)


def test_gsplat_preparation_uses_committed_host_adapter_in_network_namespace(
    tmp_path: Path,
) -> None:
    runner = load_module(
        "physical_capture_runner_gsplat",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    command = runner.gsplat_prepare_command(
        package=PACKAGE,
        export_root=tmp_path / "export",
        selection=tmp_path / "selection.json",
        cohort="normal",
        segment_id="segment",
        model=tmp_path / "model",
        output=tmp_path / "output",
        sample_count=None,
    )
    assert command[:6] == [
        "unshare",
        "--user",
        "--map-root-user",
        "--net",
        "--",
        sys.executable,
    ]
    assert str(PACKAGE / "prepare_gsplat_capture.py") in command
    assert "/opt/c8/prepare_gsplat_capture.py" not in command


def test_runner_binds_exact_frozen_plan_and_rejects_scope_drift() -> None:
    runner = load_module(
        "physical_capture_runner_plan",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    plan = PACKAGE / "c14-10-physical-evaluation-plan.json"
    common = {
        "path": plan,
        "repository": ROOT,
        "product_source_commit": "62a0ed823dcd85f3355b4f24040484cff720ea75",
        "colmap_image": "sha256:68be6852c13de3573a79fb049ee2116937ba424cbd29b56583dc6a58617364f6",
        "gsplat_image": "sha256:93add58cb6b3ee7df927a47e98af0ed1d7d9fbac8607edea6de92d96a14e70d0",
    }
    sequential_sha, quality_profile = runner.validate_evaluation_plan(
        **common,
        matcher_mode="sequential-mobile",
        sample_count=None,
        expected_frame_count=132,
        execution_profile="quality-full",
        run_index=1,
    )
    exhaustive_sha, control_profile = runner.validate_evaluation_plan(
        **common,
        matcher_mode="exhaustive",
        sample_count=25,
        expected_frame_count=165,
        execution_profile="control-25",
        run_index=1,
    )
    assert sequential_sha == exhaustive_sha
    assert len(sequential_sha) == 64
    assert quality_profile["name"] == "qualityFull"
    assert quality_profile["stageTimeoutSeconds"]["colmap.matching"] == 3600
    assert quality_profile["stageTimeoutSeconds"]["colmap.patchmatch"] == 7200
    assert quality_profile["scratchLimitBytes"] == 24 * 1024**3
    assert control_profile["name"] == "control25"
    probe_sha, probe_profile = runner.validate_evaluation_plan(
        **common,
        matcher_mode="exhaustive",
        sample_count=20,
        expected_frame_count=132,
        execution_profile="adapter-probe",
        run_index=1,
    )
    assert probe_sha == sequential_sha
    assert probe_profile["name"] == "adapterProbe"
    with pytest.raises(ValueError, match="frozen evaluation plan"):
        runner.validate_evaluation_plan(
            **common,
            matcher_mode="exhaustive",
            sample_count=24,
            expected_frame_count=132,
            execution_profile="control-25",
            run_index=1,
        )


def test_all_execution_calls_bind_profiles_and_stage_limits() -> None:
    tree = ast.parse((PACKAGE / "run_physical_capture_matrix.py").read_text(encoding="utf-8"))

    def calls_named(name: str) -> list[ast.Call]:
        return [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == name
        ]

    sampled = calls_named("run_sampled")
    assert len(sampled) == 4
    assert all(
        {"timeout_seconds", "vram_limit_bytes"} <= {kw.arg for kw in call.keywords}
        for call in sampled
    )
    docker = calls_named("docker_command")
    assert len(docker) == 4
    assert all("resource_profile" in {kw.arg for kw in call.keywords} for call in docker)
    host = calls_named("run_host")
    assert len(host) == 5
    assert all(len(call.args) == 4 for call in host)


def test_quality_profile_is_enforced_by_container_boundary(tmp_path: Path) -> None:
    runner = load_module(
        "physical_capture_runner_resources",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    plan = json.loads((PACKAGE / "c14-10-physical-evaluation-plan.json").read_bytes())
    profile = {**plan["resourceProfiles"]["qualityFull"], "name": "qualityFull"}
    command = runner.docker_command(
        name="test",
        image="sha256:" + ("0" * 64),
        mounts=[(tmp_path, "/input", True)],
        command=["true"],
        resource_profile=profile,
    )
    assert command[command.index("--cpus") + 1] == "12"
    assert command[command.index("--memory") + 1] == str(24 * 1024**3)
    assert command[command.index("--pids-limit") + 1] == "512"
    boundary = runner.execution_boundary(profile)
    assert boundary["scratchLimitBytes"] == 24 * 1024**3
    fragment = runner.fragment(
        candidate="gsplat-direct",
        cohort="normal",
        segment_id="private-segment",
        run_index=1,
        derived_sha256="0" * 64,
        result_metrics={},
        resources={},
        artifacts=[],
        failure_code=None,
        selection_sha256="1" * 64,
        policy_sha256="2" * 64,
        image_id="sha256:" + ("3" * 64),
        plan={},
        execution_profile="quality-full",
        resource_profile=profile,
    )
    assert fragment["executionProfile"] == "quality-full"
    assert fragment["execution"]["scratchLimitBytes"] == 24 * 1024**3
    assert len(fragment["resourceProfileSha256"]) == 64
    assert boundary["taskVramLimitBytes"] == 14 * 1024**3


def test_runner_derives_one_private_segment_without_command_line_disclosure() -> None:
    runner = load_module(
        "physical_capture_runner_segment",
        PACKAGE / "run_physical_capture_matrix.py",
    )
    assert runner.resolve_segment_id([{"segmentId": "segment-a"}], None) == "segment-a"
    assert (
        runner.resolve_segment_id(
            [{"segmentId": "segment-a"}, {"segmentId": "segment-b"}],
            "segment-b",
        )
        == "segment-b"
    )
    with pytest.raises(ValueError, match="exactly one"):
        runner.resolve_segment_id(
            [{"segmentId": "segment-a"}, {"segmentId": "segment-b"}],
            None,
        )


def test_ordered_gsplat_adapter_accepts_exact_matching_model_scope(
    tmp_path: Path,
) -> None:
    capture = load_module(
        "capture_benchmark_gsplat_ordered",
        PACKAGE / "capture_benchmark.py",
    )
    prepare = load_module(
        "prepare_gsplat_capture_ordered",
        PACKAGE / "prepare_gsplat_capture.py",
    )
    export_root = make_fixture(tmp_path)
    selection = tmp_path / "selection.json"
    capture.write_selection(SimpleNamespace(export_root=str(export_root), output=str(selection)))
    selected = json.loads(selection.read_bytes())
    cohort = selected["cohorts"]["inclusive"]
    segment = cohort["segments"][0]
    source_frames = segment["frames"]
    model = tmp_path / "model"
    capture.write_colmap_prior(
        SimpleNamespace(
            cohort="inclusive",
            database=None,
            export_root=str(export_root),
            ordered_image_names=True,
            ordered_sample_count=4,
            output=str(model),
            segment_id=segment["segmentId"],
            selection=str(selection),
        )
    )
    selected_frames, names_by_sample = prepare.selected_model_frame_names(
        source_frames,
        ordered_image_names=True,
        ordered_sample_count=4,
    )
    model_images = prepare.parse_images(model / "images.txt", set(names_by_sample.values()))
    assert len(selected_frames) == len(model_images) == 4
    assert [index for index, _ in selected_frames] == [1, 4, 7, 10]
    assert set(model_images) == set(names_by_sample.values())

    legacy_names = {capture.colmap_image_name(frame) for _, frame in selected_frames}
    with pytest.raises(ValueError, match="exactly match"):
        prepare.parse_images(model / "images.txt", legacy_names)
