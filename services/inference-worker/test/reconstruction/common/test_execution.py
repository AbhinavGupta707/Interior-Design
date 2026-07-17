"""Bounded subprocess, cancellation and workspace-cleanup adapter evidence."""

import hashlib
import os
import sys
import time
from pathlib import Path

import pytest
from inference_worker.reconstruction.common.errors import ReconstructionError
from inference_worker.reconstruction.common.execution import (
    BinaryId,
    BinaryRegistry,
    SubprocessLimits,
    run_bounded,
)
from inference_worker.reconstruction.common.workspace import IsolatedWorkspace, safe_workspace_path


def _executable(path: Path, body: str) -> Path:
    interpreter = Path(sys.executable).resolve(strict=True)
    path.write_text(f"#!{interpreter}\n{body}", encoding="utf-8")
    path.chmod(0o700)
    return path


def test_workspace_rejects_traversal_absolute_backslash_and_symlink(tmp_path: Path) -> None:
    with IsolatedWorkspace(base_directory=tmp_path) as workspace:
        for hostile in ("../escape", "/absolute", "nested\\escape", "a/../../b"):
            with pytest.raises(ReconstructionError, match="UNSAFE_PATH"):
                safe_workspace_path(workspace.root, hostile)
        outside = tmp_path / "outside"
        outside.mkdir()
        (workspace.root / "link").symlink_to(outside, target_is_directory=True)
        with pytest.raises(ReconstructionError, match="UNSAFE_PATH"):
            safe_workspace_path(workspace.root, "link/file")


def test_verified_staging_checks_hash_and_workspace_is_cleaned(tmp_path: Path) -> None:
    source = tmp_path / "source.bin"
    source.write_bytes(b"visibly synthetic fixture")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    with IsolatedWorkspace(base_directory=tmp_path / "work") as workspace:
        root = workspace.root
        staged = workspace.stage_verified_file(
            source,
            "input/source.bin",
            expected_sha256=digest,
            maximum_bytes=100,
        )
        assert staged.read_bytes() == source.read_bytes()
    assert not root.exists()

    with (
        IsolatedWorkspace(base_directory=tmp_path / "work") as workspace,
        pytest.raises(ReconstructionError, match="SOURCE_MISMATCH"),
    ):
        workspace.stage_verified_file(
            source,
            "input/source.bin",
            expected_sha256="0" * 64,
            maximum_bytes=100,
        )


def test_sanitized_environment_does_not_forward_parent_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = _executable(
        tmp_path / "environment-tool",
        "import os\n"
        "print('|'.join([os.environ.get('LANG',''), os.environ.get('SECRET_FIXTURE','missing'), "
        "str(os.environ.get('HOME','').endswith('workspace'))]))\n",
    )
    monkeypatch.setenv("SECRET_FIXTURE", "must-not-cross-boundary")
    registry = BinaryRegistry.fixture({BinaryId.COLMAP: script})
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    result = run_bounded(
        registry,
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(timeout_seconds=2),
    )

    assert result.succeeded
    assert result.stdout.decode().startswith("C|missing|")
    assert b"must-not-cross-boundary" not in result.stdout


def test_output_limit_timeout_and_cancellation_terminate_the_process(tmp_path: Path) -> None:
    output_script = _executable(tmp_path / "output-tool", "print('x' * 200000)\n")
    sleep_script = _executable(tmp_path / "sleep-tool", "import time\ntime.sleep(60)\n")
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    output = run_bounded(
        BinaryRegistry.fixture({BinaryId.COLMAP: output_script}),
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(timeout_seconds=2, maximum_output_bytes=4_096),
    )
    assert output.status == "output-limit"

    timed_out = run_bounded(
        BinaryRegistry.fixture({BinaryId.COLMAP: sleep_script}),
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(timeout_seconds=0.05, termination_grace_seconds=0.01),
    )
    assert timed_out.status == "timed-out"

    started = time.monotonic()
    cancelled = run_bounded(
        BinaryRegistry.fixture({BinaryId.COLMAP: sleep_script}),
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(timeout_seconds=2, termination_grace_seconds=0.01),
        cancelled=lambda: time.monotonic() - started > 0.05,
    )
    assert cancelled.status == "cancelled"
    assert cancelled.elapsed_milliseconds < 1_000


def test_workspace_file_limit_is_enforced_for_fast_completed_process(tmp_path: Path) -> None:
    script = _executable(
        tmp_path / "file-tool",
        "from pathlib import Path\nPath('large.bin').write_bytes(b'x' * 4096)\n",
    )
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    result = run_bounded(
        BinaryRegistry.fixture({BinaryId.COLMAP: script}),
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(timeout_seconds=2, maximum_file_bytes=1_024),
    )

    assert result.status == "file-limit"


def test_aggregate_workspace_limit_is_independent_of_per_file_limit(tmp_path: Path) -> None:
    script = _executable(
        tmp_path / "aggregate-tool",
        "from pathlib import Path\n"
        "Path('first.bin').write_bytes(b'x' * 700)\n"
        "Path('second.bin').write_bytes(b'x' * 700)\n",
    )
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    result = run_bounded(
        BinaryRegistry.fixture({BinaryId.COLMAP: script}),
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(
            timeout_seconds=2,
            maximum_file_bytes=1_000,
            maximum_workspace_bytes=1_200,
        ),
    )
    assert result.status == "file-limit"


def test_registry_rejects_non_executable_fixture(tmp_path: Path) -> None:
    path = tmp_path / "not-executable"
    path.write_text("fixture", encoding="utf-8")
    path.chmod(0o600)
    with pytest.raises(ReconstructionError, match="UNSAFE_EXECUTABLE"):
        BinaryRegistry.fixture({BinaryId.COLMAP: path})


def test_production_python_preserves_virtual_environment_entry_point() -> None:
    resolved = BinaryRegistry.production().resolve(BinaryId.OPEN3D_PYTHON)
    assert resolved.path == Path(sys.executable).absolute()


def test_hashes_logs_without_including_them_in_safe_summary(tmp_path: Path) -> None:
    script = _executable(
        tmp_path / "hash-tool", "import sys\nprint('safe fixture')\nprint('err', file=sys.stderr)\n"
    )
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    result = run_bounded(
        BinaryRegistry.fixture({BinaryId.COLMAP: script}),
        BinaryId.COLMAP,
        (),
        workspace=workspace,
        limits=SubprocessLimits(timeout_seconds=2),
    )
    assert result.stdout_sha256 == hashlib.sha256(b"safe fixture\n").hexdigest()
    assert result.stderr_sha256 == hashlib.sha256(b"err\n").hexdigest()
    assert os.fspath(script) not in repr(result)
