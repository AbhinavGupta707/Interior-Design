"""Bounded, shell-free subprocess execution for allowlisted reconstruction tools."""

import ctypes
import hashlib
import os
import platform
import resource
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path

from .errors import ReconstructionError


class BinaryId(StrEnum):
    COLMAP = "colmap"
    OPEN3D_PYTHON = "open3d-python"


class BinaryEvidence(StrEnum):
    SYSTEM_INSTALLED = "system-installed"
    FIXTURE_EXECUTABLE = "fixture-executable"


@dataclass(frozen=True, slots=True)
class ResolvedBinary:
    identifier: BinaryId
    path: Path = field(repr=False)
    evidence: BinaryEvidence


class BinaryRegistry:
    """Resolve only code-owned binary identifiers, never request paths."""

    def __init__(self, binaries: Mapping[BinaryId, ResolvedBinary]) -> None:
        self._binaries = dict(binaries)

    @classmethod
    def production(cls) -> "BinaryRegistry":
        binaries: dict[BinaryId, ResolvedBinary] = {}
        colmap = shutil.which("colmap")
        if colmap is not None:
            binaries[BinaryId.COLMAP] = ResolvedBinary(
                BinaryId.COLMAP, Path(colmap).resolve(), BinaryEvidence.SYSTEM_INSTALLED
            )
        binaries[BinaryId.OPEN3D_PYTHON] = ResolvedBinary(
            BinaryId.OPEN3D_PYTHON,
            # Preserve the code-owned virtual-environment entry point: resolving
            # its symlink would discard pyvenv.cfg and hide installed Open3D.
            Path(sys.executable).absolute(),
            BinaryEvidence.SYSTEM_INSTALLED,
        )
        return cls(binaries)

    @classmethod
    def fixture(cls, binaries: Mapping[BinaryId, Path]) -> "BinaryRegistry":
        """Create an explicitly labelled fake-executable registry for adapter tests."""

        resolved: dict[BinaryId, ResolvedBinary] = {}
        for identifier, path in binaries.items():
            absolute = path.resolve(strict=True)
            if absolute.is_symlink() or not absolute.is_file() or not os.access(absolute, os.X_OK):
                raise ReconstructionError("UNSAFE_EXECUTABLE", "fixture executable is invalid")
            resolved[identifier] = ResolvedBinary(
                identifier, absolute, BinaryEvidence.FIXTURE_EXECUTABLE
            )
        return cls(resolved)

    def resolve(self, identifier: BinaryId) -> ResolvedBinary:
        binary = self._binaries.get(identifier)
        if binary is None:
            raise ReconstructionError("TOOL_UNAVAILABLE", "allowlisted binary is not installed")
        return binary


@dataclass(frozen=True, slots=True)
class SubprocessLimits:
    timeout_seconds: float
    maximum_output_bytes: int = 1_048_576
    maximum_file_bytes: int = 53_687_091_200
    maximum_workspace_bytes: int = 215_822_106_624
    maximum_memory_bytes: int = 8_589_934_592
    cpu_seconds: int = 86_400
    termination_grace_seconds: float = 1.0

    def __post_init__(self) -> None:
        if not 0 < self.timeout_seconds <= 86_400:
            raise ValueError("timeout_seconds is outside the C8 ceiling")
        if not 1 <= self.maximum_output_bytes <= 16_777_216:
            raise ValueError("maximum_output_bytes is outside the C8 ceiling")
        if (
            self.maximum_file_bytes <= 0
            or self.maximum_workspace_bytes < self.maximum_file_bytes
            or self.maximum_memory_bytes <= 0
            or self.cpu_seconds <= 0
        ):
            raise ValueError("subprocess resource limits must be positive")
        if not 0 <= self.termination_grace_seconds <= 10:
            raise ValueError("termination_grace_seconds is invalid")


@dataclass(frozen=True, slots=True)
class ExecutionOutcome:
    status: str
    return_code: int | None
    elapsed_milliseconds: int
    stdout_sha256: str
    stderr_sha256: str
    stdout: bytes = field(repr=False)
    stderr: bytes = field(repr=False)

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded" and self.return_code == 0


def _sanitized_environment(workspace: Path, extra: Mapping[str, str] | None) -> dict[str, str]:
    environment = {
        "HOME": str(workspace),
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": "/usr/bin:/bin",
        "TMPDIR": str(workspace),
        "TZ": "UTC",
    }
    for key, value in (extra or {}).items():
        if key not in {"CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS"}:
            raise ReconstructionError("UNSAFE_ENVIRONMENT", "environment key is not allowlisted")
        if len(value) > 32 or any(character not in "-0123456789," for character in value):
            raise ReconstructionError("UNSAFE_ENVIRONMENT", "environment value is invalid")
        environment[key] = value
    return environment


