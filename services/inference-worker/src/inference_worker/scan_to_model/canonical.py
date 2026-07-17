"""Finite, duplicate-safe and ordering-stable JSON helpers for C9 fitting."""

import hashlib
import json
import math
from collections.abc import Iterable
from typing import cast

from .errors import ScanToModelError
from .types import JsonObject, JsonValue


def _pairs_no_duplicates(pairs: Iterable[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ScanToModelError("INVALID_JSON", "duplicate JSON object key")
        result[key] = value
    return result


def decode_json_bytes(data: bytes) -> JsonValue:
    """Decode exactly one UTF-8 JSON value and reject duplicate/non-finite constants."""

    try:
        text = data.decode("utf-8")
        value = json.loads(
            text,
            object_pairs_hook=_pairs_no_duplicates,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ScanToModelError("INVALID_JSON", "input is not strict UTF-8 JSON") from error
    return validated_json(value)


def validated_json(value: object, *, depth: int = 0) -> JsonValue:
    """Return the supported finite JSON subset with bounded nesting."""

    if depth > 32:
        raise ScanToModelError("RESOURCE_LIMIT", "JSON nesting exceeds the limit")
    if value is None or isinstance(value, str | bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ScanToModelError("NON_FINITE_VALUE", "JSON contains a non-finite number")
        raise ScanToModelError("INVALID_NUMBER", "protocol numbers must be integers")
    if isinstance(value, list | tuple):
        if len(value) > 100_000:
            raise ScanToModelError("RESOURCE_LIMIT", "JSON array exceeds the limit")
        return [validated_json(item, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        source = cast("dict[object, object]", value)
        if len(source) > 100_000:
            raise ScanToModelError("RESOURCE_LIMIT", "JSON object exceeds the limit")
        result: JsonObject = {}
        for key, item in source.items():
            if not isinstance(key, str):
                raise ScanToModelError("INVALID_JSON", "JSON keys must be strings")
            result[key] = validated_json(item, depth=depth + 1)
        return result
    raise ScanToModelError("INVALID_JSON", "unsupported JSON value")


def canonical_json_bytes(value: object) -> bytes:
    """Encode the finite integer JSON subset with stable keys and no whitespace."""

    return json.dumps(
        validated_json(value),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_json(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _point_key(value: JsonValue) -> tuple[int, int, int] | None:
    if not isinstance(value, dict) or set(value) != {"xMm", "yMm", "zMm"}:
        return None
    x = value.get("xMm")
    y = value.get("yMm")
    z = value.get("zMm")
    if any(isinstance(item, bool) or not isinstance(item, int) for item in (x, y, z)):
        return None
    return cast("tuple[int, int, int]", (x, y, z))


def _canonical_cycle(values: list[JsonValue]) -> list[JsonValue]:
    """Canonicalise cyclic polygon start/direction without accepting arbitrary permutations."""

    if len(values) < 3 or any(_point_key(value) is None for value in values):
        return [_canonical_manifest_value(value) for value in values]
    variants: list[list[JsonValue]] = []
    for sequence in (values, list(reversed(values))):
        for index in range(len(sequence)):
            variants.append(sequence[index:] + sequence[:index])
    chosen = min(variants, key=canonical_json_bytes)
    return [_canonical_manifest_value(value) for value in chosen]


def _canonical_manifest_value(value: JsonValue, *, parent_key: str | None = None) -> JsonValue:
    if isinstance(value, dict):
        return {
            key: _canonical_manifest_value(item, parent_key=key)
            for key, item in sorted(value.items())
            if key != "manifestSha256"
        }
    if isinstance(value, list):
        if parent_key in {"boundary", "polygon"}:
            return _canonical_cycle(value)
        items = [_canonical_manifest_value(item) for item in value]
        if parent_key == "sources":
            return sorted(
                items,
                key=lambda item: (
                    canonical_json_bytes(item.get("sourceId"))
                    if isinstance(item, dict)
                    else canonical_json_bytes(item)
                ),
            )
        if parent_key == "observations":
            return sorted(
                items,
                key=lambda item: (
                    (
                        canonical_json_bytes(item.get("observationType")),
                        canonical_json_bytes(item.get("observationId")),
                    )
                    if isinstance(item, dict)
                    else (canonical_json_bytes(item), b"")
                ),
            )
        if parent_key == "occludedEdgeIndices":
            return sorted(items, key=canonical_json_bytes)
        return items
    return value


def source_manifest_sha256(manifest: object) -> str:
    """Hash a manifest after canonical source/observation/polygon ordering."""

    value = validated_json(manifest)
    if not isinstance(value, dict):
        raise ScanToModelError("INVALID_MANIFEST", "source manifest must be an object")
    return sha256_json(_canonical_manifest_value(value))
