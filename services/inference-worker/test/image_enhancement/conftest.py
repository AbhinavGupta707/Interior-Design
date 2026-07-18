"""Visibly synthetic, deterministic C14 image fixtures."""

from collections.abc import Iterable

import pytest
from inference_worker.image_enhancement import (
    ArtifactRole,
    EnhancementRequest,
    ExactArtifact,
    sha256_bytes,
)
from inference_worker.image_enhancement.png import (
    encode_grayscale8,
    encode_rgb8,
    encode_rgba8,
)

WIDTH = 64
HEIGHT = 64


def _artifact(
    role: ArtifactRole, content: bytes, *, media_type: str, width: int = WIDTH, height: int = HEIGHT
) -> ExactArtifact:
    return ExactArtifact(
        role=role,
        media_type=media_type,
        sha256=sha256_bytes(content),
        width_px=width,
        height_px=height,
        content=content,
    )


def make_request(
    *,
    editable_pixels: Iterable[tuple[int, int]] | None = None,
    base_rgba: bytes | None = None,
) -> EnhancementRequest:
    base = base_rgba or bytes((96, 112, 128, 255)) * (WIDTH * HEIGHT)
    segmentation = bytearray(WIDTH * HEIGHT * 3)
    for y in range(8, 56):
        for x in range(8, 56):
            offset = (y * WIDTH + x) * 3
            segmentation[offset : offset + 3] = b"\x01\x02\x03"
    editable = set(editable_pixels or ((x, y) for y in range(20, 28) for x in range(20, 28)))
    mask = bytearray(WIDTH * HEIGHT)
    for x, y in editable:
        mask[y * WIDTH + x] = 255
    base_png = encode_rgba8(WIDTH, HEIGHT, base)
    segmentation_png = encode_rgb8(WIDTH, HEIGHT, bytes(segmentation))
    mask_png = encode_grayscale8(WIDTH, HEIGHT, bytes(mask))
    depth = b"\x76\x2f\x31\x01synthetic-depth-exr-fixture"
    normal = b"\x76\x2f\x31\x01synthetic-normal-exr-fixture"
    return EnhancementRequest(
        base=_artifact(ArtifactRole.GEOMETRY_SAFE_PNG, base_png, media_type="image/png"),
        depth=_artifact(ArtifactRole.DEPTH_EXR, depth, media_type="image/x-exr"),
        normal=_artifact(ArtifactRole.NORMAL_EXR, normal, media_type="image/x-exr"),
        segmentation=_artifact(
            ArtifactRole.SEGMENTATION_PNG, segmentation_png, media_type="image/png"
        ),
        allowed_edit_mask=_artifact(
            ArtifactRole.ALLOWED_EDIT_MASK_PNG, mask_png, media_type="image/png"
        ),
        camera_sha256=sha256_bytes(b"synthetic-canonical-camera-v1"),
    )


@pytest.fixture
def synthetic_request() -> EnhancementRequest:
    return make_request()