def _resource_limiter(limits: SubprocessLimits) -> Callable[[], None] | None:
    # Python explicitly warns that preexec_fn is unsafe in threaded programs.
    # Avoid it on Darwin/Windows workers and enforce equivalent conservative
    # parent-side bounds below. Linux workers retain kernel limits as defence
    # in depth in addition to the parent monitor.
    if platform.system() != "Linux":
        return None

    def set_soft_limit(identifier: int, requested: int) -> None:
        _current_soft, current_hard = resource.getrlimit(identifier)
        target = (
            requested if current_hard == resource.RLIM_INFINITY else min(requested, current_hard)
        )
        resource.setrlimit(identifier, (target, current_hard))

    def apply() -> None:
        set_soft_limit(resource.RLIMIT_CPU, limits.cpu_seconds)
        set_soft_limit(resource.RLIMIT_FSIZE, limits.maximum_file_bytes)
        set_soft_limit(resource.RLIMIT_NOFILE, 256)

    return apply


def _workspace_limits_exceeded(
    workspace: Path,
    *,
    maximum_file_bytes: int,
    maximum_workspace_bytes: int,
    maximum_entries: int = 100_000,
) -> bool:
    """Check per-file and aggregate disk bounds without following symlinks."""

    total = 0
    entries = 0
    pending = [workspace]
    while pending:
        directory = pending.pop()
        try:
            children = os.scandir(directory)
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            continue
        with children:
            for child in children:
                entries += 1
                if entries > maximum_entries:
                    return True
                try:
                    if child.is_symlink():
                        continue
                    if child.is_dir(follow_symlinks=False):
                        pending.append(Path(child.path))
                    elif child.is_file(follow_symlinks=False):
                        size = child.stat(follow_symlinks=False).st_size
                        if size > maximum_file_bytes:
                            return True
                        total += size
                        if total > maximum_workspace_bytes:
                            return True
                except (FileNotFoundError, PermissionError):
                    continue
    return False


class _WindowsMemoryCounters(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("page_fault_count", ctypes.c_ulong),
        ("peak_working_set_size", ctypes.c_size_t),
        ("working_set_size", ctypes.c_size_t),
        ("quota_peak_paged_pool_usage", ctypes.c_size_t),
        ("quota_paged_pool_usage", ctypes.c_size_t),
        ("quota_peak_non_paged_pool_usage", ctypes.c_size_t),
        ("quota_non_paged_pool_usage", ctypes.c_size_t),
        ("pagefile_usage", ctypes.c_size_t),
        ("peak_pagefile_usage", ctypes.c_size_t),
    ]


def _resident_memory_bytes(process_id: int) -> int | None:
    """Read one child RSS for parent-side enforcement without another process."""

    system = platform.system()
    if system == "Linux":
        try:
            status = Path(f"/proc/{process_id}/status").read_text(encoding="ascii")
        except (FileNotFoundError, PermissionError, UnicodeDecodeError):
            return None
        for line in status.splitlines():
            if line.startswith("VmRSS:"):
                fields = line.split()
                return int(fields[1]) * 1_024 if len(fields) >= 2 else None
        return None
    if system == "Darwin":
        try:
            library = ctypes.CDLL("/usr/lib/libproc.dylib")
            function = library.proc_pid_rusage
            function.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
            function.restype = ctypes.c_int
            # rusage_info_v2 is currently 160 bytes. Keep excess capacity so a
            # compatible OS extension cannot overwrite Python-owned memory;
            # resident_size is the seventh uint64 after the 16-byte UUID.
            info = ctypes.create_string_buffer(256)
            if function(process_id, 2, ctypes.byref(info)) != 0:
                return None
            return int.from_bytes(info.raw[64:72], byteorder=sys.byteorder, signed=False)
        except (AttributeError, OSError):
            return None
    if system == "Windows":
        try:
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
            psapi = ctypes.WinDLL("psapi", use_last_error=True)  # type: ignore[attr-defined]
            handle = kernel.OpenProcess(0x0410, False, process_id)
            if not handle:
                return None
            counters = _WindowsMemoryCounters()
            counters.cb = ctypes.sizeof(counters)
            try:
                succeeded = psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb)
                return int(counters.working_set_size) if succeeded else None
            finally:
                kernel.CloseHandle(handle)
        except (AttributeError, OSError):
            return None
    return None


