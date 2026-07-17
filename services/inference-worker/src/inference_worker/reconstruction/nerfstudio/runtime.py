"""Allowlisted process execution and CUDA/tool registration for C8 appearance."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, cast

from .contracts import ManifestError

PINNED_PYTHON_VERSION = "3.10.13"
PINNED_TORCH_VERSION = "2.1.2+cu118"
PINNED_CUDA_VERSION = "11.8"
PINNED_NERFSTUDIO_VERSION = "1.1.5"
PINNED_GSPLAT_VERSION = "1.4.0"

type RegistrationStatus = Literal["available", "unavailable"]


@dataclass(frozen=True, slots=True)
class RegisteredRuntime:
    """Trusted executable paths discovered by the worker, never by a job manifest."""

    ns_export: Path
    ns_train: Path
    nvidia_smi: Path
    python: Path
    executable_version: str


@dataclass(frozen=True, slots=True)
class RuntimeRegistration:
    """Registration result suitable for honest provider/hardware state."""

    status: RegistrationStatus
    safe_code: str
    runtime: RegisteredRuntime | None = None


@dataclass(frozen=True, slots=True)
class CommandResult:
    """Safe numeric command observations; subprocess text is never returned."""

    duration_milliseconds: int
    exit_code: int
    peak_resident_memory_bytes: int | None = None


class CommandCancelled(RuntimeError):
    """Fixed command was cancelled cooperatively."""


class CommandTimedOut(RuntimeError):
    """Fixed command exceeded its wall-clock deadline."""


class CommandOutputLimit(RuntimeError):
    """Fixed command exceeded the adapter's private diagnostic-output budget."""


class CommandExecutor(Protocol):
    """Injectable fixed-command execution boundary."""

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
        cancelled: Callable[[], bool],
    ) -> CommandResult: ...


class SubprocessExecutor:
    """Run a fixed argv without a shell, bounded output, or inherited credentials."""

    _poll_seconds = 0.1
    _termination_grace_seconds = 5.0
    _default_maximum_output_bytes = 16_777_216

    def __init__(self, *, maximum_output_bytes: int = _default_maximum_output_bytes) -> None:
        if not 1 <= maximum_output_bytes <= self._default_maximum_output_bytes:
            raise ValueError("APPEARANCE_OUTPUT_LIMIT_INVALID")
        self._maximum_output_bytes = maximum_output_bytes

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
        cancelled: Callable[[], bool],
    ) -> CommandResult:
        if not argv or timeout_seconds < 1:
            raise ManifestError("APPEARANCE_COMMAND_INVALID")
        started = time.monotonic()
        runtime_home = cwd / ".c8-runtime-home"
        runtime_home.mkdir(mode=0o700, exist_ok=True)
        safe_environment = self._safe_environment(runtime_home=runtime_home)
        creation_flags = 0
        start_new_session = os.name != "nt"
        if os.name == "nt":
            creation_flags = int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen(  # noqa: S603 - argv is built only by fixed adapters.
                tuple(argv),
                cwd=cwd,
                env=safe_environment,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                close_fds=True,
                shell=False,
                start_new_session=start_new_session,
                creationflags=creation_flags,
            )
            try:
                while process.poll() is None:
                    if cancelled():
                        self._terminate(process)
                        raise CommandCancelled
                    if os.fstat(output.fileno()).st_size > self._maximum_output_bytes:
                        self._terminate(process)
                        raise CommandOutputLimit
                    if time.monotonic() - started >= timeout_seconds:
                        self._terminate(process)
                        raise CommandTimedOut
                    time.sleep(self._poll_seconds)
                if os.fstat(output.fileno()).st_size > self._maximum_output_bytes:
                    raise CommandOutputLimit
                exit_code = int(process.returncode or 0)
            finally:
                if process.poll() is None:
                    self._terminate(process)
        return CommandResult(
            duration_milliseconds=max(0, int((time.monotonic() - started) * 1_000)),
            exit_code=exit_code,
        )

    @staticmethod
    def _safe_environment(*, runtime_home: Path | None = None) -> dict[str, str]:
        fixed_path = "/usr/local/bin:/opt/colmap/bin:/usr/bin:/bin"
        if os.name == "nt":
            system_root = os.environ.get("SYSTEMROOT") or os.environ.get("WINDIR", "C:\\Windows")
            fixed_path = f"{system_root}\\System32;{system_root}"
        environment: dict[str, str] = {
            "CUDA_HOME": "/usr/local/cuda",
            "CUDA_DEVICE_ORDER": "PCI_BUS_ID",
            "LD_LIBRARY_PATH": (
                "/usr/local/nvidia/lib:/usr/local/nvidia/lib64:/usr/local/cuda/lib64"
            ),
            "PATH": fixed_path,
            "PYTHONHASHSEED": "0",
            "PYTHONNOUSERSITE": "1",
            "PYTHONUNBUFFERED": "1",
        }
        if runtime_home is not None:
            environment["HOME"] = str(runtime_home)
        for name in ("SYSTEMROOT", "WINDIR"):
            if name in os.environ:
                environment[name] = os.environ[name]
        return environment

    def _terminate(self, process: subprocess.Popen[bytes]) -> None:
        if process.poll() is not None:
            return
        if os.name == "nt":
            taskkill = shutil.which("taskkill")
            if taskkill is not None:
                subprocess.run(  # noqa: S603 - PID belongs to the child just created.
                    (taskkill, "/PID", str(process.pid), "/T", "/F"),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=self._termination_grace_seconds,
                    check=False,
                    shell=False,
                )
            else:
                process.terminate()
        else:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
        try:
            process.wait(timeout=self._termination_grace_seconds)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                process.kill()
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    return
            process.wait(timeout=self._termination_grace_seconds)


