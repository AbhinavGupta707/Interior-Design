#!/usr/bin/env python3
"""Validate COLMAP dense binary maps and PLY output without trusting exit codes."""

from __future__ import annotations

import argparse
import json
import math
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


def inspect_ply(path: Path) -> dict[str, int | str]:
    with path.open("rb") as stream:
        header = bytearray()
        while not header.endswith(b"end_header\n"):
            byte = stream.read(1)
            if not byte:
                raise ValueError("truncated PLY header")
            header.extend(byte)
            if len(header) > 65536:
                raise ValueError("oversized PLY header")
    vertex_lines = [
        line for line in header.decode("ascii").splitlines() if line.startswith("element vertex ")
    ]
    if len(vertex_lines) != 1:
        raise ValueError("PLY must declare exactly one vertex count")
    vertex_count = int(vertex_lines[0].split()[2])
    return {
        "sha256": _sha256(path),
        "sizeBytes": path.stat().st_size,
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
