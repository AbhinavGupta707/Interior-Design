"""Small strict PNG codec for deterministic C14 guard evaluation.

Only non-interlaced 8-bit grayscale, RGB, grayscale-alpha, and RGBA images are
accepted. That deliberately narrow lossless subset is sufficient for C14 safe
renders, segmentation, and binary edit masks and avoids image-library attack
surface or silent colour/depth conversion.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

from .contracts import MAXIMUM_DIMENSION_PIXELS, MAXIMUM_PIXELS, MAXIMUM_PNG_BYTES
from .errors import EnhancementError, EnhancementSafeCode

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_CHANNELS_BY_COLOUR_TYPE = {0: 1, 2: 3, 4: 2, 6: 4}
_MAXIMUM_CHUNKS = 1_024


@dataclass(frozen=True, slots=True)
class DecodedPng:
    width_px: int
    height_px: int
    colour_type: int
    bit_depth: int
    rgba8: bytes = field(repr=False)

    def pixel(self, x: int, y: int) -> tuple[int, int, int, int]:
        offset = (y * self.width_px + x) * 4
        red, green, blue, alpha = self.rgba8[offset : offset + 4]
        return red, green, blue, alpha


def _invalid(detail: str) -> EnhancementError:
    return EnhancementError(EnhancementSafeCode.PNG_INVALID, detail)


def _paeth(left: int, above: int, upper_left: int) -> int:
    prediction = left + above - upper_left
    left_distance = abs(prediction - left)
    above_distance = abs(prediction - above)
    upper_left_distance = abs(prediction - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def _unfilter(raw: bytes, *, width: int, height: int, channels: int) -> bytes:
    row_bytes = width * channels
    expected = (row_bytes + 1) * height
    if len(raw) != expected:
        raise _invalid("decompressed length mismatch")
    output = bytearray(row_bytes * height)
    previous = bytearray(row_bytes)
    source_offset = 0
    for row_number in range(height):
        filter_type = raw[source_offset]
        source_offset += 1
        if filter_type > 4:
            raise _invalid("unknown PNG filter")
        encoded = raw[source_offset : source_offset + row_bytes]
        source_offset += row_bytes
        current = bytearray(row_bytes)
        for index, value in enumerate(encoded):
            left = current[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                decoded = value
            elif filter_type == 1:
                decoded = value + left
            elif filter_type == 2:
                decoded = value + above
            elif filter_type == 3:
                decoded = value + ((left + above) // 2)
            else:
                decoded = value + _paeth(left, above, upper_left)
            current[index] = decoded & 0xFF
        start = row_number * row_bytes
        output[start : start + row_bytes] = current
        previous = current
    return bytes(output)


def _to_rgba(decoded: bytes, *, colour_type: int) -> bytes:
    result = bytearray((len(decoded) // _CHANNELS_BY_COLOUR_TYPE[colour_type]) * 4)
    source = 0
    target = 0
    while source < len(decoded):
        if colour_type == 0:
            grey = decoded[source]
            red = green = blue = grey
            alpha = 255
            source += 1
        elif colour_type == 2:
            red, green, blue = decoded[source : source + 3]
            alpha = 255
            source += 3
        elif colour_type == 4:
            grey, alpha = decoded[source : source + 2]
            red = green = blue = grey
            source += 2
        else:
            red, green, blue, alpha = decoded[source : source + 4]
            source += 4
        result[target : target + 4] = bytes((red, green, blue, alpha))
        target += 4
    return bytes(result)


def decode_png(content: bytes, *, allowed_colour_types: frozenset[int]) -> DecodedPng:
    """Decode one bounded PNG while checking structure, CRCs, and expansion size."""

    if type(content) is not bytes or not content.startswith(PNG_SIGNATURE):
        raise _invalid("missing PNG signature")
    if not 0 < len(content) <= MAXIMUM_PNG_BYTES:
        raise EnhancementError(EnhancementSafeCode.PNG_RESOURCE_LIMIT, "encoded PNG too large")
    if not allowed_colour_types or not allowed_colour_types <= _CHANNELS_BY_COLOUR_TYPE.keys():
        raise ValueError("allowed_colour_types must use the supported C14 subset")

    offset = len(PNG_SIGNATURE)
    width = height = colour_type = bit_depth = -1
    idat = bytearray()
    seen_ihdr = False
    seen_idat = False
    closed_idat = False
    seen_iend = False
    chunk_count = 0
    while offset < len(content):
        chunk_count += 1
        if chunk_count > _MAXIMUM_CHUNKS or offset + 12 > len(content):
            raise _invalid("invalid PNG chunk count or framing")
        length = struct.unpack_from(">I", content, offset)[0]
        chunk_type = content[offset + 4 : offset + 8]
        data_start = offset + 8
        data_end = data_start + length
        crc_end = data_end + 4
        if data_end < data_start or crc_end > len(content):
            raise _invalid("truncated PNG chunk")
        chunk_data = content[data_start:data_end]
        expected_crc = struct.unpack_from(">I", content, data_end)[0]
        actual_crc = zlib.crc32(chunk_data, zlib.crc32(chunk_type)) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            raise _invalid("PNG chunk CRC mismatch")
        offset = crc_end
        if (
            len(chunk_type) != 4
            or any(not (65 <= value <= 90 or 97 <= value <= 122) for value in chunk_type)
            or chunk_type[2] & 0x20 != 0
        ):
            raise _invalid("invalid PNG chunk type")

        if chunk_type == b"IHDR":
            if seen_ihdr or chunk_count != 1 or length != 13:
                raise _invalid("invalid IHDR")
            width, height, bit_depth, colour_type, compression, filtering, interlace = (
                struct.unpack(">IIBBBBB", chunk_data)
            )
            if (
                not 1 <= width <= MAXIMUM_DIMENSION_PIXELS
                or not 1 <= height <= MAXIMUM_DIMENSION_PIXELS
                or width * height > MAXIMUM_PIXELS
            ):
                raise EnhancementError(
                    EnhancementSafeCode.PNG_RESOURCE_LIMIT, "PNG pixel budget exceeded"
                )
            if bit_depth != 8 or colour_type not in allowed_colour_types:
                raise _invalid("unsupported PNG depth or colour type")
            if compression != 0 or filtering != 0 or interlace != 0:
                raise _invalid("unsupported PNG encoding mode")
            seen_ihdr = True
        elif chunk_type == b"IDAT":
            if not seen_ihdr or closed_idat or seen_iend:
                raise _invalid("misordered IDAT")
            seen_idat = True
            if len(idat) + length > MAXIMUM_PNG_BYTES:
                raise EnhancementError(
                    EnhancementSafeCode.PNG_RESOURCE_LIMIT, "compressed PNG data too large"
                )
            idat.extend(chunk_data)
        elif chunk_type == b"IEND":
            if not seen_idat or seen_iend or length != 0:
                raise _invalid("invalid IEND")
            seen_iend = True
            if offset != len(content):
                raise _invalid("trailing bytes after IEND")
            break
        else:
            if seen_idat:
                closed_idat = True
            if not seen_ihdr or seen_iend:
                raise _invalid("misordered PNG chunk")
            # The first letter's reserved lower-case bit marks an ancillary
            # chunk. Unknown critical chunks cannot be interpreted safely.
            if chunk_type == b"tRNS" or chunk_type[0] & 0x20 == 0:
                raise _invalid("unknown critical PNG chunk")

    if not (seen_ihdr and seen_idat and seen_iend):
        raise _invalid("incomplete PNG")
    channels = _CHANNELS_BY_COLOUR_TYPE[colour_type]
    expected_raw = (width * channels + 1) * height
    decompressor = zlib.decompressobj()
    try:
        raw = decompressor.decompress(bytes(idat), expected_raw + 1)
        if len(raw) > expected_raw or decompressor.unconsumed_tail:
            raise EnhancementError(
                EnhancementSafeCode.PNG_RESOURCE_LIMIT, "PNG expansion exceeds declared dimensions"
            )
    except zlib.error as error:
        raise _invalid("invalid PNG deflate stream") from error
    if (
        not decompressor.eof
        or decompressor.unused_data
        or decompressor.unconsumed_tail
        or len(raw) != expected_raw
    ):
        raise _invalid("PNG deflate stream does not match image")
    pixels = _unfilter(raw, width=width, height=height, channels=channels)
    return DecodedPng(
        width_px=width,
        height_px=height,
        colour_type=colour_type,
        bit_depth=bit_depth,
        rgba8=_to_rgba(pixels, colour_type=colour_type),
    )


def _chunk(chunk_type: bytes, content: bytes) -> bytes:
    crc = zlib.crc32(content, zlib.crc32(chunk_type)) & 0xFFFFFFFF
    return struct.pack(">I", len(content)) + chunk_type + content + struct.pack(">I", crc)


def _validate_encode_dimensions(width_px: int, height_px: int, content_length: int) -> None:
    if (
        type(width_px) is not int
        or type(height_px) is not int
        or not 1 <= width_px <= MAXIMUM_DIMENSION_PIXELS
        or not 1 <= height_px <= MAXIMUM_DIMENSION_PIXELS
        or width_px * height_px > MAXIMUM_PIXELS
        or content_length <= 0
    ):
        raise ValueError("invalid PNG encode dimensions")


def _encode(width_px: int, height_px: int, pixels: bytes, *, colour_type: int) -> bytes:
    channels = _CHANNELS_BY_COLOUR_TYPE[colour_type]
    _validate_encode_dimensions(width_px, height_px, len(pixels))
    if type(pixels) is not bytes or len(pixels) != width_px * height_px * channels:
        raise ValueError("pixel byte length does not match dimensions")
    row_bytes = width_px * channels
    scanlines = b"".join(
        b"\x00" + pixels[row * row_bytes : (row + 1) * row_bytes] for row in range(height_px)
    )
    header = struct.pack(">IIBBBBB", width_px, height_px, 8, colour_type, 0, 0, 0)
    encoded = (
        PNG_SIGNATURE
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(scanlines, level=9))
        + _chunk(b"IEND", b"")
    )
    if len(encoded) > MAXIMUM_PNG_BYTES:
        raise ValueError("encoded PNG exceeds C14 byte limit")
    return encoded


def encode_rgba8(width_px: int, height_px: int, rgba8: bytes) -> bytes:
    """Encode deterministic filter-zero RGBA8 fixture/candidate bytes."""

    return _encode(width_px, height_px, rgba8, colour_type=6)


def encode_rgb8(width_px: int, height_px: int, rgb8: bytes) -> bytes:
    """Encode deterministic filter-zero RGB8 segmentation bytes."""

    return _encode(width_px, height_px, rgb8, colour_type=2)


def encode_grayscale8(width_px: int, height_px: int, grey8: bytes) -> bytes:
    """Encode deterministic filter-zero grayscale edit-mask bytes."""

    return _encode(width_px, height_px, grey8, colour_type=0)
