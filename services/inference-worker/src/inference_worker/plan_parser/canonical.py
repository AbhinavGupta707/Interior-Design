"""Canonical JSON and stable digest helpers used across the parser boundary."""

import hashlib
import json
from typing import cast

from .types import JsonObject, JsonValue


class JsonDataError(ValueError):
    """Raised when input is not bounded JSON data."""


def as_json_value(value: object, *, depth: int = 0) -> JsonValue:
    """Copy untrusted decoded JSON into the recursive, finite JSON type."""

    if depth > 32:
        raise JsonDataError("JSON nesting exceeds the parser limit")
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        raise JsonDataError("floating point values are not accepted")
    if isinstance(value, list):
        source = cast("list[object]", value)
        if len(source) > 100_000:
            raise JsonDataError("JSON array exceeds the parser limit")
        return [as_json_value(item, depth=depth + 1) for item in source]
    if isinstance(value, dict):
        source_object = cast("dict[object, object]", value)
        if len(source_object) > 100_000:
            raise JsonDataError("JSON object exceeds the parser limit")
        result: JsonObject = {}
        for key, item in source_object.items():
            if not isinstance(key, str):
                raise JsonDataError("JSON object keys must be strings")
            result[key] = as_json_value(item, depth=depth + 1)
        return result
    raise JsonDataError("unsupported JSON value")


def decode_json_bytes(data: bytes) -> JsonValue:
    """Decode exactly one UTF-8 JSON value without exposing parser details."""

    try:
        decoded: object = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise JsonDataError("invalid JSON") from error
    return as_json_value(decoded)


def canonical_json_bytes(value: JsonValue) -> bytes:
    """Encode the lane-local integer-only JSON subset deterministically."""

    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_json(value: JsonValue) -> str:
    """Return the SHA-256 of canonical lane-local JSON."""

    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()