def _resolved_executable(name: str) -> Path | None:
    found = shutil.which(name)
    if found is None:
        return None
    path = Path(found).resolve()
    if not path.is_file():
        return None
    return path


def register_runtime(*, probe_timeout_seconds: int = 20) -> RuntimeRegistration:
    """Discover and activate the exact pinned CUDA runtime or fail closed."""

    python = _resolved_executable("python") or _resolved_executable("python3")
    ns_train = _resolved_executable("ns-train")
    ns_export = _resolved_executable("ns-export")
    nvidia_smi = _resolved_executable("nvidia-smi")
    if None in {python, ns_train, ns_export, nvidia_smi}:
        return RuntimeRegistration(status="unavailable", safe_code="APPEARANCE_TOOL_UNAVAILABLE")
    assert python is not None
    assert ns_train is not None
    assert ns_export is not None
    assert nvidia_smi is not None
    with tempfile.TemporaryDirectory(prefix="c8-runtime-probe-") as probe_home:
        safe_environment = SubprocessExecutor._safe_environment(runtime_home=Path(probe_home))
        try:
            completed = subprocess.run(  # noqa: S603 - fixed internal module only.
                (
                    str(python),
                    str(Path(__file__).with_name("runtime_probe.py").resolve(strict=True)),
                ),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=Path(probe_home),
                env=safe_environment,
                timeout=probe_timeout_seconds,
                check=False,
                shell=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return RuntimeRegistration(status="unavailable", safe_code="APPEARANCE_PROBE_FAILED")
    if len(completed.stdout) > 4_096:
        return RuntimeRegistration(status="unavailable", safe_code="APPEARANCE_PROBE_FAILED")
    try:
        raw = cast("dict[str, object]", json.loads(completed.stdout))
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
        return RuntimeRegistration(status="unavailable", safe_code="APPEARANCE_PROBE_FAILED")
    if completed.returncode != 0 or raw.get("available") is not True:
        safe_code = raw.get("safeCode")
        if safe_code not in {
            "APPEARANCE_CUDA_UNAVAILABLE",
            "APPEARANCE_TOOL_UNAVAILABLE",
            "APPEARANCE_TORCH_UNAVAILABLE",
        }:
            safe_code = "APPEARANCE_PROBE_FAILED"
        return RuntimeRegistration(status="unavailable", safe_code=safe_code)
    expected = {
        "cuda": PINNED_CUDA_VERSION,
        "gsplat": PINNED_GSPLAT_VERSION,
        "nerfstudio": PINNED_NERFSTUDIO_VERSION,
        "python": PINNED_PYTHON_VERSION,
        "torch": PINNED_TORCH_VERSION,
    }
    if any(raw.get(key) != value for key, value in expected.items()):
        return RuntimeRegistration(status="unavailable", safe_code="APPEARANCE_VERSION_MISMATCH")
    return RuntimeRegistration(
        status="available",
        safe_code="APPEARANCE_READY",
        runtime=RegisteredRuntime(
            ns_export=ns_export,
            ns_train=ns_train,
            nvidia_smi=nvidia_smi,
            python=python,
            executable_version=(
                f"nerfstudio-{PINNED_NERFSTUDIO_VERSION}+gsplat-{PINNED_GSPLAT_VERSION}"
                f"+torch-{PINNED_TORCH_VERSION}+cuda-{PINNED_CUDA_VERSION}"
            ),
        ),
    )


def fixture_runtime(root: Path) -> RegisteredRuntime:
    """Build a test-only registry without claiming real tool or CUDA evidence."""

    executable = (root / "visibly-synthetic-fixture-executable").resolve()
    return RegisteredRuntime(
        ns_export=executable,
        ns_train=executable,
        nvidia_smi=executable,
        python=Path(sys.executable).resolve(),
        executable_version="visibly-synthetic-fixture-not-runtime-evidence",
    )
