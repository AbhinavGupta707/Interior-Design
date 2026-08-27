#!/usr/bin/env python3
"""Generate a deterministic calibrated RGB-D benchmark fixture, never homeowner evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import zlib
from pathlib import Path

import generate_colmap_fixture as colmap_fixture


def canonical(value: object) -> bytes:
    return json.dumps(
        value, allow_nan=False, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def rendered_frame(camera: colmap_fixture.Camera) -> tuple[bytes, bytes]:
    width = colmap_fixture.WIDTH
    height = colmap_fixture.HEIGHT
    rows = bytearray()
    depth = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            ray_x = (x + 0.5 - colmap_fixture.CX) / colmap_fixture.FOCAL
            ray_y = (y + 0.5 - colmap_fixture.CY) / colmap_fixture.FOCAL
            surface = colmap_fixture._surface(camera, ray_x, ray_y)
            rows.extend(
                colmap_fixture._texture(surface.xyz, surface.material) if surface else (10, 14, 22)
            )
            depth.extend(struct.pack("<f", 0.0 if surface is None else surface.xyz[2]))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    image = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )
    return image, bytes(depth)


def write(path: Path, data: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.output)
    if not root.is_absolute() or root.exists() or root.parent.resolve() != root.parent:
        raise ValueError("output must be a new absolute normalized directory")
    root.mkdir(mode=0o700)
    for name in ("rgb", "depth", "roomplan"):
        (root / name).mkdir(mode=0o700)
    project_id = "14900000-0000-4000-8000-000000000001"
    session_id = "14900000-0000-4000-8000-000000000002"
    room_id = "14900000-0000-4000-8000-000000000003"
    segment_id = "14900000-0000-4000-8000-000000000004"
    asset_ids = [
        f"14900000-0000-4000-8000-{index:012d}"
        for index in range(10, 10 + colmap_fixture.CAMERA_COUNT)
    ]
    sample_ids = [
        f"14900000-0000-4000-8000-{index:012d}"
        for index in range(20, 20 + colmap_fixture.CAMERA_COUNT)
    ]
    artifact_id = "14900000-0000-4000-8000-000000000030"
    files: list[dict[str, object]] = []
    media: list[dict[str, object]] = []
    width, height = colmap_fixture.WIDTH, colmap_fixture.HEIGHT
    depth_frames: list[bytes] = []
    for index, (asset_id, _sample_id) in enumerate(zip(asset_ids, sample_ids, strict=True)):
        data, depth_frame = rendered_frame(colmap_fixture._camera(index + 1))
        depth_frames.append(depth_frame)
        path = root / "rgb" / f"{asset_id}.png"
        write(path, data)
        digest = hashlib.sha256(data).hexdigest()
        media.append(
            {
                "assetId": asset_id,
                "byteSize": len(data),
                "kind": "rgb-keyframe",
                "mimeType": "image/png",
                "sha256": digest,
                "transfer": {
                    "partCount": 1,
                    "reconciledAt": "2026-08-27T10:00:00.000Z",
                    "resumable": True,
                    "state": "complete",
                },
            }
        )
        files.append(
            {
                "byteSize": len(data),
                "contentType": "image/png",
                "kind": "rgb-original",
                "path": path.relative_to(root).as_posix(),
                "sha256": digest,
                "sourceId": asset_id,
            }
        )
    depth = b"".join(depth_frames)
    depth_path = root / "depth" / f"{artifact_id}.bin"
    write(depth_path, depth)
    depth_hash = hashlib.sha256(depth).hexdigest()
    files.append(
        {
            "byteSize": len(depth),
            "contentType": "application/octet-stream",
            "kind": "depth-original",
            "path": depth_path.relative_to(root).as_posix(),
            "sha256": depth_hash,
            "sourceId": artifact_id,
        }
    )
    sectors = [
        "north",
        "north-east",
        "east",
        "south-east",
        "south",
        "south-west",
        "west",
        "north-west",
    ]
    bands = ["lower", "middle", "upper"]
    layers = [
        "structural-evidence",
        "fixed-fittings",
        "movable-furniture",
        "appearance",
        "temporary-clutter",
    ]
    rights = {
        "basis": "public-domain",
        "serviceProcessingConsent": True,
        "trainingUseConsent": "denied",
    }
    envelope = {
        "cameraSamples": [
            {
                "blurScoreMillionths": 100000,
                "cameraIntrinsicsMicropixels": {
                    "cx": round(colmap_fixture.CX * 1_000_000),
                    "cy": round(colmap_fixture.CY * 1_000_000),
                    "fx": round(colmap_fixture.FOCAL * 1_000_000),
                    "fy": round(colmap_fixture.FOCAL * 1_000_000),
                    "imageHeightPixels": height,
                    "imageWidthPixels": width,
                },
                "exposureScoreMillionths": 900000,
                "intrinsicsModel": "pinhole-native-camera-raster",
                "motionScoreMillionths": 100000,
                "orientation": "landscape-right",
                "poseTransform": "camera-to-world",
                "quaternionNanounits": [1000000000, 0, 0, 0],
                "quaternionOrder": "x-y-z-w",
                "roomId": room_id,
                "sampleId": sample_id,
                "segmentId": segment_id,
                "sourceAssetId": asset_id,
                "sourceTimestampMicroseconds": 1000000 * (index + 1),
                "timestampMicroseconds": 1000000 * (index + 1),
                "trackingState": (
                    "normal" if index != colmap_fixture.CAMERA_COUNT - 1 else "limited-features"
                ),
                "translationMicrometres": {
                    "x": round(colmap_fixture._camera(index + 1).center[0] * 1_000_000),
                    "y": round(colmap_fixture._camera(index + 1).center[1] * 1_000_000),
                    "z": 0,
                },
            }
            for index, (asset_id, sample_id) in enumerate(zip(asset_ids, sample_ids, strict=True))
        ],
        "capabilities": {
            "appBuild": "fixture-1",
            "appVersion": "1.0.0",
            "arWorldTracking": True,
            "cameraIntrinsics": True,
            "cameraPoses": True,
            "deviceModelIdentifier": "synthetic-calibrated-rgbd",
            "operatingSystemVersion": "fixture",
            "qualityTier": "guided-rgb-depth",
            "rgbKeyframes": True,
            "rgbVideo": False,
            "roomPlan": False,
            "runtime": "physical-device",
            "sceneDepth": True,
            "schemaVersion": "capture-capabilities-v1",
        },
        "captureSessionId": session_id,
        "coordinateSegments": [
            {
                "coordinateSystem": "arkit-right-handed-y-up",
                "endedAtMicroseconds": 11_000_000,
                "reason": "initial",
                "segmentId": segment_id,
                "startedAtMicroseconds": 0,
                "translationUnit": "micrometres",
                "worldOriginRelationship": "independent-unless-later-registered",
            }
        ],
        "depthSources": [
            {
                "alignment": "arkit-scene-depth-image-plane",
                "artifactId": artifact_id,
                "byteSize": len(depth),
                "format": "float32-metres-little-endian",
                "heightPixels": height,
                "sampleIds": sample_ids,
                "sha256": depth_hash,
                "transfer": {
                    "partCount": 1,
                    "reconciledAt": "2026-08-27T10:00:00.000Z",
                    "resumable": True,
                    "state": "complete",
                },
                "widthPixels": width,
            }
        ],
        "endedAt": "2026-08-27T10:00:12.000Z",
        "generator": {"name": "ios-guided-capture", "version": "fixture-1"},
        "intent": "room-by-room",
        "mediaSources": media,
        "projectId": project_id,
        "quality": {
            "interruptionCount": 0,
            "lowLightSampleCount": 0,
            "missingCoverageCellCount": 1,
            "motionWarningSampleCount": 0,
            "occludedCoverageCellCount": 1,
            "trackingLimitedSampleCount": 1,
            "unusableBlurSampleCount": 0,
        },
        "rights": rights,
        "roomPlanSources": [],
        "rooms": [
            {
                "coordinateSegmentIds": [segment_id],
                "coverage": [
                    {
                        "horizontalSector": sector,
                        "status": "missing"
                        if sector == "north" and band == "upper"
                        else "occluded"
                        if sector == "south" and band == "lower"
                        else "observed",
                        "verticalBand": band,
                    }
                    for sector in sectors
                    for band in bands
                ],
                "label": "Synthetic room",
                "roomId": room_id,
                "semanticDeclarations": [
                    {
                        "layer": layer,
                        "provenance": "user-asserted",
                        "status": "unknown" if layer != "structural-evidence" else "observed",
                    }
                    for layer in layers
                ],
                "sequence": 1,
                "story": 0,
            }
        ],
        "schemaVersion": "capture-envelope-v1",
        "startedAt": "2026-08-27T10:00:00.000Z",
        "transferState": "complete",
    }
    envelope_bytes = canonical(envelope)
    envelope_hash = hashlib.sha256(envelope_bytes).hexdigest()
    write(root / "envelope.json", envelope_bytes)
    manifest = {
        "acceptedAt": None,
        "acceptedByAlias": None,
        "actorAlias": "fixture_actor",
        "captureSessionAlias": "fixture_capture",
        "envelopeAlias": "fixture_envelope",
        "envelopeSha256": envelope_hash,
        "exportedAt": "2026-08-27T10:00:06Z",
        "files": sorted(files, key=lambda item: str(item["path"])),
        "generator": {"name": "generate_capture_benchmark_fixture.py", "version": "1"},
        "inputClass": "benchmark-fixture",
        "projectAlias": "fixture_project",
        "rights": rights,
        "schemaVersion": "capture-benchmark-export-v1",
        "sourceCommit": "0" * 40,
        "tenantAlias": "fixture_tenant",
    }
    write(root / "export-manifest.json", canonical(manifest) + b"\n")
    print(json.dumps({"envelopeSha256": envelope_hash, "output": str(root)}, sort_keys=True))


if __name__ == "__main__":
    main()
