"""Private JSON protocol composing prepared RGB frames with the C8 COLMAP adapter.

This module is invoked only by the trusted spatial worker. Public API payloads never
reach it and the path-bearing request/result files never leave the private workspace.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from .colmap import ColmapAdapter, StagedImage
from .colmap.components import registered_image_key
from .common import AlignmentAnchor, BinaryRegistry, Vec3
from .common.hashing import (
    JsonObject,
    JsonValue,
    canonical_json_bytes,
    sha256_file,
    sha256_json,
)
from .common.manifest import ArtifactDescriptor, ArtifactKind, GeometryProposalManifest
from .nerfstudio import TrustedStagedFrames
from .nerfstudio.contracts import JsonObject as AppearanceJsonObject
from .registry import discover_reconstruction_adapters

MAXIMUM_PROTOCOL_BYTES = 16_777_216


@dataclass(frozen=True, slots=True)
class PublishedArtifact:
    descriptor: ArtifactDescriptor
    private_path: Path


class StagingArtifactPublisher:
    """Copy adapter outputs into an attempt-owned staging directory.

    The caller uploads these content-addressed files before the durable publication
    fence. Paths are returned only in the private protocol envelope.
    """

    def __init__(self, root: Path) -> None:
        self._root = root
        self._root.mkdir(mode=0o700, parents=True)
        self._appearance_records: dict[str, JsonObject] = {}
        self._published: dict[str, PublishedArtifact] = {}

    def publish(
        self,
        local_path: Path,
        *,
        kind: ArtifactKind,
        media_type: str,
        source_manifest_sha256: str,
        tool_manifest_sha256: str,
    ) -> ArtifactDescriptor:
        content_sha256, byte_size = sha256_file(local_path, maximum_bytes=53_687_091_200)
        artifact_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"c8:{kind}:{content_sha256}:{source_manifest_sha256}:{tool_manifest_sha256}",
            )
        )
        destination = self._root / f"{artifact_id}.artifact"
        if not destination.exists():
            with local_path.open("rb") as source, destination.open("xb") as target:
                shutil.copyfileobj(source, target, length=1_048_576)
            destination.chmod(0o600)
        copied_sha256, copied_size = sha256_file(destination, maximum_bytes=53_687_091_200)
        if copied_sha256 != content_sha256 or copied_size != byte_size:
            raise ValueError("ARTIFACT_STAGING_MISMATCH")
        descriptor = ArtifactDescriptor(
            artifact_id=artifact_id,
            kind=kind,
            media_type=media_type,
            byte_size=byte_size,
            content_sha256=content_sha256,
            source_manifest_sha256=source_manifest_sha256,
            tool_manifest_sha256=tool_manifest_sha256,
        )
        self._published[artifact_id] = PublishedArtifact(descriptor, destination)
        return descriptor

    def private_records(self) -> list[JsonValue]:
        geometry: list[JsonValue] = [
            {"artifact": item.descriptor.to_json(), "privatePath": str(item.private_path)}
            for item in sorted(
                self._published.values(), key=lambda value: value.descriptor.artifact_id
            )
        ]
        appearance: list[JsonValue] = [
            self._appearance_records[key] for key in sorted(self._appearance_records)
        ]
        return geometry + appearance

    def private_path(self, artifact_id: str) -> Path:
        record = self._published.get(artifact_id)
        if record is None:
            raise ValueError("ARTIFACT_STAGING_MISSING")
        return record.private_path

    def add_appearance(self, artifact_file: Path, public_result: AppearanceJsonObject) -> None:
        artifacts = public_result.get("artifacts")
        if not isinstance(artifacts, list) or len(artifacts) != 1:
            raise ValueError("APPEARANCE_RESULT_INVALID")
        artifact = artifacts[0]
        if not isinstance(artifact, dict):
            raise ValueError("APPEARANCE_RESULT_INVALID")
        artifact_id = artifact.get("artifactId")
        content_sha256 = artifact.get("contentSha256")
        byte_size = artifact.get("byteSize")
        if (
            not isinstance(artifact_id, str)
            or not isinstance(content_sha256, str)
            or not isinstance(byte_size, int)
        ):
            raise ValueError("APPEARANCE_RESULT_INVALID")
        copied_sha256, copied_size = sha256_file(artifact_file, maximum_bytes=53_687_091_200)
        if copied_sha256 != content_sha256 or copied_size != byte_size:
            raise ValueError("APPEARANCE_RESULT_INVALID")
        destination = self._root / f"{artifact_id}.artifact"
        with artifact_file.open("rb") as source, destination.open("xb") as target:
            shutil.copyfileobj(source, target, length=1_048_576)
        destination.chmod(0o600)
        self._appearance_records[artifact_id] = {
            "artifact": cast("JsonObject", cast("object", artifact)),
            "privatePath": str(destination),
        }


@dataclass(frozen=True, slots=True)
class AppearanceArtifactPublisher:
    staging: StagingArtifactPublisher

    def publish(self, artifact_file: Path, public_result: AppearanceJsonObject) -> None:
        self.staging.add_appearance(artifact_file, public_result)


def _object(value: object, keys: frozenset[str], code: str) -> dict[str, object]:
    if not isinstance(value, dict) or frozenset(value) != keys:
        raise ValueError(code)
    return cast("dict[str, object]", value)


def _string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 4_096:
        raise ValueError(code)
    return value


def _sha256(value: object, code: str) -> str:
    result = _string(value, code)
    if len(result) != 64 or any(character not in "0123456789abcdef" for character in result):
        raise ValueError(code)
    return result


def _uuid(value: object, code: str) -> str:
    result = _string(value, code)
    if str(uuid.UUID(result)) != result.lower():
        raise ValueError(code)
    return result.lower()


def _child_path(root: Path, value: object, code: str) -> Path:
    candidate = Path(_string(value, code)).resolve(strict=True)
    if candidate.is_symlink() or not candidate.is_file() or candidate.parent != root:
        raise ValueError(code)
    return candidate


def _anchors(value: object) -> tuple[AlignmentAnchor, ...]:
    if not isinstance(value, list) or len(value) > 32:
        raise ValueError("PROTOCOL_ANCHORS_INVALID")
    result: list[AlignmentAnchor] = []
    for item in value:
        raw = _object(
            item,
            frozenset({"anchorId", "source", "target"}),
            "PROTOCOL_ANCHOR_INVALID",
        )
        source = _object(raw["source"], frozenset({"x", "y", "z"}), "PROTOCOL_ANCHOR_INVALID")
        target = _object(raw["target"], frozenset({"x", "y", "z"}), "PROTOCOL_ANCHOR_INVALID")
        coordinates = (*source.values(), *target.values())
        if any(isinstance(item, bool) or not isinstance(item, int) for item in coordinates):
            raise ValueError("PROTOCOL_ANCHOR_INVALID")
        result.append(
            AlignmentAnchor(
                anchor_id=_uuid(raw["anchorId"], "PROTOCOL_ANCHOR_INVALID"),
                source=Vec3(
                    cast("int", source["x"]),
                    cast("int", source["y"]),
                    cast("int", source["z"]),
                ),
                target=Vec3(
                    cast("int", target["x"]),
                    cast("int", target["y"]),
                    cast("int", target["z"]),
                ),
            )
        )
    return tuple(result)


def _tool(manifest: GeometryProposalManifest) -> JsonObject:
    value = manifest.tool.to_json()
    value.pop("executionEvidence", None)
    return value


def _result_core(manifest: GeometryProposalManifest) -> JsonObject:
    return {
        "alignment": {
            "anchorCount": 0
            if manifest.alignment is None
            else len(manifest.alignment.inlier_anchor_ids)
            + len(manifest.alignment.outlier_anchor_ids),
            **(
                {}
                if manifest.alignment is None
                else {"residualP90Micrometres": int(manifest.alignment.residual_p90 + 0.5)}
            ),
        },
        "artifacts": [
            *([] if manifest.camera_set is None else [manifest.camera_set.artifact.to_json()]),
            *[item.artifact.to_json() for item in manifest.geometry],
            manifest.diagnostics_artifact.to_json(),
        ],
        "componentCount": len(manifest.components),
        "coordinateSystem": "right-handed-local",
        "inputFrameCount": manifest.input_frame_count,
        "manifestSha256": manifest.manifest_sha256,
        "registeredFrameCount": manifest.registered_frame_count,
        "scaleStatus": manifest.scale_status,
        "schemaVersion": "c8-geometry-result-v1",
        "tool": _tool(manifest),
        "unit": manifest.unit,
    }


def _prepared_manifest(
    value: object,
    *,
    job_id: str,
    project_id: str,
    job_source_manifest_sha256: str,
    frame_paths: dict[str, Path],
) -> tuple[JsonObject, str]:
    prepared = _object(
        value,
        frozenset(
            {
                "frames",
                "jobId",
                "manifestSha256",
                "privacyStatus",
                "projectId",
                "schemaVersion",
                "sourceManifestSha256",
                "tool",
            }
        ),
        "PROTOCOL_PREPARED_INVALID",
    )
    if (
        prepared["schemaVersion"] != "c8-media-preparation-v1"
        or prepared["privacyStatus"] != "accepted"
        or prepared["jobId"] != job_id
        or prepared["projectId"] != project_id
        or prepared["sourceManifestSha256"] != job_source_manifest_sha256
    ):
        raise ValueError("PROTOCOL_PREPARED_INVALID")
    manifest_sha256 = _sha256(prepared["manifestSha256"], "PROTOCOL_PREPARED_INVALID")
    frames = prepared["frames"]
    if not isinstance(frames, list) or len(frames) != len(frame_paths):
        raise ValueError("PROTOCOL_PREPARED_INVALID")
    for item in frames:
        if not isinstance(item, dict):
            raise ValueError("PROTOCOL_PREPARED_INVALID")
        frame = cast("dict[str, object]", item)
        frame_id = _uuid(frame.get("frameId"), "PROTOCOL_PREPARED_INVALID")
        source = frame_paths.get(frame_id)
        if source is None:
            raise ValueError("PROTOCOL_PREPARED_INVALID")
        expected = _sha256(frame.get("sanitizedSha256"), "PROTOCOL_PREPARED_INVALID")
        actual, _size = sha256_file(source, maximum_bytes=53_687_091_200)
        if actual != expected:
            raise ValueError("PROTOCOL_PREPARED_INVALID")
    return cast("JsonObject", prepared), manifest_sha256


def _millionths(value: object, code: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise ValueError(code)
    result = round(value * 1_000_000)
    if abs(result) > 1_000_000_000_000:
        raise ValueError(code)
    return result


def _camera_intrinsics(camera: dict[str, object]) -> tuple[str, list[int]]:
    model = camera.get("model")
    parameters = camera.get("parameters")
    if not isinstance(model, str) or not isinstance(parameters, list):
        raise ValueError("APPEARANCE_CAMERA_INVALID")
    values = [_millionths(value, "APPEARANCE_CAMERA_INVALID") for value in parameters]
    if model == "PINHOLE" and len(values) == 4:
        fx, fy, cx, cy = values
        return "PINHOLE", [fx, fy, cx, cy, 0, 0, 0, 0]
    if model == "SIMPLE_PINHOLE" and len(values) == 3:
        focal, cx, cy = values
        return "PINHOLE", [focal, focal, cx, cy, 0, 0, 0, 0]
    if model == "OPENCV" and len(values) == 8:
        return "OPENCV", values
    if model in {"SIMPLE_RADIAL", "RADIAL"} and len(values) in {4, 5}:
        focal, cx, cy, *radial = values
        return "OPENCV", [focal, focal, cx, cy, *radial, *([0] * (4 - len(radial)))]
    raise ValueError("APPEARANCE_CAMERA_MODEL_UNSUPPORTED")


def _appearance_camera_manifest(
    *,
    manifest: GeometryProposalManifest,
    prepared: JsonObject,
    prepared_manifest_sha256: str,
    publisher: StagingArtifactPublisher,
    job_id: str,
    project_id: str,
) -> JsonObject:
    if manifest.camera_set is None:
        raise ValueError("APPEARANCE_CAMERA_MISSING")
    camera_path = publisher.private_path(manifest.camera_set.artifact.artifact_id)
    if camera_path.stat().st_size > MAXIMUM_PROTOCOL_BYTES:
        raise ValueError("APPEARANCE_CAMERA_INVALID")
    raw = json.loads(camera_path.read_text(encoding="utf-8"))
    camera_document = _object(
        raw,
        frozenset(
            {
                "authority",
                "cameras",
                "coordinateSystem",
                "images",
                "poseConvention",
                "schemaVersion",
            }
        ),
        "APPEARANCE_CAMERA_INVALID",
    )
    if camera_document["schemaVersion"] != "c8-calibrated-cameras-v1":
        raise ValueError("APPEARANCE_CAMERA_INVALID")
    prepared_frames = prepared["frames"]
    if not isinstance(prepared_frames, list):
        raise ValueError("APPEARANCE_CAMERA_INVALID")
    by_key: dict[str, dict[str, object]] = {}
    for index, item in enumerate(prepared_frames):
        if not isinstance(item, dict):
            raise ValueError("APPEARANCE_CAMERA_INVALID")
        by_key[registered_image_key(f"frame-{index:06d}.png")] = cast("dict[str, object]", item)
    raw_cameras = camera_document["cameras"]
    raw_images = camera_document["images"]
    if not isinstance(raw_cameras, list) or not isinstance(raw_images, list):
        raise ValueError("APPEARANCE_CAMERA_INVALID")
    cameras: dict[int, dict[str, object]] = {}
    for item in raw_cameras:
        if not isinstance(item, dict) or not isinstance(item.get("cameraId"), int):
            raise ValueError("APPEARANCE_CAMERA_INVALID")
        cameras[cast("int", item["cameraId"])] = cast("dict[str, object]", item)
    output_frames: list[JsonValue] = []
    for item in raw_images:
        if not isinstance(item, dict):
            raise ValueError("APPEARANCE_CAMERA_INVALID")
        image = cast("dict[str, object]", item)
        camera_id = image.get("cameraId")
        frame_key = image.get("frameKeySha256")
        rotation = image.get("worldToCameraRotation")
        center = image.get("cameraCenter")
        if (
            not isinstance(camera_id, int)
            or not isinstance(frame_key, str)
            or not isinstance(rotation, list)
            or not isinstance(center, list)
            or len(rotation) != 3
            or len(center) != 3
        ):
            raise ValueError("APPEARANCE_CAMERA_INVALID")
        prepared_frame = by_key.get(frame_key)
        camera = cameras.get(camera_id)
        if prepared_frame is None or camera is None:
            raise ValueError("APPEARANCE_CAMERA_INVALID")
        rows = []
        for row in rotation:
            if not isinstance(row, list) or len(row) != 3:
                raise ValueError("APPEARANCE_CAMERA_INVALID")
            rows.append([_millionths(value, "APPEARANCE_CAMERA_INVALID") * 1_000 for value in row])
        model, intrinsic = _camera_intrinsics(camera)
        output_frames.append(
            cast(
                "JsonValue",
                cast(
                    "object",
                    {
                        "basisNanounits": [
                            rows[column][row] for row in range(3) for column in range(3)
                        ],
                        "cameraId": str(
                            uuid.uuid5(
                                uuid.NAMESPACE_URL,
                                f"c8:{job_id}:camera:{camera_id}:{str(image.get('imageId'))}",
                            )
                        ),
                        "cameraModel": model,
                        "distortionMillionths": intrinsic[4:8],
                        "focalXMillionths": intrinsic[0],
                        "focalYMillionths": intrinsic[1],
                        "frameId": _uuid(
                            prepared_frame.get("frameId"), "APPEARANCE_CAMERA_INVALID"
                        ),
                        "principalXMillionths": intrinsic[2],
                        "principalYMillionths": intrinsic[3],
                        "sourceFrameSha256": _sha256(
                            prepared_frame.get("sanitizedSha256"), "APPEARANCE_CAMERA_INVALID"
                        ),
                        "translationMicroUnits": [
                            _millionths(value, "APPEARANCE_CAMERA_INVALID") for value in center
                        ],
                    },
                ),
            )
        )
    core: JsonObject = {
        "coordinateSystem": "right-handed-local",
        "frames": output_frames,
        "jobId": job_id,
        "projectId": project_id,
        "schemaVersion": "c8-calibrated-cameras-v1",
        "sourceManifestSha256": prepared_manifest_sha256,
        "tool": _tool(manifest),
        "translationUnit": manifest.unit,
    }
    return {**core, "manifestSha256": sha256_json(core)}


def execute_protocol(
    raw: object, *, output_root: Path, registry: BinaryRegistry | None = None
) -> JsonObject:
    request = _object(
        raw,
        frozenset(
            {
                "attempt",
                "appearanceMode",
                "frames",
                "inputRoot",
                "jobId",
                "jobSourceManifestSha256",
                "mode",
                "prepared",
                "projectId",
                "registrationAnchors",
                "rights",
            }
        ),
        "PROTOCOL_REQUEST_INVALID",
    )
    if request["mode"] not in {"rgb-sfm", "rgbd-tsdf", "hybrid"}:
        raise ValueError("PROTOCOL_MODE_UNSUPPORTED")
    if request["appearanceMode"] not in {"disabled", "optional"}:
        raise ValueError("PROTOCOL_APPEARANCE_MODE_INVALID")
    if not isinstance(request["attempt"], int) or isinstance(request["attempt"], bool):
        raise ValueError("PROTOCOL_ATTEMPT_INVALID")
    if not 1 <= request["attempt"] <= 3:
        raise ValueError("PROTOCOL_ATTEMPT_INVALID")
    job_id = _uuid(request["jobId"], "PROTOCOL_SCOPE_INVALID")
    project_id = _uuid(request["projectId"], "PROTOCOL_SCOPE_INVALID")
    job_source_manifest_sha256 = _sha256(
        request["jobSourceManifestSha256"], "PROTOCOL_SOURCE_INVALID"
    )
    input_root = Path(_string(request["inputRoot"], "PROTOCOL_ROOT_INVALID")).resolve(strict=True)
    if input_root.is_symlink() or not input_root.is_dir():
        raise ValueError("PROTOCOL_ROOT_INVALID")
    raw_frames = request["frames"]
    if not isinstance(raw_frames, list) or not 2 <= len(raw_frames) <= 10_000:
        raise ValueError("PROTOCOL_FRAME_COUNT_INVALID")
    frames: list[StagedImage] = []
    frame_paths: dict[str, Path] = {}
    for item in raw_frames:
        frame = _object(
            item,
            frozenset({"frameId", "path", "sha256"}),
            "PROTOCOL_FRAME_INVALID",
        )
        frame_id = _uuid(frame["frameId"], "PROTOCOL_FRAME_INVALID")
        frame_path = _child_path(input_root, frame["path"], "PROTOCOL_FRAME_INVALID")
        frame_paths[frame_id] = frame_path
        frames.append(
            StagedImage(
                source_path=frame_path,
                sha256=_sha256(frame["sha256"], "PROTOCOL_FRAME_INVALID"),
                media_type="image/png",
            )
        )
    prepared, prepared_manifest_sha256 = _prepared_manifest(
        request["prepared"],
        job_id=job_id,
        project_id=project_id,
        job_source_manifest_sha256=job_source_manifest_sha256,
        frame_paths=frame_paths,
    )
    publisher = StagingArtifactPublisher(output_root / "artifacts")
    if registry is None:
        discovered = discover_reconstruction_adapters()
        colmap = discovered.colmap
    else:
        discovered = None
        colmap = ColmapAdapter(registry, workspace_base=output_root / "workspace")
    manifest = colmap.run_sparse(
        tuple(frames),
        source_manifest_sha256=prepared_manifest_sha256,
        publisher=publisher,
        alignment_anchors=_anchors(request["registrationAnchors"]),
    )
    findings: list[JsonValue] = [finding.code for finding in manifest.findings]
    if request["mode"] != "rgb-sfm":
        findings.append("RGBD_TSDF_INPUT_UNAVAILABLE")
    appearance_registration = None
    if request["appearanceMode"] == "optional" and discovered is not None:
        appearance_registration = next(
            item for item in discovered.registrations if item.adapter_id == "c8.appearance.gsplat"
        )
        if appearance_registration.status == "unavailable":
            findings.append(appearance_registration.safe_code)
    if manifest.status == "abstained":
        primary = manifest.findings[0].code if manifest.findings else "RECONSTRUCTION_ABSTAINED"
        result: JsonObject = {
            "diagnosticArtifact": manifest.diagnostics_artifact.to_json(),
            "findings": findings or [primary],
            "safeCode": primary,
            "status": "abstained",
        }
    else:
        geometry = _result_core(manifest)
        result = {
            "findings": findings,
            "geometry": geometry,
            "status": "completed",
        }
        if (
            request["appearanceMode"] == "optional"
            and discovered is not None
            and appearance_registration is not None
            and appearance_registration.status == "available"
        ):
            cameras = _appearance_camera_manifest(
                manifest=manifest,
                prepared=prepared,
                prepared_manifest_sha256=prepared_manifest_sha256,
                publisher=publisher,
                job_id=job_id,
                project_id=project_id,
            )
            camera_frames = cameras["frames"]
            if not isinstance(camera_frames, list):
                raise ValueError("APPEARANCE_CAMERA_INVALID")
            staged = {
                cast("str", cast("dict[str, JsonValue]", item)["frameId"]): frame_paths[
                    cast("str", cast("dict[str, JsonValue]", item)["frameId"])
                ]
                for item in camera_frames
            }
            outcome = discovered.gsplat.execute(
                {
                    "attempt": request["attempt"],
                    "cameras": cameras,
                    "geometry": geometry,
                    "jobId": job_id,
                    "method": "gsplat",
                    "prepared": prepared,
                    "projectId": project_id,
                    "rights": request["rights"],
                    "schemaVersion": "c8-neural-appearance-input-v1",
                },
                workspace_root=output_root,
                staged_frames=TrustedStagedFrames(root=input_root, by_frame_id=staged),
                cancelled=lambda: False,
                publication_fence=lambda: True,
                publisher=AppearanceArtifactPublisher(publisher),
            )
            if outcome.status == "completed" and outcome.result is not None:
                result["appearance"] = cast("JsonObject", cast("object", outcome.result))
            else:
                cast("list[JsonValue]", result["findings"]).append(outcome.safe_code)
    return {"privateArtifacts": publisher.private_records(), "result": result}


def _read_json(path: Path) -> object:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAXIMUM_PROTOCOL_BYTES:
        raise ValueError("PROTOCOL_REQUEST_INVALID")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--request", required=True)
    parser.add_argument("--result", required=True)
    arguments = parser.parse_args()
    request_path = Path(arguments.request).resolve(strict=True)
    result_path = Path(arguments.result).resolve(strict=False)
    if result_path.exists() or not result_path.parent.is_dir():
        raise ValueError("PROTOCOL_RESULT_INVALID")
    output_root = result_path.parent / "outputs"
    output_root.mkdir(mode=0o700)
    result_path.write_bytes(
        canonical_json_bytes(execute_protocol(_read_json(request_path), output_root=output_root))
    )
    result_path.chmod(0o600)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
