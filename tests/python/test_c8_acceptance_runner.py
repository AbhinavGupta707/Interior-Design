from __future__ import annotations

import importlib.util
import stat
import sys
from pathlib import Path
from types import ModuleType
from typing import cast

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
RUNNER_PATH = REPOSITORY_ROOT / "ml/reconstruction/windows-nvidia-v2/run_acceptance.py"
SPEC = importlib.util.spec_from_file_location("c8_acceptance_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)
RUNNER = cast(ModuleType, RUNNER)


def test_container_writable_directory_overrides_host_umask(tmp_path: Path) -> None:
    target = tmp_path / "sparse"

    RUNNER._prepare_directory(target, writable_by_container=True)

    assert stat.S_IMODE(target.stat().st_mode) == 0o777


def test_each_container_command_has_a_bounded_timeout() -> None:
    timeout = RUNNER.COMMAND_TIMEOUT_SECONDS

    assert isinstance(timeout, int)
    assert 60 <= timeout <= 60 * 60