def _stop_process(process: subprocess.Popen[bytes], grace_seconds: float) -> None:
    if process.poll() is not None:
        return
    try:
        if platform.system() == "Windows":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except (PermissionError, ProcessLookupError):
        # The group can disappear between poll and signal on very short jobs;
        # fall back to the exact Popen handle without treating the race as an
        # adapter failure.
        with suppress(ProcessLookupError):
            process.terminate()
    try:
        process.wait(timeout=max(grace_seconds, 0.1))
    except subprocess.TimeoutExpired:
        if platform.system() == "Windows":
            process.kill()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (PermissionError, ProcessLookupError):
                with suppress(ProcessLookupError):
                    process.kill()
        try:
            process.wait(timeout=max(grace_seconds, 0.1))
        except subprocess.TimeoutExpired:
            if process.poll() is None:
                process.kill()
            process.wait()


def run_bounded(
    registry: BinaryRegistry,
    binary_id: BinaryId,
    fixed_arguments: Sequence[str],
    *,
    workspace: Path,
    limits: SubprocessLimits,
    cancelled: Callable[[], bool] | None = None,
    environment: Mapping[str, str] | None = None,
) -> ExecutionOutcome:
    """Execute a code-owned argv in an isolated cwd with bounded output and time."""

    binary = registry.resolve(binary_id)
    if any("\x00" in argument for argument in fixed_arguments):
        raise ReconstructionError("UNSAFE_ARGUMENT", "argv contains a null byte")
    if not workspace.is_dir() or workspace.is_symlink():
        raise ReconstructionError("UNSAFE_PATH", "execution workspace is invalid")
    command = [str(binary.path), *fixed_arguments]
    started = time.monotonic()
    status = "failed"
    with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
        try:
            process = subprocess.Popen(  # noqa: S603 - executable resolved by BinaryRegistry
                command,
                cwd=workspace,
                env=_sanitized_environment(workspace, environment),
                stdin=subprocess.DEVNULL,
                stdout=stdout_file,
                stderr=stderr_file,
                shell=False,
                start_new_session=True,
                preexec_fn=_resource_limiter(limits),
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise ReconstructionError(
                "TOOL_UNAVAILABLE", "allowlisted tool could not start"
            ) from error

        while process.poll() is None:
            elapsed = time.monotonic() - started
            output_size = (
                os.fstat(stdout_file.fileno()).st_size + os.fstat(stderr_file.fileno()).st_size
            )
            if output_size > limits.maximum_output_bytes:
                status = "output-limit"
                _stop_process(process, limits.termination_grace_seconds)
                break
            resident_memory = _resident_memory_bytes(process.pid)
            if resident_memory is not None and resident_memory > limits.maximum_memory_bytes:
                status = "memory-limit"
                _stop_process(process, limits.termination_grace_seconds)
                break
            if _workspace_limits_exceeded(
                workspace,
                maximum_file_bytes=limits.maximum_file_bytes,
                maximum_workspace_bytes=limits.maximum_workspace_bytes,
            ):
                status = "file-limit"
                _stop_process(process, limits.termination_grace_seconds)
                break
            if cancelled is not None and cancelled():
                status = "cancelled"
                _stop_process(process, limits.termination_grace_seconds)
                break
            # Wall time is a conservative upper bound for per-process CPU time
            # on platforms where pre-exec kernel limits are intentionally off.
            if elapsed >= min(limits.timeout_seconds, float(limits.cpu_seconds)):
                status = "timed-out"
                _stop_process(process, limits.termination_grace_seconds)
                break
            time.sleep(0.01)
        else:
            status = "succeeded" if process.returncode == 0 else "failed"

        if process.poll() is None:
            _stop_process(process, limits.termination_grace_seconds)
        return_code = process.returncode
        stdout_file.seek(0)
        stderr_file.seek(0)
        stdout = stdout_file.read(limits.maximum_output_bytes + 1)
        stderr = stderr_file.read(limits.maximum_output_bytes + 1)
        if len(stdout) + len(stderr) > limits.maximum_output_bytes and status == "succeeded":
            status = "output-limit"
        if status == "succeeded" and _workspace_limits_exceeded(
            workspace,
            maximum_file_bytes=limits.maximum_file_bytes,
            maximum_workspace_bytes=limits.maximum_workspace_bytes,
        ):
            status = "file-limit"
        elapsed_milliseconds = max(0, int((time.monotonic() - started) * 1_000))
        return ExecutionOutcome(
            status=status,
            return_code=return_code,
            elapsed_milliseconds=elapsed_milliseconds,
            stdout_sha256=hashlib.sha256(stdout).hexdigest(),
            stderr_sha256=hashlib.sha256(stderr).hexdigest(),
            stdout=stdout,
            stderr=stderr,
        )
