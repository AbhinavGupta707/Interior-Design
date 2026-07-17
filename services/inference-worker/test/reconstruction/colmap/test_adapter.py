"""COLMAP adapter tests using visibly synthetic fixture executables."""

import hashlib
import shutil
import sys
from pathlib import Path

import pytest
from inference_worker.reconstruction.colmap.adapter import ColmapAdapter, StagedImage
from inference_worker.reconstruction.common.execution import (
    BinaryId,
    BinaryRegistry,
    SubprocessLimits,
    run_bounded,
)
from inference_worker.reconstruction.common.manifest import HashOnlyArtifactPublisher
from inference_worker.reconstruction.common.workspace import IsolatedWorkspace


def _fake_colmap(path: Path) -> Path:
    body = r"""
import pathlib
import sys

if sys.argv[1:] == ["-h"]:
    print("COLMAP 4.2.0-fixture")
    raise SystemExit(0)
command = sys.argv[1]
if command == "mapper":
    model = pathlib.Path("sparse/0")
    model.mkdir(parents=True, exist_ok=True)
    (model / "cameras.txt").write_text(
        "10 PINHOLE 100 80 50 50 50 40\n", encoding="utf-8"
    )
    (model / "images.txt").write_text(
        "7 1 0 0 0 0 0 0 10 frame-000000.jpg\n10 10 100\n"
        "42 1 0 0 0 1 0 0 10 frame-000001.png\n12 12 100\n",
        encoding="utf-8",
    )
    (model / "points3D.txt").write_text(
        "100 1 2 3 10 20 30 0.1 7 0 42 0\n", encoding="utf-8"
    )
raise SystemExit(0)
"""
    interpreter = Path(sys.executable).resolve(strict=True)
    path.write_text(f"#!{interpreter}\n{body}", encoding="utf-8")
    path.chmod(0o700)
    return path


def _frames(tmp_path: Path) -> tuple[StagedImage, ...]:
    result: list[StagedImage] = []
    for index, media_type in enumerate(("image/jpeg", "image/png", "image/jpeg")):
        path = tmp_path / f"synthetic-{index}.bin"
        payload = f"visibly synthetic frame {index}".encode()
        path.write_bytes(payload)
        result.append(
            StagedImage(
                source_path=path,
                sha256=hashlib.sha256(payload).hexdigest(),
                media_type=media_type,
            )
        )
    return tuple(result)


def test_fake_executable_proves_adapter_not_colmap_algorithm_runtime(tmp_path: Path) -> None:
    executable = _fake_colmap(tmp_path / "fixture-colmap")
    workspace_base = tmp_path / "workspaces"
    publisher = HashOnlyArtifactPublisher()
    adapter = ColmapAdapter(
        BinaryRegistry.fixture({BinaryId.COLMAP: executable}),
        workspace_base=workspace_base,
    )

    result = adapter.run_sparse(
        _frames(tmp_path),
        source_manifest_sha256="a" * 64,
        publisher=publisher,
    )

    assert result.status == "partial"
    assert result.registered_frame_count == 2
    assert result.input_frame_count == 3
    assert result.scale_status == "unknown"
    assert result.unit == "arbitrary-units"
    assert result.tool.execution_evidence == "fixture-executable"
    assert result.tool.executable_version == "4.2.0-fixture"
    assert [finding.code for finding in result.findings] == ["PARTIAL_REGISTRATION"]
    assert len(result.components) == 1
    assert len(result.geometry) == 1
    assert result.geometry[0].vertex_count == 1
    assert b"synthetic-" not in result.to_bytes()
    assert b"/Users/" not in result.to_bytes()
    assert list(workspace_base.iterdir()) == []


def test_missing_colmap_returns_explicit_not_run_abstention(tmp_path: Path) -> None:
    result = ColmapAdapter(
        BinaryRegistry({}),
        workspace_base=tmp_path / "workspaces",
    ).run_sparse(
        _frames(tmp_path)[:2],
        source_manifest_sha256="b" * 64,
        publisher=HashOnlyArtifactPublisher(),
    )
    assert result.status == "abstained"
    assert result.tool.execution_evidence == "not-run-unavailable"
    assert result.tool.executable_version == "not-installed"
    assert [finding.code for finding in result.findings] == ["COLMAP_NOT_INSTALLED"]


def test_real_colmap_help_only_when_installed(tmp_path: Path) -> None:
    if shutil.which("colmap") is None:
        pytest.skip("COLMAP real binary NOT RUN: colmap is not installed")
    with IsolatedWorkspace(base_directory=tmp_path) as workspace:
        outcome = run_bounded(
            BinaryRegistry.production(),
            BinaryId.COLMAP,
            ("-h",),
            workspace=workspace.root,
            limits=SubprocessLimits(timeout_seconds=15, maximum_output_bytes=65_536),
        )
    assert outcome.succeeded
    assert outcome.stdout or outcome.stderr
