"""Strict PNG parsing and resource-bound tests."""

import struct
import zlib

import pytest
from inference_worker.image_enhancement import EnhancementError, EnhancementSafeCode
from inference_worker.image_enhancement.png import PNG_SIGNATURE, decode_png, encode_rgba8

from .conftest import HEIGHT, WIDTH


def _replace_ihdr(content: bytes, header: bytes) -> bytes:
    chunk_type = b"IHDR"
    crc = zlib.crc32(header, zlib.crc32(chunk_type)) & 0xFFFFFFFF
    return (
        content[:8]
        + struct.pack(">I", 13)
        + chunk_type
        + header
        + struct.pack(">I", crc)
        + content[33:]
    )


def test_png_rejects_truncation_crc_corruption_and_trailing_data() -> None:
    valid = encode_rgba8(WIDTH, HEIGHT, bytes((1, 2, 3, 255)) * (WIDTH * HEIGHT))
    hostile = (valid[:20], valid[:40] + bytes((valid[40] ^ 1,)) + valid[41:], valid + b"trailing")
    for content in hostile:
        with pytest.raises(EnhancementError, match=EnhancementSafeCode.PNG_INVALID.value):
            decode_png(content, allowed_colour_types=frozenset({6}))


def test_png_rejects_oversized_dimensions_and_unsupported_depth() -> None:
    valid = encode_rgba8(WIDTH, HEIGHT, bytes((1, 2, 3, 255)) * (WIDTH * HEIGHT))
    oversized_header = struct.pack(">IIBBBBB", 4_097, 64, 8, 6, 0, 0, 0)
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.PNG_RESOURCE_LIMIT.value):
        decode_png(_replace_ihdr(valid, oversized_header), allowed_colour_types=frozenset({6}))

    deep_header = struct.pack(">IIBBBBB", 64, 64, 16, 6, 0, 0, 0)
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.PNG_INVALID.value):
        decode_png(_replace_ihdr(valid, deep_header), allowed_colour_types=frozenset({6}))


def test_png_rejects_type_confused_colour_contract() -> None:
    valid = encode_rgba8(WIDTH, HEIGHT, bytes((1, 2, 3, 255)) * (WIDTH * HEIGHT))
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.PNG_INVALID.value):
        decode_png(valid, allowed_colour_types=frozenset({0}))
    with pytest.raises(ValueError, match="supported C14 subset"):
        decode_png(valid, allowed_colour_types=frozenset({3}))


def test_png_signature_is_exact() -> None:
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.PNG_INVALID.value):
        decode_png(PNG_SIGNATURE[:-1], allowed_colour_types=frozenset({6}))
