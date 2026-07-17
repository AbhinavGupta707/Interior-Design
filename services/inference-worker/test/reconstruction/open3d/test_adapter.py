"""Open3D adapter evidence with fake executable and honest installed-tool probes."""

import hashlib
import importlib.util
import sys
from pathlib import Path

import pytest
from inference_worker.reconstruction.common.execution import (
    BinaryId,
    BinaryRegistry,
    SubprocessLimits,
    run_bounded,
)
from inference_worker.reconstruction.common.manifest import HashOnlyArtifactPublisher
from inference_worker.reconstruction.common.workspace import IsolatedWorkspace
from inference_worker.reconstruction.open3d.adapter import Open3dTsdfAdapter
from inference_worker.reconstruction.open3d.types import (
    KnownPose,
    KnownPoseRgbdInput,
    PinholeIntrinsics,
    RgbdFrame,
    TsdfConfig,
)

IDENTITY = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)


def _input(tmp_path: Path) -> KnownPoseRgbdInput:
    frames: list[RgbdFrame] = []
    for index in range(2):
        color = tmp_path / f"color-{index}.fixture"
        depth = tmp_path / f"depth-{index}.fixture"
        color_bytes = f"synthetic color {index}".encode()
        depth_bytes = f"synthetic depth {index}".encode()
        color.write_bytes(color_bytes)
        depth.write_bytes(depth_bytes)
        frames.append(
            RgbdFrame(
                color_path=color,
                depth_path=depth,
                color_sha256=hashlib.sha256(color_bytes).hexdigest(),
                depth_sha256=hashlib.sha256(depth_bytes).hexdigest(),
                width=2,
                height=2,
                timestamp_microseconds=index * 1_000,
                pose=KnownPose(IDENTITY, f"{index + 1}" * 64),
            )
        )
    return KnownPoseRgbdInput(
        frames=tuple(frames),
        intrinsics=PinholeIntrinsics(2, 2, 100.0, 100.0, 1.0, 1.0, "a" * 64),
        source_manifest_sha256="f" * 64,
    )


def _fake_python(path: Path, *, mismatch: bool = False, malformed_count: bool = False) -> Path:
    point_count = 9 if mismatch else 3
    ply_point_count = "not-an-integer" if malformed_count else "3"
    body = f"""
import pathlib
import sys

if "-c" in sys.argv:
    print("0.19.0-fixture")
    raise SystemExit(0)
pathlib.Path("open3d-points.ply").write_bytes(
    b"ply\\nformat ascii 1.0\\nelement vertex {ply_point_count}\\nend_header\\n"
)
pathlib.Path("open3d-mesh.ply").write_bytes(
    b"ply\\nformat ascii 1.0\\nelement vertex 4\\nelement face 2\\nend_header\\n"
)
print('{{"code":"OPEN3D_OK","meshTriangleCount":2,"meshVertexCount":4,"pointCount":{point_count}}}')
"""
    interpreter = Path(sys.executable).resolve(strict=True)
    path.write_text(f"#!{interpreter}\n{body}", encoding="utf-8")
    path.chmod(0o700)
    return path


def test_fake_open3d_proves_adapter_and_records_tsdf_not_algorithm_accuracy(
    tmp_path: Path,
) -> None:
    fake = _fake_python(tmp_path / "fixture-python")
    config = TsdfConfig(voxel_length_micrometres=8_000, sdf_truncation_micrometres=32_000)
    workspace_base = tmp_path / "workspaces"
    result = Open3dTsdfAdapter(
        BinaryRegistry.fixture({BinaryId.OPEN3D_PYTHON: fake}),
        config=config,
        workspace_base=workspace_base,
    ).run(_input(tmp_path), publisher=HashOnlyArtifactPublisher())

    assert result.status == "completed"
    assert result.tool.execution_evidence == "fixture-executable"
    assert result.tool.executable_version == "0.19.0-fixture"
    assert result.scale_status == "metric-estimated"
    assert result.unit == "micrometres"
    assert result.registered_frame_count == 2
    assert result.tsdf_parameters == config.to_json()
    assert {artifact.artifact.kind for artifact in result.geometry} == {
        "dense-point-cloud",
        "triangle-mesh",
    }
    assert result.geometry[0].vertex_count == 3
    assert result.geometry[1].triangle_count == 2
    assert [finding.code for finding in result.findings] == ["SCALE_SENSOR_ESTIMATED"]
    assert b".fixture" not in result.to_bytes()
    assert b"/Users/" not in result.to_bytes()
    assert list(workspace_base.iterdir()) == []


def test_runner_count_mismatch_abstains_instead_of_publishing_geometry(tmp_path: Path) -> None:
    fake = _fake_python(tmp_path / "fixture-python", mismatch=True)
    result = Open3dTsdfAdapter(
        BinaryRegistry.fixture({BinaryId.OPEN3D_PYTHON: fake}),
        workspace_base=tmp_path / "workspaces",
    ).run(_input(tmp_path), publisher=HashOnlyArtifactPublisher())
    assert result.status == "abstained"
    assert [finding.code for finding in result.findings] == ["OPEN3D_OUTPUT_MISMATCH"]
    assert result.geometry == ()


def test_malformed_ply_count_abstains_with_bounded_safe_code(tmp_path: Path) -> None:
    fake = _fake_python(tmp_path / "fixture-python", malformed_count=True)
    result = Open3dTsdfAdapter(
        BinaryRegistry.fixture({BinaryId.OPEN3D_PYTHON: fake}),
        workspace_base=tmp_path / "workspaces",
    ).run(_input(tmp_path), publisher=HashOnlyArtifactPublisher())
    assert result.status == "abstained"
    assert [finding.code for finding in result.findings] == ["OPEN3D_OUTPUT_INVALID"]
    assert result.geometry == ()


def test_missing_open3d_is_labelled_not_run_unavailable(tmp_path: Path) -> None:
    if importlib.util.find_spec("open3d") is not None:
        pytest.skip("Open3D is installed; unavailable-state fixture does not apply")
    result = Open3dTsdfAdapter(
        BinaryRegistry.production(), workspace_base=tmp_path / "workspaces"
    ).run(_input(tmp_path), publisher=HashOnlyArtifactPublisher())
    assert result.status == "abstained"
    assert result.tool.execution_evidence == "not-run-unavailable"
    assert [finding.code for finding in result.findings] == ["OPEN3D_NOT_INSTALLED"]


def test_real_open3d_version_only_when_installed(tmp_path: Path) -> None:
    if importlib.util.find_spec("open3d") is None:
        pytest.skip("Open3D real runtime NOT RUN: package is not installed")
    with IsolatedWorkspace(base_directory=tmp_path) as workspace:
        outcome = run_bounded(
            BinaryRegistry.production(),
            BinaryId.OPEN3D_PYTHON,
            ("-I", "-c", "import open3d; print(open3d.__version__)"),
            workspace=workspace.root,
            limits=SubprocessLimits(timeout_seconds=15, maximum_output_bytes=65_536),
        )
    assert outcome.succeeded
    assert outcome.stdout.strip()
