#!/usr/bin/env python3
"""Validate COLMAP dense binary maps and PLY output without trusting exit codes."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from array import array
from pathlib import Path
from typing import BinaryIO


def _read_header_token(stream: BinaryIO) -> int:
    token = bytearray()
    while True:
        byte = stream.read(1)
        if not byte:
            raise ValueError("truncated COLMAP dense-map header")
        if byte == b"&":
            break
        token.extend(byte)
        if len(token) > 32:
            raise ValueError("invalid COLMAP dense-map header")
    try:
        value = int(token)
    except ValueError as error:
        raise ValueError("non-integer COLMAP dense-map header") from error
    if value <= 0:
        raise ValueError("non-positive COLMAP dense-map dimension")
    return value


def inspect_dense_map(path: Path) -> dict[str, int | float | str]:
    with path.open("rb") as stream:
        width = _read_header_token(stream)
        height = _read_header_token(stream)
        channels = _read_header_token(stream)
        expected = width * height * channels
        values = array("f")
        try:
            values.fromfile(stream, expected)
        except EOFError as error:
            raise ValueError(f"truncated dense map: {path.name}") from error
        if len(values) != expected or stream.read(1):
            raise ValueError(f"unexpected dense-map payload size: {path.name}")

    if sys.byteorder != "little":
        values.byteswap()
    finite_count = sum(math.isfinite(value) for value in values)
    if finite_count != expected:
        raise ValueError(f"non-finite dense-map values: {path.name}")
    positive_count = sum(value > 0.0 for value in values)
    return {
        "channels": channels,
        "finiteValues": finite_count,
        "height": height,
        "name": path.name,
        "positiveValues": positive_count,
        "sha256": _sha256(path),
        "sizeBytes": path.stat().st_size,
        "width": width,
    }


def inspect_ply(path: Path) -> dict[str, object]:
    """Parse every vertex scalar and reject malformed or unaccounted payload bytes."""

    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024**3:
        raise ValueError("PLY path or size is invalid")
    scalar_types: dict[str, tuple[str, bool, int | None, int | None]] = {
        "char": ("b", False, -(2**7), 2**7 - 1),
        "int8": ("b", False, -(2**7), 2**7 - 1),
        "uchar": ("B", False, 0, 2**8 - 1),
        "uint8": ("B", False, 0, 2**8 - 1),
        "short": ("h", False, -(2**15), 2**15 - 1),
        "int16": ("h", False, -(2**15), 2**15 - 1),
        "ushort": ("H", False, 0, 2**16 - 1),
        "uint16": ("H", False, 0, 2**16 - 1),
        "int": ("i", False, -(2**31), 2**31 - 1),
        "int32": ("i", False, -(2**31), 2**31 - 1),
        "uint": ("I", False, 0, 2**32 - 1),
        "uint32": ("I", False, 0, 2**32 - 1),
        "float": ("f", True, None, None),
        "float32": ("f", True, None, None),
        "double": ("d", True, None, None),
        "float64": ("d", True, None, None),
    }
    with path.open("rb") as stream:
        first_line = stream.readline(65_537)
        if first_line.rstrip(b"\r\n") != b"ply":
            raise ValueError("PLY magic is invalid")
        header_size = len(first_line)
        format_name: str | None = None
        vertex_count: int | None = None
        current_element: str | None = None
        properties: list[tuple[str, str]] = []
        while True:
            line = stream.readline(65_537 - header_size)
            if not line:
                raise ValueError("truncated PLY header")
            header_size += len(line)
            if header_size > 65_536:
                raise ValueError("oversized PLY header")
            try:
                text = line.rstrip(b"\r\n").decode("ascii")
            except UnicodeDecodeError as error:
                raise ValueError("PLY header must be ASCII") from error
            fields = text.split()
            if fields == ["end_header"]:
                break
            if not fields or fields[0] in {"comment", "obj_info"}:
                continue
            if fields[0] == "format":
                if (
                    len(fields) != 3
                    or fields[2] != "1.0"
                    or format_name is not None
                    or fields[1]
                    not in {"ascii", "binary_little_endian", "binary_big_endian"}
                ):
                    raise ValueError("PLY format declaration is invalid")
                format_name = fields[1]
            elif fields[0] == "element":
                if len(fields) != 3 or fields[1] != "vertex" or vertex_count is not None:
                    raise ValueError("PLY must contain only one vertex element")
                try:
                    vertex_count = int(fields[2])
                except ValueError as error:
                    raise ValueError("PLY vertex count is invalid") from error
                if not 0 <= vertex_count <= 50_000_000:
                    raise ValueError("PLY vertex count is outside the bound")
                current_element = "vertex"
            elif fields[0] == "property":
                if (
                    current_element != "vertex"
                    or len(fields) != 3
                    or fields[1] not in scalar_types
                    or not fields[2]
                ):
                    raise ValueError("PLY vertex property is unsupported")
                properties.append((fields[1], fields[2]))
            else:
                raise ValueError("PLY header directive is unsupported")

        if format_name is None or vertex_count is None:
            raise ValueError("PLY format or vertex element is missing")
        names = [name for _type_name, name in properties]
        if (
            len(names) != len(set(names))
            or not {"x", "y", "z"}.issubset(names)
            or len(properties) > 64
        ):
            raise ValueError("PLY vertex properties are invalid")
        coordinate_indices = tuple(names.index(name) for name in ("x", "y", "z"))
        float_indices = tuple(
            index
            for index, (type_name, _name) in enumerate(properties)
            if scalar_types[type_name][1]
        )
        minimum = [math.inf, math.inf, math.inf]
        maximum = [-math.inf, -math.inf, -math.inf]
        finite_scalar_count = 0

        def validate_record(values: tuple[int | float, ...]) -> None:
            nonlocal finite_scalar_count
            for index in float_indices:
                if not math.isfinite(float(values[index])):
                    raise ValueError("PLY contains a non-finite floating-point scalar")
                finite_scalar_count += 1
            for bound_index, value_index in enumerate(coordinate_indices):
                value = float(values[value_index])
                if not math.isfinite(value):
                    raise ValueError("PLY contains a non-finite coordinate")
                minimum[bound_index] = min(minimum[bound_index], value)
                maximum[bound_index] = max(maximum[bound_index], value)

        if format_name == "ascii":
            for _vertex_index in range(vertex_count):
                line = stream.readline(1_048_577)
                if not line or len(line) > 1_048_576:
                    raise ValueError("truncated or oversized ASCII PLY vertex")
                tokens = line.split()
                if len(tokens) != len(properties):
                    raise ValueError("ASCII PLY vertex has the wrong scalar count")
                parsed: list[int | float] = []
                for token, (type_name, _name) in zip(tokens, properties, strict=True):
                    _code, is_float, minimum_value, maximum_value = scalar_types[type_name]
                    try:
                        value: int | float = float(token) if is_float else int(token, 10)
                    except ValueError as error:
                        raise ValueError("ASCII PLY scalar is invalid") from error
                    if (
                        not is_float
                        and (value < minimum_value or value > maximum_value)  # type: ignore[operator]
                    ):
                        raise ValueError("ASCII PLY integer is outside its type range")
                    parsed.append(value)
                validate_record(tuple(parsed))
            if stream.read().strip():
                raise ValueError("ASCII PLY has unaccounted trailing payload")
            byte_stride: int | None = None
        else:
            byte_order = "<" if format_name == "binary_little_endian" else ">"
            record = struct.Struct(
                byte_order
                + "".join(scalar_types[type_name][0] for type_name, _name in properties)
            )
            expected_size = record.size * vertex_count
            payload = stream.read(expected_size + 1)
            if len(payload) != expected_size:
                raise ValueError("binary PLY payload size does not match its header")
            for offset in range(0, expected_size, record.size):
                validate_record(record.unpack_from(payload, offset))
            byte_stride = record.size

    coordinate_bounds: dict[str, list[float]] | None = None
    if vertex_count > 0:
        coordinate_bounds = {"maximum": maximum, "minimum": minimum}
    return {
        "coordinateBounds": coordinate_bounds,
        "finiteScalarCount": finite_scalar_count,
        "format": format_name,
        "payloadValidated": True,
        "sha256": _sha256(path),
        "sizeBytes": path.stat().st_size,
        "vertexByteStride": byte_stride,
        "vertexCount": vertex_count,
    }


def _sha256(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dense-root", required=True, type=Path)
    parser.add_argument("--ply", required=True, type=Path)
    arguments = parser.parse_args()

    stereo_root = arguments.dense_root / "stereo"
    map_groups: dict[str, list[dict[str, int | float | str]]] = {}
    for group in ("depth_maps", "normal_maps"):
        paths = sorted((stereo_root / group).glob("*.bin"))
        if not paths:
            raise ValueError(f"no COLMAP {group}")
        map_groups[group] = [inspect_dense_map(path) for path in paths]

    result = {
        "authority": "proposal-only",
        "depthMapCount": len(map_groups["depth_maps"]),
        "depthPositiveValues": sum(
            int(record["positiveValues"]) for record in map_groups["depth_maps"]
        ),
        "normalMapCount": len(map_groups["normal_maps"]),
        "ply": inspect_ply(arguments.ply),
        "schemaVersion": "c8-colmap-output-validation-v2",
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
