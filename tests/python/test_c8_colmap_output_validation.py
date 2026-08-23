from __future__ import annotations

import importlib.util
import struct
from pathlib import Path
from types import ModuleType

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = (
    REPOSITORY_ROOT
    / "ml/reconstruction/windows-nvidia-v2/validate_colmap_outputs.py"
)


def _load_validator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("c8_colmap_validator", VALIDATOR_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR = _load_validator()


def _binary_header(vertex_count: int) -> bytes:
    return (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {vertex_count}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property uchar red\n"
        "property uchar green\n"
        "property uchar blue\n"
        "end_header\n"
    ).encode("ascii")


def test_binary_ply_validator_reads_every_payload_scalar(tmp_path: Path) -> None:
    path = tmp_path / "points.ply"
    payload = struct.pack("<fffBBB", 1.25, -2.5, 4.0, 12, 34, 56)
    path.write_bytes(_binary_header(1) + payload)

    result = VALIDATOR.inspect_ply(path)

    assert result["payloadValidated"] is True
    assert result["vertexCount"] == 1
    assert result["vertexByteStride"] == len(payload)
    assert result["finiteScalarCount"] == 3
    assert result["coordinateBounds"] == {
        "maximum": [1.25, -2.5, 4.0],
        "minimum": [1.25, -2.5, 4.0],
    }


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        struct.pack("<fffBBB", float("nan"), 0.0, 1.0, 1, 2, 3),
        struct.pack("<fffBBB", 0.0, 0.0, 1.0, 1, 2, 3) + b"trailing",
    ],
)
def test_binary_ply_validator_rejects_header_only_nonfinite_and_trailing_payload(
    tmp_path: Path, payload: bytes
) -> None:
    path = tmp_path / "invalid.ply"
    path.write_bytes(_binary_header(1) + payload)

    with pytest.raises(ValueError):
        VALIDATOR.inspect_ply(path)


def test_ascii_ply_validator_parses_and_bounds_actual_vertices(tmp_path: Path) -> None:
    path = tmp_path / "ascii.ply"
    path.write_text(
        "ply\n"
        "format ascii 1.0\n"
        "element vertex 2\n"
        "property double x\n"
        "property double y\n"
        "property double z\n"
        "property uint8 red\n"
        "end_header\n"
        "1.0 2.0 3.0 255\n"
        "-4.0 5.0 6.0 0\n",
        encoding="ascii",
    )

    result = VALIDATOR.inspect_ply(path)

    assert result["format"] == "ascii"
    assert result["vertexCount"] == 2
    assert result["finiteScalarCount"] == 6
    assert result["coordinateBounds"] == {
        "maximum": [1.0, 5.0, 6.0],
        "minimum": [-4.0, 2.0, 3.0],
    }
