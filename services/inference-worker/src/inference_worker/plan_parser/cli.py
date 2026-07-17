"""Stdin/stdout CLI for the isolated C6 parser process."""

import signal
import sys
import threading
from types import FrameType

from .canonical import JsonDataError, canonical_json_bytes, decode_json_bytes
from .engine import WorkGuard, make_abstention, parse_plan
from .schema import RequestSchemaError, parse_request
from .types import JsonObject, JsonValue, ParserRequest

MAXIMUM_STDIN_BYTES = 32 * 1_024 * 1_024

_cancelled = threading.Event()


def _handle_cancel(_signum: int, _frame: FrameType | None) -> None:
    _cancelled.set()


def _safe_stderr(code: str) -> None:
    sys.stderr.write(f"{code}\n")
    sys.stderr.flush()


def _read_stdin() -> bytes:
    data = sys.stdin.buffer.read(MAXIMUM_STDIN_BYTES + 1)
    if len(data) > MAXIMUM_STDIN_BYTES:
        raise JsonDataError("input exceeds the CLI limit")
    return data


def _request_from_envelope(value: JsonValue) -> tuple[ParserRequest, JsonValue]:
    if not isinstance(value, dict) or "request" not in value:
        raise RequestSchemaError("missing request envelope")
    request = parse_request(value["request"])
    if set(value) != {"normalizedInput", "request"}:
        return request, None
    return request, value["normalizedInput"]


def _bounded_result(request: ParserRequest, result: JsonObject) -> bytes:
    encoded = canonical_json_bytes(result)
    if len(encoded) <= request.maximum_output_bytes:
        return encoded
    fallback = make_abstention(
        request,
        "resource-limit",
        "The parser result exceeds the bounded output limit.",
        normalized_sha256=request.normalized_input_sha256,
    )
    encoded_fallback = canonical_json_bytes(fallback)
    if len(encoded_fallback) > request.maximum_output_bytes:
        raise RuntimeError("bounded abstention exceeds the frozen output limit")
    return encoded_fallback


def run(data: bytes) -> tuple[int, bytes, str | None]:
    """Run one request for unit tests and the process entry point."""

    try:
        envelope = decode_json_bytes(data)
        request, normalized_input = _request_from_envelope(envelope)
    except (JsonDataError, RequestSchemaError):
        return 64, b"", "C6_PARSER_INPUT_INVALID"

    try:
        if normalized_input is None:
            result = make_abstention(
                request,
                "invalid-parser-output",
                "The parser envelope contains missing or unknown fields.",
                normalized_sha256=request.normalized_input_sha256,
            )
        else:
            result = parse_plan(
                request,
                normalized_input,
                guard=WorkGuard.for_timeout(
                    request.timeout_milliseconds,
                    cancelled=_cancelled.is_set,
                ),
            )
        return 0, _bounded_result(request, result), None
    except Exception:  # noqa: BLE001 - fail closed at the subprocess trust boundary
        fallback = make_abstention(
            request,
            "parser-unavailable",
            "The isolated parser failed before publication.",
            normalized_sha256=request.normalized_input_sha256,
        )
        return 0, _bounded_result(request, fallback), "C6_PARSER_INTERNAL_FAILURE"


def main() -> int:
    """Read one bounded envelope and write only one strict result object."""

    if len(sys.argv) != 1:
        _safe_stderr("C6_PARSER_ARGUMENTS_INVALID")
        return 64
    signal.signal(signal.SIGTERM, _handle_cancel)
    signal.signal(signal.SIGINT, _handle_cancel)
    try:
        data = _read_stdin()
    except JsonDataError:
        _safe_stderr("C6_PARSER_INPUT_TOO_LARGE")
        return 64
    exit_code, output, stderr_code = run(data)
    if output:
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
    if stderr_code is not None:
        _safe_stderr(stderr_code)
    return exit_code
