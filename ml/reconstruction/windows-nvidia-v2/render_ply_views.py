#!/usr/bin/env python3
"""Render deterministic private point-cloud inspection views without a network viewer."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import struct
from pathlib import Path
from typing import BinaryIO

import numpy as np  # type: ignore[import-not-found]
from PIL import Image, ImageDraw  # type: ignore[import-not-found]

TYPE_FORMATS = {
    "char": "b",
    "int8": "b",
    "uchar": "B",
    "uint8": "B",
    "short": "h",
    "int16": "h",
    "ushort": "H",
    "uint16": "H",
    "int": "i",
    "int32": "i",
    "uint": "I",
    "uint32": "I",
    "float": "f",
    "float32": "f",
    "double": "d",
    "float64": "d",
}
VIEWS = {
    "principal-a": (0.55, -0.32),
    "principal-b": (-0.95, -0.18),
    "elevated": (0.15, -0.78),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def private_path(path: Path, label: str, *, directory: bool = False) -> Path:
    if not path.is_absolute() or not str(path).startswith("/home/") or path.is_symlink():
        raise ValueError(f"{label} must be a real private WSL ext4 path")
    if directory:
        if path.exists() or path.is_symlink():
            raise ValueError("output directory must be new")
        path.mkdir(mode=0o700, parents=True)
    elif not path.is_file():
        raise ValueError(f"{label} must be a regular file")
    return path


def read_header(handle: BinaryIO) -> tuple[str, int, list[tuple[str, str]]]:
    lines: list[str] = []
    size = 0
    while size <= 65536:
        raw = handle.readline()
        if not raw:
            raise ValueError("PLY header is incomplete")
        size += len(raw)
        line = raw.decode("ascii").rstrip("\r\n")
        lines.append(line)
        if line == "end_header":
            break
    if not lines or lines[0] != "ply":
        raise ValueError("PLY signature is invalid")
    format_line = next((line for line in lines if line.startswith("format ")), None)
    vertex_line = next((line for line in lines if line.startswith("element vertex ")), None)
    if format_line is None or vertex_line is None:
        raise ValueError("PLY format or vertex count is absent")
    vertex_index = lines.index(vertex_line)
    properties: list[tuple[str, str]] = []
    for line in lines[vertex_index + 1 :]:
        if line.startswith("element ") or line == "end_header":
            break
        fields = line.split()
        if len(fields) == 3 and fields[0] == "property":
            if fields[1] == "list":
                raise ValueError("list-valued vertex properties are unsupported")
            properties.append((fields[2], fields[1]))
    return format_line.split()[1], int(vertex_line.split()[2]), properties


def load_ply(path: Path, max_points: int) -> tuple[np.ndarray, np.ndarray, int]:
    with path.open("rb") as handle:
        format_name, count, properties = read_header(handle)
        names = [name for name, _ in properties]
        if not {"x", "y", "z"}.issubset(names):
            raise ValueError("PLY vertices require x, y and z")
        if format_name == "binary_little_endian":
            codes = [TYPE_FORMATS.get(kind) for _, kind in properties]
            if any(code is None for code in codes):
                raise ValueError("PLY vertex property type is unsupported")
            record = struct.Struct("<" + "".join(code for code in codes if code is not None))
            payload = handle.read(record.size * count)
            if len(payload) != record.size * count:
                raise ValueError("PLY vertex payload is truncated")
            rows = np.asarray(list(record.iter_unpack(payload)), dtype=np.float64)
        elif format_name == "ascii":
            rows = np.loadtxt(handle, max_rows=count, ndmin=2)
            if len(rows) != count or rows.shape[1] < len(properties):
                raise ValueError("ASCII PLY vertex payload is truncated")
        else:
            raise ValueError("PLY format is unsupported")
    indices = {name: index for index, name in enumerate(names)}
    points = rows[:, [indices["x"], indices["y"], indices["z"]]]
    colour_names = ("red", "green", "blue")
    if all(name in indices for name in colour_names):
        colours = rows[:, [indices[name] for name in colour_names]]
    else:
        colours = np.tile(np.asarray([[210.0, 220.0, 235.0]]), (len(points), 1))
    finite = np.all(np.isfinite(points), axis=1)
    points = points[finite]
    colours = np.clip(colours[finite], 0, 255).astype(np.uint8)
    if not len(points):
        raise ValueError("PLY has no finite vertices")
    if len(points) > max_points:
        stride = math.ceil(len(points) / max_points)
        points = points[::stride][:max_points]
        colours = colours[::stride][:max_points]
    return points, colours, count


def normalise(points: np.ndarray) -> tuple[np.ndarray, list[list[float]]]:
    low = np.quantile(points, 0.01, axis=0)
    high = np.quantile(points, 0.99, axis=0)
    centre = (low + high) / 2.0
    radius = max(float(np.max((high - low) / 2.0)), 1e-9)
    return (points - centre) / radius, [low.astype(float).tolist(), high.astype(float).tolist()]


def render(
    points: np.ndarray,
    colours: np.ndarray,
    *,
    yaw: float,
    pitch: float,
    output: Path,
) -> None:
    width, height = 1600, 1000
    cosine_yaw, sine_yaw = math.cos(yaw), math.sin(yaw)
    cosine_pitch, sine_pitch = math.cos(pitch), math.sin(pitch)
    x = cosine_yaw * points[:, 0] + sine_yaw * points[:, 2]
    z0 = -sine_yaw * points[:, 0] + cosine_yaw * points[:, 2]
    y = cosine_pitch * points[:, 1] - sine_pitch * z0
    z = sine_pitch * points[:, 1] + cosine_pitch * z0
    depth = np.maximum(0.35, 3.2 - z)
    scale = min(width, height) * 0.42
    columns = np.rint(width / 2 + x * scale / depth).astype(np.int64)
    rows = np.rint(height / 2 - y * scale / depth).astype(np.int64)
    inside = (columns >= 0) & (columns < width) & (rows >= 0) & (rows < height)
    order = np.argsort(z[inside], kind="stable")
    columns = columns[inside][order]
    rows = rows[inside][order]
    visible_colours = colours[inside][order]
    image = Image.new("RGB", (width, height), (11, 16, 21))
    draw = ImageDraw.Draw(image)
    for column, row, colour in zip(columns, rows, visible_colours, strict=True):
        value = tuple(int(channel) for channel in colour)
        draw.rectangle((int(column), int(row), int(column) + 1, int(row) + 1), fill=value)
    image.save(output, format="PNG", optimize=False)
    os.chmod(output, 0o600)


def generate(args: argparse.Namespace) -> None:
    source = private_path(Path(args.input), "input")
    output = private_path(Path(args.output), "output", directory=True)
    points, colours, source_count = load_ply(source, args.max_points)
    points, quantile_bounds = normalise(points)
    artifacts: dict[str, str] = {}
    for name, (yaw, pitch) in VIEWS.items():
        image_path = output / f"{name}.png"
        render(points, colours, yaw=yaw, pitch=pitch, output=image_path)
        artifacts[image_path.name] = sha256_file(image_path)
    record = {
        "artifacts": artifacts,
        "dimensionalAccuracy": "NOT RUN",
        "inputSha256": sha256_file(source),
        "quantileBoundsPrivateUnits": quantile_bounds,
        "renderedPointCount": len(points),
        "schemaVersion": "c14-10-private-ply-inspection-v1",
        "sourceVertexCount": source_count,
    }
    record_path = output / "inspection.json"
    descriptor = os.open(record_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(record, handle, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({"output": str(output), "renderedPointCount": len(points)}))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--input", required=True)
    value.add_argument("--output", required=True)
    value.add_argument("--max-points", type=int, default=250_000)
    value.set_defaults(function=generate)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
