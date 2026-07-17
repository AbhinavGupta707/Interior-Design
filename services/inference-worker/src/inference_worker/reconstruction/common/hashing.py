"""Deterministic hashing helpers for source, tool, config and artifact pins."""

import hashlib
import json
import math
from pathlib import Path
from typing import cast

from .errors import ReconstructionError

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
type JsonObject = dict[str, JsonValue]

SHA256_HEX_LENGTH = 64


def _validated_json(value: object, *, depth: int = 0) -> JsonValue:
    if depth > 32:
        raise ReconstructionError("INVALID_MANIFEST", "manifest nesting is too deep")
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ReconstructionError("NON_FINITE_VALUE", "manifest contains a non-finite float")
        return 0.0 if value == 0.0 else value
    if isinstance(value, list | tuple):
        if len(value) > 100_000:
            raise ReconstructionError("RESOURCE_LIMIT", "manifest array is too large")
        return [_validated_json(item, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        source = cast("dict[object, object]", value)
        if len(source) > 100_000:
            raise ReconstructionError("RESOURCE_LIMIT", "manifest object is too large")
        result: JsonObject = {}
        for key, item in source.items():
            if not isinstance(key, str):
                raise ReconstructionError("INVALID_MANIFEST", "manifest keys must be strings")
            result[key] = _validated_json(item, depth=depth + 1)
        return result
    raise ReconstructionError("INVALID_MANIFEST", "manifest contains an unsupported value")


def canonical_json_bytes(value: object) -> bytes:
    """Encode a finite JSON value with stable key ordering and no whitespace."""

    return json.dumps(
        _validated_json(value),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: object) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def validate_sha256(value: str, *, name: str = "sha256") -> str:
    if len(value) != SHA256_HEX_LENGTH or any(char not in "0123456789abcdef" for char in value):
        raise ReconstructionError("INVALID_MANIFEST", f"{name} is not a lower-case SHA-256")
    return value


def sha256_file(path: Path, *, maximum_bytes: int) -> tuple[str, int]:
    """Hash one regular, non-symlink file while enforcing a byte ceiling."""

    if maximum_bytes <= 0:
        raise ValueError("maximum_bytes must be positive")
    if path.is_symlink() or not path.is_file():
        raise ReconstructionError("UNSAFE_PATH", "artifact is not a regular non-symlink file")
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1_048_576):
            total += len(chunk)
            if total > maximum_bytes:
                raise ReconstructionError("RESOURCE_LIMIT", "artifact exceeds its byte ceiling")
            digest.update(chunk)
    return digest.hexdigest(), total
