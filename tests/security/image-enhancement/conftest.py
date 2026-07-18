"""Independent synthetic security fixtures for the C14 enhancement boundary."""

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


def _artifact(
    role: ArtifactRole, content: bytes, media_type: str, *, width: int = 64, height: int = 64
) -> ExactArtifact:
    return ExactArtifact(
        role=role,
        media_type=media_type,
        sha256=sha256_bytes(content),
        width_px=width,
        height_px=height,
        content=content,
    )


@pytest.fixture
def security_request() -> EnhancementRequest:
    base = encode_rgba8(64, 64, bytes((72, 84, 96, 255)) * 4_096)
    segmentation_pixels = bytearray(64 * 64 * 3)
    for y in range(4, 60):
        for x in range(4, 60):
            offset = (y * 64 + x) * 3
            segmentation_pixels[offset : offset + 3] = b"\x01\x02\x03"
    segmentation = encode_rgb8(64, 64, bytes(segmentation_pixels))
    mask_pixels = bytearray(4_096)
    for y in range(24, 32):
        for x in range(24, 32):
            mask_pixels[y * 64 + x] = 255
    mask = encode_grayscale8(64, 64, bytes(mask_pixels))
    depth = b"\x76\x2f\x31\x01independent-synthetic-depth"
    normal = b"\x76\x2f\x31\x01independent-synthetic-normal"
    return EnhancementRequest(
        base=_artifact(ArtifactRole.GEOMETRY_SAFE_PNG, base, "image/png"),
        depth=_artifact(ArtifactRole.DEPTH_EXR, depth, "image/x-exr"),
        normal=_artifact(ArtifactRole.NORMAL_EXR, normal, "image/x-exr"),
        segmentation=_artifact(ArtifactRole.SEGMENTATION_PNG, segmentation, "image/png"),
        allowed_edit_mask=_artifact(ArtifactRole.ALLOWED_EDIT_MASK_PNG, mask, "image/png"),
        camera_sha256=sha256_bytes(b"independent-synthetic-camera"),
    )
