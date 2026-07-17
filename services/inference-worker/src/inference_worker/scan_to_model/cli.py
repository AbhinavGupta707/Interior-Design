"""Bounded stdin/stdout CLI for the C9 private scan-to-model protocol."""

import signal
import sys
import threading
from types import FrameType

from .canonical import canonical_json_bytes, decode_json_bytes
from .errors import ScanToModelError
from .protocol import execute_protocol

MAXIMUM_STDIN_BYTES = 8_388_608

_cancelled = threading.Event()


def _handle_cancel(_signum: int, _frame: FrameType | None) -> None:
    _cancelled.set()


def _read_stdin() -> bytes:
    data = sys.stdin.buffer.read(MAXIMUM_STDIN_BYTES + 1)
    if len(data) > MAXIMUM_STDIN_BYTES:
        raise ScanToModelError("RESOURCE_LIMIT", "stdin exceeds the private protocol limit")
    return data


def run(data: bytes) -> tuple[int, bytes, str | None]:
    """Execute one CLI request for tests without mutating process streams."""

    if len(data) > MAXIMUM_STDIN_BYTES:
        return 64, b"", "C9_SCAN_TO_MODEL_INPUT_INVALID"
    try:
        value = decode_json_bytes(data)
        result = execute_protocol(value, cancelled=_cancelled.is_set)
    except ScanToModelError:
        return 64, b"", "C9_SCAN_TO_MODEL_INPUT_INVALID"
    except Exception:  # noqa: BLE001 - fail closed at the isolated process boundary
        return 70, b"", "C9_SCAN_TO_MODEL_INTERNAL_FAILURE"
    return 0, canonical_json_bytes(result), None


def main() -> int:
    """Read one bounded JSON object and emit one canonical result object."""

    if len(sys.argv) != 1:
        sys.stderr.write("C9_SCAN_TO_MODEL_ARGUMENTS_INVALID\n")
        return 64
    signal.signal(signal.SIGTERM, _handle_cancel)
    signal.signal(signal.SIGINT, _handle_cancel)
    try:
        data = _read_stdin()
    except ScanToModelError:
        sys.stderr.write("C9_SCAN_TO_MODEL_INPUT_TOO_LARGE\n")
        return 64
    exit_code, output, stderr_code = run(data)
    if output:
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
    if stderr_code is not None:
        sys.stderr.write(f"{stderr_code}\n")
        sys.stderr.flush()
    return exit_code
