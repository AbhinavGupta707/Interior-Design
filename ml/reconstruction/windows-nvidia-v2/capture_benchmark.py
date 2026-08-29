#!/usr/bin/env python3
"""Secure Capture Envelope export, verification, selection and benchmark planning.

This utility never mutates product state, downloads model weights, or promotes output.
Signed URLs and credentials stay in memory and are deliberately excluded from errors.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import re
import sqlite3
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import UTC, datetime
from http.client import HTTPMessage
from pathlib import Path, PurePosixPath
from typing import IO, Any, BinaryIO, cast

SCHEMA_EXPORT = "capture-benchmark-export-v1"
SCHEMA_SELECTION = "capture-benchmark-selection-v1"
SCHEMA_POLICY = "capture-benchmark-routing-policy-v1"
SCHEMA_RECORD = "c14-9-capture-benchmark-v1"
PACKAGE_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKAGE_ROOT.parents[2] if len(PACKAGE_ROOT.parents) > 2 else Path.cwd()
SHA256 = re.compile(r"^[0-9a-f]{64}$")
IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
MAX_DOWNLOAD_BYTES = 21_474_836_480


def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, allow_nan=False, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def as_object(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object")
    return cast("dict[str, Any]", value)


def safe_root(path: Path, *, create: bool = False) -> Path:
    if not path.is_absolute() or path.is_symlink():
        raise ValueError("directory must be absolute and not a symlink")
    if create:
        path.mkdir(mode=0o700)
    if not path.is_dir() or path.resolve() != path:
        raise ValueError("directory must exist, be normalized, and not be a symlink")
    return path


def safe_relative(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("manifest path is unsafe")
    return path


def confined_path(root: Path, value: str, *, directory: bool) -> Path:
    relative = safe_relative(value)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("confined path contains a symlink")
    resolved = current.resolve(strict=True)
    if root != resolved and root not in resolved.parents:
        raise ValueError("confined path escapes its root")
    if directory:
        if not current.is_dir():
            raise ValueError("confined directory is invalid")
    elif not current.is_file():
        raise ValueError("confined file is invalid")
    return current


def exact_keys(value: dict[str, Any], expected: set[str], name: str) -> None:
    if set(value) != expected:
        raise ValueError(f"{name} fields do not match the frozen schema")


def integer_in_range(value: object, minimum: int, maximum: int) -> bool:
    return not isinstance(value, bool) and isinstance(value, int) and minimum <= value <= maximum


def validate_transfer(value: object) -> None:
    transfer = as_object(value, "transfer")
    exact_keys(transfer, {"partCount", "reconciledAt", "resumable", "state"}, "transfer")
    if (
        not integer_in_range(transfer.get("partCount"), 1, 10_000)
        or transfer.get("resumable") is not True
        or transfer.get("state") != "complete"
        or not isinstance(transfer.get("reconciledAt"), str)
    ):
        raise ValueError("transfer receipt is invalid")


def contains_forbidden_key(value: object) -> bool:
    forbidden = {
        "authorization",
        "bearertoken",
        "credential",
        "credentials",
        "objectkey",
        "signedurl",
        "url",
    }
    if isinstance(value, dict):
        return any(
            str(key).replace("_", "").casefold() in forbidden or contains_forbidden_key(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(contains_forbidden_key(child) for child in value)
    return False


def validated_https_url(value: object, *, origin_only: bool = False) -> str:
    if not isinstance(value, str) or value.strip() != value:
        raise ValueError("HTTPS URL is invalid")
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or (origin_only and (parsed.query or parsed.path not in {"", "/"}))
    ):
        raise ValueError("HTTPS URL is invalid")
    return value


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> None:
        del req, fp, code, msg, headers, newurl
        return None


def private_write(path: Path, content: bytes) -> None:
    if path.exists() or path.is_symlink() or not path.parent.is_dir():
        raise ValueError(f"unsafe output target: {path.name}")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(content)


def private_copy(source: Path, destination: Path) -> None:
    if (
        source.is_symlink()
        or not source.is_file()
        or destination.exists()
        or destination.is_symlink()
    ):
        raise ValueError("unsafe immutable file copy")
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with source.open("rb") as input_file, os.fdopen(descriptor, "wb") as output:
        while chunk := input_file.read(1024 * 1024):
            output.write(chunk)


def api_json(
    base_url: str,
    endpoint: str,
    token: str,
    *,
    body: object | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    base_url = validated_https_url(base_url, origin_only=True)
    if token.strip() != token or not token or not endpoint.startswith("/"):
        raise ValueError("API URL or bearer token is invalid")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    data = None
    method = "GET"
    if body is not None:
        method = "POST"
        data = canonical_bytes(body)
        headers["Content-Type"] = "application/json"
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    request = urllib.request.Request(
        base_url.rstrip("/") + endpoint, data=data, headers=headers, method=method
    )
    try:
        with urllib.request.build_opener(NoRedirectHandler).open(request, timeout=60) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"API request failed with status {response.status}")
            return as_object(json.load(response), "API response")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"API request failed with status {error.code}") from None
    except urllib.error.URLError:
        raise RuntimeError("API request failed before a response was received") from None


def download_verified(url: str, destination: Path, size: int, expected_sha256: str) -> None:
    url = validated_https_url(url)
    if size <= 0 or size > MAX_DOWNLOAD_BYTES or SHA256.fullmatch(expected_sha256) is None:
        raise ValueError("declared download size or hash is invalid")
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    digest = hashlib.sha256()
    written = 0
    try:
        with os.fdopen(descriptor, "wb") as output:
            try:
                response: BinaryIO = urllib.request.build_opener(NoRedirectHandler).open(
                    url, timeout=120
                )
            except (urllib.error.HTTPError, urllib.error.URLError):
                raise RuntimeError("signed object download failed") from None
            with response:
                while chunk := response.read(1024 * 1024):
                    written += len(chunk)
                    if written > size:
                        raise ValueError("download exceeded its declared byte size")
                    digest.update(chunk)
                    output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    if written != size or digest.hexdigest() != expected_sha256:
        destination.unlink(missing_ok=True)
        raise ValueError("download bytes do not match the immutable declaration")


def alias(salt: bytes, kind: str, value: str) -> str:
    return f"{kind}_" + hmac.new(salt, f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()[:24]


def extension(content_type: str) -> str:
    mapping = {
        "image/heic": "heic",
        "image/jpeg": "jpg",
        "image/png": "png",
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "application/json": "json",
        "application/octet-stream": "bin",
        "model/vnd.usdz+zip": "usdz",
    }
    if content_type not in mapping:
        raise ValueError("unsupported immutable source content type")
    return mapping[content_type]


def file_entry(
    path: Path, root: Path, *, content_type: str, kind: str, source_id: str
) -> dict[str, object]:
    return {
        "byteSize": path.stat().st_size,
        "contentType": content_type,
        "kind": kind,
        "path": path.relative_to(root).as_posix(),
        "sha256": sha256_file(path),
        "sourceId": source_id,
    }


def export_access_idempotency_key(
    attempt_namespace: uuid.UUID, envelope_sha: str, source_id: str
) -> str:
    """Keep access creation idempotent only within one export attempt.

    Signed URLs expire, so a later exporter process must not replay an earlier attempt's cached
    access response. The attempt namespace remains in memory and is never persisted.
    """

    return str(uuid.uuid5(attempt_namespace, f"c14.9:{envelope_sha}:asset:{source_id}"))


def export_capture(args: argparse.Namespace) -> None:
    token = os.environ.get("C14_9_BEARER_TOKEN", "")
    salt_text = os.environ.get("C14_9_ALIAS_SALT", "")
    tenant_id = os.environ.get("C14_9_TENANT_ID", "")
    actor_id = os.environ.get("C14_9_ACTOR_ID", "")
    if (
        len(salt_text.encode()) < 32
        or UUID.fullmatch(tenant_id) is None
        or UUID.fullmatch(actor_id) is None
    ):
        raise ValueError("private alias environment is absent or invalid")
    if COMMIT.fullmatch(args.source_commit) is None:
        raise ValueError("source commit must be a full lowercase SHA")
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if head != args.source_commit:
        raise ValueError("source commit does not match the checked-out benchmark code")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if status:
        raise ValueError("benchmark source checkout must be exactly clean")
    project_id = args.project_id
    session_id = args.capture_session_id
    if UUID.fullmatch(project_id) is None or UUID.fullmatch(session_id) is None:
        raise ValueError("project and capture session IDs must be lowercase UUIDs")
    record = api_json(
        args.base_url,
        f"/v1/projects/{project_id}/capture-sessions/{session_id}/envelope",
        token,
    )
    acceptance = as_object(record.get("acceptance"), "envelope acceptance")
    envelope = as_object(record.get("envelope"), "envelope")
    envelope_bytes = canonical_bytes(envelope)
    envelope_sha = sha256_bytes(envelope_bytes)
    if (
        envelope.get("schemaVersion") != "capture-envelope-v1"
        or envelope.get("projectId") != project_id
        or envelope.get("captureSessionId") != session_id
        or as_object(envelope.get("capabilities"), "capabilities").get("runtime")
        != "physical-device"
        or acceptance.get("envelopeSha256") != envelope_sha
    ):
        raise ValueError("only an exact accepted physical Capture Envelope can be exported")
    output_parent = safe_root(Path(args.output_parent))
    output_root = output_parent / envelope_sha
    safe_root(output_root, create=True)
    for name in ("rgb", "depth", "roomplan"):
        (output_root / name).mkdir(mode=0o700)
    private_write(output_root / "envelope.json", envelope_bytes)
    files: list[dict[str, object]] = []
    access_attempt_namespace = uuid.uuid4()
    for source_value in cast("list[object]", envelope.get("mediaSources", [])):
        source = as_object(source_value, "media source")
        asset_id = cast("str", source.get("assetId"))
        content_type = cast("str", source.get("mimeType"))
        access = api_json(
            args.base_url,
            f"/v1/projects/{project_id}/assets/{asset_id}/access",
            token,
            body={"representation": "original"},
            idempotency_key=export_access_idempotency_key(
                access_attempt_namespace, envelope_sha, asset_id
            ),
        )
        destination = output_root / "rgb" / f"{asset_id}.{extension(content_type)}"
        download_verified(
            cast("str", access.get("url")),
            destination,
            cast("int", source.get("byteSize")),
            cast("str", source.get("sha256")),
        )
        files.append(
            file_entry(
                destination,
                output_root,
                content_type=content_type,
                kind="rgb-original",
                source_id=asset_id,
            )
        )
    for source_value in cast("list[object]", envelope.get("depthSources", [])):
        source = as_object(source_value, "depth source")
        artifact_id = cast("str", source.get("artifactId"))
        access = api_json(
            args.base_url,
            f"/v1/projects/{project_id}/capture-sessions/{session_id}/artifacts/{artifact_id}/access",
            token,
            body={},
        )
        if access.get("sha256") != source.get("sha256") or access.get("byteSize") != source.get(
            "byteSize"
        ):
            raise ValueError("artifact access response disagrees with the accepted envelope")
        destination = output_root / "depth" / f"{artifact_id}.bin"
        download_verified(
            cast("str", access.get("url")),
            destination,
            cast("int", source.get("byteSize")),
            cast("str", source.get("sha256")),
        )
        files.append(
            file_entry(
                destination,
                output_root,
                content_type="application/octet-stream",
                kind="depth-original",
                source_id=artifact_id,
            )
        )
    for reference_value in cast("list[object]", envelope.get("roomPlanSources", [])):
        reference = as_object(reference_value, "RoomPlan reference")
        package_id = cast("str", reference.get("packageId"))
        package_session_id = cast("str", reference.get("captureSessionId"))
        package = api_json(
            args.base_url,
            f"/v1/projects/{project_id}/capture-sessions/{package_session_id}/packages/{package_id}",
            token,
        )
        if package.get("manifestSha256") != reference.get("packageManifestSha256"):
            raise ValueError("RoomPlan package hash disagrees with the accepted envelope")
        package_root = output_root / "roomplan" / package_id
        package_root.mkdir(mode=0o700)
        package_path = package_root / "package.json"
        private_write(package_path, canonical_bytes(package))
        files.append(
            file_entry(
                package_path,
                output_root,
                content_type="application/json",
                kind="roomplan-package-metadata",
                source_id=package_id,
            )
        )
        manifest = as_object(package.get("manifest"), "RoomPlan manifest")
        for artifact_value in cast("list[object]", manifest.get("artifacts", [])):
            artifact = as_object(artifact_value, "RoomPlan artifact")
            artifact_id = cast("str", artifact.get("artifactId"))
            content_type = cast("str", artifact.get("contentType"))
            access = api_json(
                args.base_url,
                f"/v1/projects/{project_id}/capture-sessions/{package_session_id}/artifacts/{artifact_id}/access",
                token,
                body={},
            )
            if access.get("sha256") != artifact.get("sha256") or access.get(
                "byteSize"
            ) != artifact.get("byteSize"):
                raise ValueError("RoomPlan artifact access disagrees with its package")
            destination = package_root / f"{artifact_id}.{extension(content_type)}"
            download_verified(
                cast("str", access.get("url")),
                destination,
                cast("int", artifact.get("byteSize")),
                cast("str", artifact.get("sha256")),
            )
            files.append(
                file_entry(
                    destination,
                    output_root,
                    content_type=content_type,
                    kind="roomplan-original",
                    source_id=artifact_id,
                )
            )
    salt = salt_text.encode()
    manifest = {
        "acceptedAt": acceptance.get("acceptedAt"),
        "acceptedByAlias": alias(salt, "actor", cast("str", acceptance.get("acceptedBy"))),
        "actorAlias": alias(salt, "actor", actor_id),
        "captureSessionAlias": alias(salt, "capture", session_id),
        "envelopeAlias": alias(salt, "envelope", cast("str", acceptance.get("envelopeId"))),
        "envelopeSha256": envelope_sha,
        "exportedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "files": sorted(files, key=lambda item: cast("str", item["path"])),
        "generator": {"name": "capture_benchmark.py", "version": "1"},
        "inputClass": "accepted-physical-capture",
        "projectAlias": alias(salt, "project", project_id),
        "rights": envelope.get("rights"),
        "schemaVersion": SCHEMA_EXPORT,
        "sourceCommit": args.source_commit,
        "tenantAlias": alias(salt, "tenant", tenant_id),
    }
    private_write(output_root / "export-manifest.json", canonical_bytes(manifest) + b"\n")
    verify_export(output_root)
    print(
        json.dumps(
            {"envelopeSha256": envelope_sha, "output": str(output_root), "verified": True},
            sort_keys=True,
        )
    )


def validate_envelope_shape(envelope: dict[str, Any]) -> None:
    exact_keys(
        envelope,
        {
            "cameraSamples",
            "capabilities",
            "captureSessionId",
            "coordinateSegments",
            "depthSources",
            "endedAt",
            "generator",
            "intent",
            "mediaSources",
            "projectId",
            "quality",
            "rights",
            "roomPlanSources",
            "rooms",
            "schemaVersion",
            "startedAt",
            "transferState",
        },
        "Capture Envelope",
    )
    if envelope.get("schemaVersion") != "capture-envelope-v1":
        raise ValueError("Capture Envelope schema is unsupported")
    if any(
        UUID.fullmatch(str(envelope.get(key))) is None for key in ("projectId", "captureSessionId")
    ):
        raise ValueError("Capture Envelope identity is invalid")
    generator = as_object(envelope["generator"], "generator")
    exact_keys(generator, {"name", "version"}, "generator")
    if (
        generator.get("name") != "ios-guided-capture"
        or not isinstance(generator.get("version"), str)
        or not cast("str", generator["version"]).strip()
        or envelope.get("intent") not in {"room-by-room", "small-apartment"}
        or envelope.get("transferState") != "complete"
    ):
        raise ValueError("Capture Envelope generator or mode is invalid")
    rights = as_object(envelope["rights"], "rights")
    exact_keys(
        rights,
        {"basis", "serviceProcessingConsent", "trainingUseConsent"},
        "rights",
    )
    if (
        rights.get("serviceProcessingConsent") is not True
        or rights.get("trainingUseConsent") != "denied"
    ):
        raise ValueError("Capture Envelope processing rights are not permitted")
    capabilities = as_object(envelope["capabilities"], "capabilities")
    exact_keys(
        capabilities,
        {
            "appBuild",
            "appVersion",
            "arWorldTracking",
            "cameraIntrinsics",
            "cameraPoses",
            "deviceModelIdentifier",
            "operatingSystemVersion",
            "qualityTier",
            "rgbKeyframes",
            "rgbVideo",
            "roomPlan",
            "runtime",
            "sceneDepth",
            "schemaVersion",
        },
        "capabilities",
    )
    quality = as_object(envelope["quality"], "quality")
    required_quality_fields = {
        "interruptionCount",
        "lowLightSampleCount",
        "missingCoverageCellCount",
        "motionWarningSampleCount",
        "occludedCoverageCellCount",
        "trackingLimitedSampleCount",
        "unusableBlurSampleCount",
    }
    if set(quality) not in {
        frozenset(required_quality_fields),
        frozenset(required_quality_fields | {"spatialEvidence"}),
    }:
        raise ValueError("quality fields do not match the frozen schema")
    if any(
        not integer_in_range(quality.get(key), 0, 10_000)
        for key in (
            "interruptionCount",
            "lowLightSampleCount",
            "motionWarningSampleCount",
            "trackingLimitedSampleCount",
            "unusableBlurSampleCount",
        )
    ) or any(
        not integer_in_range(quality.get(key), 0, 1_536)
        for key in ("missingCoverageCellCount", "occludedCoverageCellCount")
    ):
        raise ValueError("quality summary counts are invalid")
    spatial_summary_value = quality.get("spatialEvidence")
    spatial_summary: dict[str, Any] | None = None
    if spatial_summary_value is not None:
        spatial_summary = as_object(spatial_summary_value, "spatial quality summary")
        exact_keys(
            spatial_summary,
            {
                "automaticallySelectedSampleCount",
                "connectedSampleCount",
                "loopClosureSampleCount",
                "unresolvedRoomCount",
                "unresolvedZoneCount",
            },
            "spatial quality summary",
        )
        if (
            any(
                not integer_in_range(spatial_summary.get(key), 0, 10_000)
                for key in (
                    "automaticallySelectedSampleCount",
                    "connectedSampleCount",
                    "loopClosureSampleCount",
                )
            )
            or not integer_in_range(spatial_summary.get("unresolvedRoomCount"), 0, 64)
            or not integer_in_range(spatial_summary.get("unresolvedZoneCount"), 0, 2_048)
        ):
            raise ValueError("spatial quality summary counts are invalid")
    if (
        capabilities.get("schemaVersion") != "capture-capabilities-v1"
        or capabilities.get("runtime") not in {"physical-device", "simulator-fixture"}
        or any(
            not isinstance(capabilities.get(key), bool)
            for key in (
                "arWorldTracking",
                "cameraIntrinsics",
                "cameraPoses",
                "rgbKeyframes",
                "rgbVideo",
                "roomPlan",
                "sceneDepth",
            )
        )
    ):
        raise ValueError("capture capabilities are invalid")
    arrays = {
        name: envelope[name]
        for name in (
            "cameraSamples",
            "coordinateSegments",
            "depthSources",
            "mediaSources",
            "roomPlanSources",
            "rooms",
        )
    }
    if any(not isinstance(value, list) for value in arrays.values()):
        raise ValueError("Capture Envelope collections are invalid")
    media_by_id: dict[str, dict[str, Any]] = {}
    for raw in cast("list[object]", arrays["mediaSources"]):
        source = as_object(raw, "media source")
        exact_keys(
            source,
            {"assetId", "byteSize", "kind", "mimeType", "sha256", "transfer"},
            "media source",
        )
        source_id = str(source.get("assetId"))
        kind = source.get("kind")
        mime_type = source.get("mimeType")
        is_video = mime_type in {"video/mp4", "video/quicktime"}
        if (
            UUID.fullmatch(source_id) is None
            or source_id in media_by_id
            or SHA256.fullmatch(str(source.get("sha256"))) is None
            or kind not in {"rgb-keyframe", "rgb-video"}
            or mime_type
            not in {"image/heic", "image/jpeg", "image/png", "video/mp4", "video/quicktime"}
            or is_video != (kind == "rgb-video")
            or not integer_in_range(source.get("byteSize"), 1, MAX_DOWNLOAD_BYTES)
        ):
            raise ValueError("media source identity is invalid")
        validate_transfer(source.get("transfer"))
        media_by_id[source_id] = source
    segment_ids: set[str] = set()
    segment_scopes: dict[str, tuple[int, int]] = {}
    for raw in cast("list[object]", arrays["coordinateSegments"]):
        segment = as_object(raw, "coordinate segment")
        exact_keys(
            segment,
            {
                "coordinateSystem",
                "endedAtMicroseconds",
                "reason",
                "segmentId",
                "startedAtMicroseconds",
                "translationUnit",
                "worldOriginRelationship",
            },
            "coordinate segment",
        )
        segment_id = str(segment.get("segmentId"))
        if (
            UUID.fullmatch(segment_id) is None
            or segment_id in segment_ids
            or segment.get("coordinateSystem") != "arkit-right-handed-y-up"
            or segment.get("translationUnit") != "micrometres"
            or segment.get("worldOriginRelationship") != "independent-unless-later-registered"
            or segment.get("reason")
            not in {"initial", "room-transition", "interruption", "relaunch", "manual-restart"}
            or not integer_in_range(segment.get("startedAtMicroseconds"), 0, 21_600_000_000)
            or not integer_in_range(segment.get("endedAtMicroseconds"), 0, 21_600_000_000)
            or cast("int", segment["endedAtMicroseconds"])
            <= cast("int", segment["startedAtMicroseconds"])
        ):
            raise ValueError("coordinate segment is invalid")
        segment_ids.add(segment_id)
        segment_scopes[segment_id] = (
            cast("int", segment["startedAtMicroseconds"]),
            cast("int", segment["endedAtMicroseconds"]),
        )
    room_ids: set[str] = set()
    rooms_by_segment: dict[str, set[str]] = {segment_id: set() for segment_id in segment_ids}
    room_zones: dict[str, set[str]] = {}
    rooms_by_id: dict[str, dict[str, Any]] = {}
    for raw in cast("list[object]", arrays["rooms"]):
        room = as_object(raw, "room")
        required_room_fields = {
            "coordinateSegmentIds",
            "coverage",
            "label",
            "roomId",
            "semanticDeclarations",
            "sequence",
        }
        if not required_room_fields.issubset(room) or not (
            set(room) - required_room_fields
        ).issubset({"story", "zones"}):
            raise ValueError("room fields do not match the frozen schema")
        room_id = str(room.get("roomId"))
        if UUID.fullmatch(room_id) is None or room_id in room_ids:
            raise ValueError("room identity is invalid")
        room_ids.add(room_id)
        rooms_by_id[room_id] = room
        room_segments = room.get("coordinateSegmentIds")
        coverage = room.get("coverage")
        semantics = room.get("semanticDeclarations")
        if (
            not isinstance(room_segments, list)
            or not isinstance(coverage, list)
            or not isinstance(semantics, list)
            or not room_segments
            or len(room_segments) > 256
            or len(set(room_segments)) != len(room_segments)
            or not integer_in_range(room.get("sequence"), 1, 64)
            or ("story" in room and not integer_in_range(room.get("story"), -20, 200))
        ):
            raise ValueError("room evidence collections are invalid")
        for segment_id in room_segments:
            if not isinstance(segment_id, str) or segment_id not in segment_ids:
                raise ValueError("room references an unknown segment")
            rooms_by_segment[segment_id].add(room_id)
        coverage_keys: set[tuple[str, str]] = set()
        for raw_cell in coverage:
            cell = as_object(raw_cell, "coverage cell")
            exact_keys(
                cell,
                {"horizontalSector", "status", "verticalBand"},
                "coverage cell",
            )
            key = (str(cell.get("horizontalSector")), str(cell.get("verticalBand")))
            if key in coverage_keys or cell.get("status") not in {
                "observed",
                "missing",
                "occluded",
                "unknown",
            }:
                raise ValueError("coverage cell is invalid or repeated")
            coverage_keys.add(key)
        semantic_layers: set[str] = set()
        for raw_semantic in semantics:
            semantic = as_object(raw_semantic, "semantic declaration")
            exact_keys(
                semantic,
                {"layer", "provenance", "status"},
                "semantic declaration",
            )
            layer = str(semantic.get("layer"))
            if (
                layer in semantic_layers
                or semantic.get("provenance") != "user-asserted"
                or semantic.get("status")
                not in {"observed", "partially-observed", "occluded", "unknown"}
            ):
                raise ValueError("semantic declaration is invalid or repeated")
            semantic_layers.add(layer)
        if len(coverage_keys) != 24 or len(semantic_layers) != 5:
            raise ValueError("room evidence denominators are incomplete")
        zones = room.get("zones")
        zone_ids: set[str] = set()
        if zones is not None:
            if not isinstance(zones, list) or not 1 <= len(zones) <= 32:
                raise ValueError("room capture zones are invalid")
            for raw_zone in zones:
                zone = as_object(raw_zone, "room capture zone")
                exact_keys(zone, {"label", "status", "zoneId"}, "room capture zone")
                zone_id = str(zone.get("zoneId"))
                label = zone.get("label")
                if (
                    UUID.fullmatch(zone_id) is None
                    or zone_id in zone_ids
                    or not isinstance(label, str)
                    or label.strip() != label
                    or not 1 <= len(label) <= 120
                    or zone.get("status") not in {"observed", "missing", "occluded", "unknown"}
                ):
                    raise ValueError("room capture zone is invalid or repeated")
                zone_ids.add(zone_id)
        room_zones[room_id] = zone_ids
    if any(not rooms for rooms in rooms_by_segment.values()):
        raise ValueError("every coordinate segment must belong to a room")
    sample_ids: set[str] = set()
    timestamps: set[tuple[str, int]] = set()
    for raw in cast("list[object]", arrays["cameraSamples"]):
        sample = as_object(raw, "camera sample")
        required = {
            "blurScoreMillionths",
            "cameraIntrinsicsMicropixels",
            "exposureScoreMillionths",
            "intrinsicsModel",
            "motionScoreMillionths",
            "orientation",
            "poseTransform",
            "quaternionNanounits",
            "quaternionOrder",
            "roomId",
            "sampleId",
            "segmentId",
            "sourceAssetId",
            "sourceTimestampMicroseconds",
            "timestampMicroseconds",
            "trackingState",
            "translationMicrometres",
        }
        optional = {
            "ambientIntensity",
            "connectedToPrevious",
            "featurePointCount",
            "loopClosureCandidate",
            "overlapScoreMillionths",
            "parallaxScoreMillionths",
            "retentionMode",
            "trajectorySpanMicrometres",
            "trajectoryTravelMicrometres",
            "translationFromPreviousMicrometres",
            "zoneId",
        }
        if not required.issubset(sample) or not (set(sample) - required).issubset(optional):
            raise ValueError("camera sample fields do not match the frozen schema")
        sample_id = str(sample.get("sampleId"))
        segment_id = str(sample.get("segmentId"))
        room_id = str(sample.get("roomId"))
        source_id = str(sample.get("sourceAssetId"))
        zone_id = sample.get("zoneId")
        timestamp = sample.get("timestampMicroseconds")
        if (
            UUID.fullmatch(sample_id) is None
            or sample_id in sample_ids
            or segment_id not in segment_ids
            or room_id not in rooms_by_segment.get(segment_id, set())
            or source_id not in media_by_id
            or isinstance(timestamp, bool)
            or not isinstance(timestamp, int)
            or (segment_id, timestamp) in timestamps
            or not segment_scopes[segment_id][0] <= timestamp <= segment_scopes[segment_id][1]
            or sample.get("intrinsicsModel") != "pinhole-native-camera-raster"
            or sample.get("poseTransform") != "camera-to-world"
            or sample.get("quaternionOrder") != "x-y-z-w"
            or sample.get("orientation")
            not in {"portrait", "portrait-upside-down", "landscape-left", "landscape-right"}
            or (
                zone_id is not None
                and (not isinstance(zone_id, str) or zone_id not in room_zones.get(room_id, set()))
            )
        ):
            raise ValueError("camera sample scope or convention is invalid")
        intrinsics = as_object(sample.get("cameraIntrinsicsMicropixels"), "intrinsics")
        translation = as_object(sample.get("translationMicrometres"), "translation")
        exact_keys(
            intrinsics,
            {"cx", "cy", "fx", "fy", "imageHeightPixels", "imageWidthPixels"},
            "intrinsics",
        )
        exact_keys(translation, {"x", "y", "z"}, "translation")
        if (
            any(
                not integer_in_range(intrinsics.get(key), 1, 100_000_000_000)
                for key in ("fx", "fy", "imageHeightPixels", "imageWidthPixels")
            )
            or any(
                not integer_in_range(intrinsics.get(key), 0, 100_000_000_000)
                for key in ("cx", "cy")
            )
            or any(
                not integer_in_range(translation.get(key), -1_000_000_000, 1_000_000_000)
                for key in ("x", "y", "z")
            )
            or any(
                not integer_in_range(sample.get(key), 0, 1_000_000)
                for key in (
                    "blurScoreMillionths",
                    "exposureScoreMillionths",
                    "motionScoreMillionths",
                )
            )
            or any(
                key in sample and not integer_in_range(sample.get(key), 0, 1_000_000)
                for key in (
                    "ambientIntensity",
                    "featurePointCount",
                    "overlapScoreMillionths",
                    "parallaxScoreMillionths",
                )
            )
            or any(
                key in sample and not isinstance(sample.get(key), bool)
                for key in ("connectedToPrevious", "loopClosureCandidate")
            )
            or (
                "retentionMode" in sample
                and sample.get("retentionMode") not in {"automatic", "manual"}
            )
            or (
                "trajectorySpanMicrometres" in sample
                and not integer_in_range(sample.get("trajectorySpanMicrometres"), 0, 2_000_000_000)
            )
            or (
                "trajectoryTravelMicrometres" in sample
                and not integer_in_range(
                    sample.get("trajectoryTravelMicrometres"), 0, 10_000_000_000
                )
            )
            or (
                "translationFromPreviousMicrometres" in sample
                and not integer_in_range(
                    sample.get("translationFromPreviousMicrometres"), 0, 2_000_000_000
                )
            )
        ):
            raise ValueError("camera sample calibration values are invalid")
        quaternion = sample.get("quaternionNanounits")
        if (
            not isinstance(quaternion, list)
            or len(quaternion) != 4
            or any(isinstance(value, bool) or not isinstance(value, int) for value in quaternion)
            or not 990_000_000 <= math.hypot(*quaternion) <= 1_010_000_000
        ):
            raise ValueError("camera quaternion is invalid")
        sample_ids.add(sample_id)
        timestamps.add((segment_id, timestamp))
    depth_sample_ids: set[str] = set()
    depth_artifact_ids: set[str] = set()
    for raw in cast("list[object]", arrays["depthSources"]):
        source = as_object(raw, "depth source")
        exact_keys(
            source,
            {
                "alignment",
                "artifactId",
                "byteSize",
                "format",
                "heightPixels",
                "sampleIds",
                "sha256",
                "transfer",
                "widthPixels",
            },
            "depth source",
        )
        artifact_id = str(source.get("artifactId"))
        bound_samples = source.get("sampleIds")
        if (
            UUID.fullmatch(artifact_id) is None
            or artifact_id in depth_artifact_ids
            or SHA256.fullmatch(str(source.get("sha256"))) is None
            or not isinstance(bound_samples, list)
            or not bound_samples
            or any(not isinstance(value, str) or value not in sample_ids for value in bound_samples)
            or depth_sample_ids.intersection(cast("list[str]", bound_samples))
        ):
            raise ValueError("depth source binding is invalid")
        depth_format = source.get("format")
        width = source.get("widthPixels")
        height = source.get("heightPixels")
        byte_size = source.get("byteSize")
        if (
            depth_format not in {"float16-metres-little-endian", "float32-metres-little-endian"}
            or source.get("alignment") != "arkit-scene-depth-image-plane"
            or not integer_in_range(width, 1, 4_096)
            or not integer_in_range(height, 1, 4_096)
            or not integer_in_range(byte_size, 1, 536_870_912)
        ):
            raise ValueError("depth source dimensions or format are invalid")
        bytes_per_pixel = 2 if depth_format == "float16-metres-little-endian" else 4
        width_pixels = cast("int", width)
        height_pixels = cast("int", height)
        declared_byte_size = cast("int", byte_size)
        if (
            declared_byte_size
            != width_pixels * height_pixels * len(bound_samples) * bytes_per_pixel
        ):
            raise ValueError("depth bytes are not exactly bound to their samples")
        validate_transfer(source.get("transfer"))
        depth_artifact_ids.add(artifact_id)
        depth_sample_ids.update(cast("list[str]", bound_samples))
    roomplan_references: set[tuple[str, str]] = set()
    for raw in cast("list[object]", arrays["roomPlanSources"]):
        source = as_object(raw, "RoomPlan source")
        exact_keys(
            source,
            {"captureSessionId", "packageId", "packageManifestSha256"},
            "RoomPlan source",
        )
        reference = (str(source.get("captureSessionId")), str(source.get("packageId")))
        if (
            any(UUID.fullmatch(value) is None for value in reference)
            or reference in roomplan_references
            or SHA256.fullmatch(str(source.get("packageManifestSha256"))) is None
        ):
            raise ValueError("RoomPlan source binding is invalid")
        if reference[0] == envelope.get("captureSessionId"):
            raise ValueError("RoomPlan must come from a separate capture session")
        roomplan_references.add(reference)
    source_counts: dict[str, int] = {}
    for raw in cast("list[object]", arrays["cameraSamples"]):
        sample = as_object(raw, "camera sample")
        source_id = cast("str", sample["sourceAssetId"])
        source_counts[source_id] = source_counts.get(source_id, 0) + 1
    if any(
        source.get("kind") == "rgb-keyframe" and source_counts.get(source_id) != 1
        for source_id, source in media_by_id.items()
    ):
        raise ValueError("every RGB keyframe must bind exactly one camera sample")
    if capabilities.get("rgbVideo") is not any(
        source.get("kind") == "rgb-video" for source in media_by_id.values()
    ) or capabilities.get("rgbKeyframes") is not any(
        source.get("kind") == "rgb-keyframe" for source in media_by_id.values()
    ):
        raise ValueError("RGB capability declarations disagree with immutable sources")
    if bool(depth_artifact_ids) and capabilities.get("sceneDepth") is not True:
        raise ValueError("depth evidence requires declared scene depth")
    if bool(roomplan_references) and capabilities.get("roomPlan") is not True:
        raise ValueError("RoomPlan evidence requires declared support")
    missing = sum(
        1
        for raw_room in cast("list[object]", arrays["rooms"])
        for raw_cell in cast("list[object]", as_object(raw_room, "room")["coverage"])
        if as_object(raw_cell, "coverage cell").get("status") == "missing"
    )
    occluded = sum(
        1
        for raw_room in cast("list[object]", arrays["rooms"])
        for raw_cell in cast("list[object]", as_object(raw_room, "room")["coverage"])
        if as_object(raw_cell, "coverage cell").get("status") == "occluded"
    )
    if (
        quality.get("missingCoverageCellCount") != missing
        or quality.get("occludedCoverageCellCount") != occluded
        or quality.get("interruptionCount")
        != sum(
            as_object(raw, "coordinate segment").get("reason") == "interruption"
            for raw in cast("list[object]", arrays["coordinateSegments"])
        )
        or quality.get("trackingLimitedSampleCount")
        != sum(
            as_object(raw, "camera sample").get("trackingState") != "normal"
            for raw in cast("list[object]", arrays["cameraSamples"])
        )
        or any(
            cast("int", quality[key]) > len(cast("list[object]", arrays["cameraSamples"]))
            for key in (
                "lowLightSampleCount",
                "motionWarningSampleCount",
                "unusableBlurSampleCount",
            )
        )
    ):
        raise ValueError("quality denominators disagree with immutable evidence")

    spatial_samples = [
        as_object(raw, "camera sample")
        for raw in cast("list[object]", arrays["cameraSamples"])
        if "retentionMode" in as_object(raw, "camera sample")
    ]
    if spatial_summary is None:
        if spatial_samples or any("zones" in room for room in rooms_by_id.values()):
            raise ValueError("spatial sample or zone evidence requires its quality summary")
        return

    unresolved_rooms = 0
    unresolved_zones = 0
    for room_id, room in rooms_by_id.items():
        room_samples = [sample for sample in spatial_samples if sample.get("roomId") == room_id]
        segment_samples: dict[str, list[dict[str, Any]]] = {}
        for sample in room_samples:
            segment_samples.setdefault(cast("str", sample["segmentId"]), []).append(sample)
        segment_readiness: list[bool] = []
        for unordered_samples in segment_samples.values():
            samples = sorted(
                unordered_samples, key=lambda sample: cast("int", sample["timestampMicroseconds"])
            )
            edges = samples[1:]
            connected_edges = sum(sample.get("connectedToPrevious") is True for sample in edges)
            connected_ratio = 0 if not edges else (connected_edges * 1_000_000) // len(edges)
            segment_readiness.append(
                len(samples) >= 8
                and connected_ratio >= 750_000
                and samples[0].get("connectedToPrevious") is False
                and all(cast("int", sample.get("featurePointCount", 0)) >= 60 for sample in samples)
                and all(
                    sample.get("connectedToPrevious") is True
                    and cast("int", sample.get("overlapScoreMillionths", 0)) >= 180_000
                    and (
                        sample.get("loopClosureCandidate") is True
                        or cast("int", sample.get("overlapScoreMillionths", 0)) < 940_000
                    )
                    for sample in edges
                )
                and max(
                    (cast("int", sample.get("trajectorySpanMicrometres", 0)) for sample in samples),
                    default=0,
                )
                >= 1_200_000
                and max(
                    (
                        cast("int", sample.get("trajectoryTravelMicrometres", 0))
                        for sample in samples
                    ),
                    default=0,
                )
                >= 2_400_000
                and sum(
                    cast("int", sample.get("translationFromPreviousMicrometres", 0)) >= 120_000
                    for sample in samples
                )
                >= 3
                and sum(
                    cast("int", sample.get("parallaxScoreMillionths", 0)) >= 80_000
                    for sample in samples
                )
                >= 3
                and any(sample.get("loopClosureCandidate") is True for sample in samples)
            )
        room_unresolved_zones = sum(
            zone.get("status") != "occluded"
            and sum(sample.get("zoneId") == zone.get("zoneId") for sample in room_samples) < 2
            for zone in cast("list[dict[str, Any]]", room.get("zones", []))
        )
        unresolved_zones += room_unresolved_zones
        if not segment_readiness or not all(segment_readiness) or room_unresolved_zones != 0:
            unresolved_rooms += 1
    if (
        spatial_summary.get("automaticallySelectedSampleCount")
        != sum(sample.get("retentionMode") == "automatic" for sample in spatial_samples)
        or spatial_summary.get("connectedSampleCount")
        != sum(sample.get("connectedToPrevious") is True for sample in spatial_samples)
        or spatial_summary.get("loopClosureSampleCount")
        != sum(sample.get("loopClosureCandidate") is True for sample in spatial_samples)
        or spatial_summary.get("unresolvedRoomCount") != unresolved_rooms
        or spatial_summary.get("unresolvedZoneCount") != unresolved_zones
    ):
        raise ValueError("spatial quality summary disagrees with immutable evidence")


def verify_export(
    root: Path, *, physical_root_alias: str | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    root = safe_root(root)
    manifest_path = root / "export-manifest.json"
    envelope_path = root / "envelope.json"

    def private_node(path: Path, *, directory: bool) -> None:
        info = path.lstat()
        if path.is_symlink() or bool(info.st_mode & (stat.S_IRWXG | stat.S_IRWXO)):
            raise ValueError("export nodes must be private and link-free")
        if directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError("export directory is invalid")
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("export file must be a private regular non-hard-linked file")

    private_node(root, directory=True)
    for authority_path in (manifest_path, envelope_path):
        if not authority_path.exists():
            raise ValueError("export is missing a regular authority file")
        private_node(authority_path, directory=False)
    manifest_bytes = manifest_path.read_bytes()
    envelope_file_bytes = envelope_path.read_bytes()
    manifest = as_object(json.loads(manifest_bytes), "export manifest")
    envelope = as_object(json.loads(envelope_file_bytes), "envelope")
    if contains_forbidden_key(manifest) or contains_forbidden_key(envelope):
        raise ValueError("export contains a forbidden secret-bearing field")
    exact_keys(
        manifest,
        {
            "acceptedAt",
            "acceptedByAlias",
            "actorAlias",
            "captureSessionAlias",
            "envelopeAlias",
            "envelopeSha256",
            "exportedAt",
            "files",
            "generator",
            "inputClass",
            "projectAlias",
            "rights",
            "schemaVersion",
            "sourceCommit",
            "tenantAlias",
        },
        "export manifest",
    )
    if manifest_bytes != canonical_bytes(manifest) + b"\n":
        raise ValueError("export manifest is not exact canonical JSON")
    if manifest.get("schemaVersion") != SCHEMA_EXPORT:
        raise ValueError("export manifest schema is unsupported")
    if manifest.get("inputClass") not in {"accepted-physical-capture", "benchmark-fixture"}:
        raise ValueError("export input class is invalid")
    if COMMIT.fullmatch(str(manifest.get("sourceCommit"))) is None:
        raise ValueError("export source commit is invalid")
    validate_envelope_shape(envelope)
    envelope_bytes = canonical_bytes(envelope)
    if envelope_file_bytes != envelope_bytes:
        raise ValueError("envelope.json is not exact canonical JSON")
    envelope_sha = sha256_bytes(envelope_bytes)
    if manifest.get("envelopeSha256") != envelope_sha:
        raise ValueError("canonical envelope hash mismatch")
    physical_root_name_is_valid = root.name == envelope_sha or (
        physical_root_alias is not None and root.name == physical_root_alias
    )
    if manifest.get("inputClass") == "accepted-physical-capture" and (
        not physical_root_name_is_valid or manifest.get("acceptedAt") is None
    ):
        raise ValueError("physical export root or acceptance record is invalid")
    if manifest.get("rights") != envelope.get("rights"):
        raise ValueError("manifest rights do not match the accepted envelope")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 10_000:
        raise ValueError("export file list is invalid")
    expected_paths = {"envelope.json", "export-manifest.json"}
    seen_paths: set[str] = set()
    by_source: dict[str, dict[str, Any]] = {}
    for raw in entries:
        entry = as_object(raw, "export file")
        exact_keys(
            entry,
            {"byteSize", "contentType", "kind", "path", "sha256", "sourceId"},
            "export file",
        )
        relative = safe_relative(str(entry.get("path"))).as_posix()
        source_id = str(entry.get("sourceId"))
        byte_size = entry.get("byteSize")
        if (
            relative in seen_paths
            or source_id in by_source
            or UUID.fullmatch(source_id) is None
            or isinstance(byte_size, bool)
            or not isinstance(byte_size, int)
            or not 0 < byte_size <= MAX_DOWNLOAD_BYTES
            or SHA256.fullmatch(str(entry.get("sha256"))) is None
            or not isinstance(entry.get("contentType"), str)
            or entry.get("kind")
            not in {
                "depth-original",
                "rgb-original",
                "roomplan-original",
                "roomplan-package-metadata",
            }
        ):
            raise ValueError("export file declaration is invalid")
        seen_paths.add(relative)
        expected_paths.add(relative)
        file_path = root.joinpath(*PurePosixPath(relative).parts)
        resolved = file_path.resolve(strict=True)
        if root not in resolved.parents:
            raise ValueError("export file escapes its root")
        private_node(file_path, directory=False)
        if file_path.stat().st_size != byte_size or sha256_file(file_path) != entry.get("sha256"):
            raise ValueError("export file bytes do not match their manifest")
        by_source[source_id] = entry
    actual_paths: set[str] = set()
    for node in root.rglob("*"):
        if node.is_symlink():
            raise ValueError("links are forbidden anywhere in an export")
        if node.is_dir():
            private_node(node, directory=True)
        elif node.is_file():
            private_node(node, directory=False)
            actual_paths.add(node.relative_to(root).as_posix())
        else:
            raise ValueError("special files are forbidden anywhere in an export")
    if actual_paths != expected_paths:
        raise ValueError("export contains missing or unlisted files")
    expected_sources: set[str] = set()
    for raw in cast("list[object]", envelope["mediaSources"]):
        source = as_object(raw, "media source")
        source_id = str(source["assetId"])
        media_entry = by_source.get(source_id)
        if (
            media_entry is None
            or media_entry.get("kind") != "rgb-original"
            or media_entry.get("contentType") != source.get("mimeType")
            or media_entry.get("sha256") != source.get("sha256")
            or media_entry.get("byteSize") != source.get("byteSize")
        ):
            raise ValueError("RGB source is not exactly represented in the export")
        expected_sources.add(source_id)
    for raw in cast("list[object]", envelope["depthSources"]):
        source = as_object(raw, "depth source")
        source_id = str(source["artifactId"])
        depth_entry = by_source.get(source_id)
        if (
            depth_entry is None
            or depth_entry.get("kind") != "depth-original"
            or depth_entry.get("contentType") != "application/octet-stream"
            or depth_entry.get("sha256") != source.get("sha256")
            or depth_entry.get("byteSize") != source.get("byteSize")
        ):
            raise ValueError("depth source is not exactly represented in the export")
        expected_sources.add(source_id)
    for raw in cast("list[object]", envelope["roomPlanSources"]):
        reference = as_object(raw, "RoomPlan reference")
        package_id = str(reference["packageId"])
        package_entry = by_source.get(package_id)
        if package_entry is None or package_entry.get("kind") != "roomplan-package-metadata":
            raise ValueError("RoomPlan package metadata is missing")
        package_path = root.joinpath(*safe_relative(str(package_entry["path"])).parts)
        package_bytes = package_path.read_bytes()
        package = as_object(json.loads(package_bytes), "RoomPlan package")
        exact_keys(
            package,
            {"createdAt", "id", "manifest", "manifestSha256", "projectId", "schemaVersion"},
            "RoomPlan package",
        )
        package_manifest = as_object(package.get("manifest"), "RoomPlan manifest")
        if (
            package_bytes != canonical_bytes(package)
            or package.get("id") != package_id
            or package.get("projectId") != envelope.get("projectId")
            or package_manifest.get("captureSessionId") != reference.get("captureSessionId")
            or package_manifest.get("projectId") != envelope.get("projectId")
            or package.get("manifestSha256") != reference.get("packageManifestSha256")
            or sha256_bytes(canonical_bytes(package_manifest)) != package.get("manifestSha256")
        ):
            raise ValueError("RoomPlan package is not exactly bound to the accepted envelope")
        artifacts = package_manifest.get("artifacts")
        if not isinstance(artifacts, list):
            raise ValueError("RoomPlan package artifacts are invalid")
        expected_sources.add(package_id)
        for raw_artifact in artifacts:
            artifact = as_object(raw_artifact, "RoomPlan artifact")
            required_artifact = {"artifactId", "byteSize", "contentType", "kind", "sha256"}
            if set(artifact) not in {
                frozenset(required_artifact),
                frozenset(required_artifact | {"roomId"}),
            }:
                raise ValueError("RoomPlan artifact fields do not match the frozen schema")
            artifact_id = str(artifact.get("artifactId"))
            artifact_entry = by_source.get(artifact_id)
            if (
                artifact_entry is None
                or artifact_entry.get("kind") != "roomplan-original"
                or artifact_entry.get("contentType") != artifact.get("contentType")
                or artifact_entry.get("sha256") != artifact.get("sha256")
                or artifact_entry.get("byteSize") != artifact.get("byteSize")
            ):
                raise ValueError("RoomPlan artifact is not exactly represented in the export")
            expected_sources.add(artifact_id)
    if set(by_source) != expected_sources:
        raise ValueError("export contains an unbound source file")
    return manifest, envelope


def build_selection(manifest: dict[str, Any], envelope: dict[str, Any]) -> dict[str, object]:
    by_source = {
        cast("str", entry["sourceId"]): entry
        for raw in cast("list[object]", manifest["files"])
        for entry in [as_object(raw, "file")]
        if entry.get("kind") == "rgb-original"
    }
    media_kind = {
        cast("str", source["assetId"]): source["kind"]
        for raw in cast("list[object]", envelope["mediaSources"])
        for source in [as_object(raw, "media source")]
    }
    segments = {
        cast("str", segment["segmentId"]): segment
        for raw in cast("list[object]", envelope["coordinateSegments"])
        for segment in [as_object(raw, "segment")]
    }
    rooms = [as_object(raw, "room") for raw in cast("list[object]", envelope["rooms"])]
    samples = [
        as_object(raw, "camera sample") for raw in cast("list[object]", envelope["cameraSamples"])
    ]
    samples.sort(
        key=lambda item: (
            cast("str", item["segmentId"]),
            cast("int", item["timestampMicroseconds"]),
            cast("str", item["sampleId"]),
        )
    )
    cohorts: dict[str, object] = {}
    for cohort, allowed in (
        ("normal", {"normal"}),
        ("inclusive", {"normal", "limited-initializing", "limited-motion", "limited-features"}),
    ):
        selected_segments: list[dict[str, object]] = []
        exclusions: list[dict[str, str]] = []
        for segment_id in sorted(segments):
            frames: list[dict[str, object]] = []
            coverage = {"missing": 0, "observed": 0, "occluded": 0, "total": 0}
            for room in rooms:
                if segment_id not in cast("list[str]", room["coordinateSegmentIds"]):
                    continue
                for raw_cell in cast("list[object]", room["coverage"]):
                    cell = as_object(raw_cell, "coverage cell")
                    status = cast("str", cell["status"])
                    coverage[status] += 1
                    coverage["total"] += 1
            for sample in (item for item in samples if item["segmentId"] == segment_id):
                source_id = cast("str", sample["sourceAssetId"])
                source = by_source.get(source_id)
                reason: str | None = None
                if sample.get("trackingState") not in allowed:
                    tracking_reason = str(sample.get("trackingState")).upper().replace("-", "_")
                    reason = f"TRACKING_{tracking_reason}"
                elif media_kind.get(source_id) != "rgb-keyframe":
                    reason = "RGB_KEYFRAME_REQUIRED"
                elif source is None:
                    reason = "RGB_SOURCE_ABSENT"
                if reason is not None:
                    exclusions.append(
                        {
                            "reason": reason,
                            "sampleId": cast("str", sample["sampleId"]),
                            "segmentId": segment_id,
                        }
                    )
                    continue
                if source is None:
                    raise ValueError("selected RGB source binding is unavailable")
                frames.append(
                    {
                        "blurScoreMillionths": sample["blurScoreMillionths"],
                        "cameraIntrinsicsMicropixels": sample["cameraIntrinsicsMicropixels"],
                        "exposureScoreMillionths": sample["exposureScoreMillionths"],
                        "imagePath": source["path"],
                        "imageSha256": source["sha256"],
                        "motionScoreMillionths": sample["motionScoreMillionths"],
                        "orientation": sample["orientation"],
                        "orientationTransform": "none-intrinsics-bind-native-raster",
                        "quaternionNanounits": sample["quaternionNanounits"],
                        "roomId": sample["roomId"],
                        "sampleId": sample["sampleId"],
                        "sourceAssetId": source_id,
                        "timestampMicroseconds": sample["timestampMicroseconds"],
                        "trackingState": sample["trackingState"],
                        "translationMicrometres": sample["translationMicrometres"],
                    }
                )
            selected_segments.append(
                {"coverageDenominator": coverage, "frames": frames, "segmentId": segment_id}
            )
        cohorts[cohort] = {"exclusions": exclusions, "segments": selected_segments}
    return {
        "cohorts": cohorts,
        "envelopeSha256": manifest["envelopeSha256"],
        "exportManifestSha256": sha256_bytes(canonical_bytes(manifest) + b"\n"),
        "inputClass": manifest["inputClass"],
        "ordering": ["segmentId", "timestampMicroseconds", "sampleId"],
        "productionAuthority": "none-proposal-only",
        "schemaVersion": SCHEMA_SELECTION,
    }


def write_selection(args: argparse.Namespace) -> None:
    root = Path(args.export_root)
    manifest, envelope = verify_export(root)
    selection = build_selection(manifest, envelope)
    output = Path(args.output)
    if (
        not output.is_absolute()
        or output.parent.resolve() != output.parent
        or output.parent.is_symlink()
    ):
        raise ValueError("selection output must be an absolute normalized path in a real directory")
    private_write(output, canonical_bytes(selection) + b"\n")
    print(json.dumps({"output": str(output), "sha256": sha256_file(output)}, sort_keys=True))


def load_selection(
    export_root: Path,
    selection_path: Path,
    *,
    physical_root_alias: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    manifest, envelope = verify_export(export_root, physical_root_alias=physical_root_alias)
    if selection_path.is_symlink() or not selection_path.is_file():
        raise ValueError("selection must be a regular file")
    selection_bytes = selection_path.read_bytes()
    selection = as_object(json.loads(selection_bytes), "selection")
    if selection_bytes != canonical_bytes(selection) + b"\n":
        raise ValueError("selection is not exact canonical JSON")
    expected = build_selection(manifest, envelope)
    if selection != expected:
        raise ValueError("selection is not the deterministic selection for this verified export")
    return manifest, envelope, selection


def selected_segment(
    selection: dict[str, Any], cohort_name: str, segment_id: str
) -> dict[str, Any]:
    cohort = as_object(as_object(selection["cohorts"], "cohorts").get(cohort_name), "cohort")
    segment = next(
        (
            as_object(raw, "segment")
            for raw in cast("list[object]", cohort["segments"])
            if as_object(raw, "segment").get("segmentId") == segment_id
        ),
        None,
    )
    if segment is None:
        raise ValueError("selection does not contain the requested segment")
    return segment


def ordered_frame_indices(frame_count: int, sample_count: int | None) -> tuple[int, ...]:
    if frame_count < 2:
        raise ValueError("COLMAP requires at least two selected frames")
    if sample_count is None:
        return tuple(range(frame_count))
    if not 2 <= sample_count <= frame_count:
        raise ValueError("ordered sample count must be between two and the frame count")
    denominator = sample_count - 1
    indices = tuple(
        (index * (frame_count - 1) + denominator // 2) // denominator
        for index in range(sample_count)
    )
    if len(set(indices)) != sample_count or indices[0] != 0 or indices[-1] != frame_count - 1:
        raise ValueError("ordered frame sampling did not produce unique endpoints")
    return indices


def selected_colmap_frames(
    frames: list[dict[str, Any]], sample_count: int | None
) -> list[tuple[int, dict[str, Any]]]:
    return [
        (index + 1, frames[index]) for index in ordered_frame_indices(len(frames), sample_count)
    ]


def colmap_image_name(frame: dict[str, Any], *, capture_index: int | None = None) -> str:
    suffix = PurePosixPath(cast("str", frame["imagePath"])).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png"}:
        raise ValueError("COLMAP baseline supports selected JPEG/PNG keyframes only")
    sample_name = cast("str", frame["sampleId"]) + suffix
    if capture_index is None:
        return sample_name
    if not 1 <= capture_index <= 999_999:
        raise ValueError("capture index is outside the ordered filename range")
    return f"{capture_index:06d}-{sample_name}"


def write_colmap_input(args: argparse.Namespace) -> None:
    export_root = Path(args.export_root)
    _, _, selection = load_selection(export_root, Path(args.selection))
    segment = selected_segment(selection, args.cohort, args.segment_id)
    frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
    ordered_image_names = bool(getattr(args, "ordered_image_names", False))
    ordered_sample_count = getattr(args, "ordered_sample_count", None)
    selected_frames = selected_colmap_frames(frames, ordered_sample_count)
    output = Path(args.output)
    safe_root(output, create=True)
    images = output / "images"
    images.mkdir(mode=0o700)
    records: list[dict[str, object]] = []
    for capture_index, frame in selected_frames:
        source = export_root.joinpath(*PurePosixPath(cast("str", frame["imagePath"])).parts)
        name = colmap_image_name(
            frame, capture_index=capture_index if ordered_image_names else None
        )
        destination = images / name
        private_copy(source, destination)
        if sha256_file(destination) != frame["imageSha256"]:
            raise ValueError("derived COLMAP input copy changed immutable RGB bytes")
        records.append(
            {
                "captureIndex": capture_index,
                "imageName": name,
                "imageSha256": frame["imageSha256"],
                "sampleId": frame["sampleId"],
            }
        )
    input_manifest = {
        "authority": "proposal-only-input-copy",
        "cohort": args.cohort,
        "frames": records,
        "imageOrder": "capture-order" if ordered_image_names else "sample-id-lexical",
        "sampling": (
            "full"
            if ordered_sample_count is None
            else f"ordered-quantile-{ordered_sample_count}-v1"
        ),
        "schemaVersion": (
            "c14-10-ordered-colmap-input-v2" if ordered_image_names else "c14-9-colmap-input-v1"
        ),
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
    }
    private_write(output / "colmap-input.json", canonical_bytes(input_manifest) + b"\n")
    print(json.dumps({"frameCount": len(selected_frames), "output": str(output)}, sort_keys=True))


def rotation_from_quaternion(values: object) -> tuple[tuple[float, float, float], ...]:
    raw = cast("list[object]", values)
    if len(raw) != 4 or any(isinstance(value, bool) or not isinstance(value, int) for value in raw):
        raise ValueError("camera quaternion is invalid")
    x, y, z, w = (cast("int", value) / 1_000_000_000 for value in raw)
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if not 0.99 <= length <= 1.01:
        raise ValueError("camera quaternion is not normalized")
    x, y, z, w = x / length, y / length, z / length, w / length
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
        (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
        (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
    )


def world_to_camera(frame: dict[str, Any]) -> tuple[list[float], list[float]]:
    rotation_cw = rotation_from_quaternion(frame["quaternionNanounits"])
    arkit_world_to_camera = tuple(
        tuple(rotation_cw[column][row] for column in range(3)) for row in range(3)
    )
    # ARKit cameras are x-right, y-up and look down -z. COLMAP and Open3D
    # consume OpenCV cameras (x-right, y-down, look down +z), so apply the
    # fixed 180-degree camera-space rotation about x after inverting c2w.
    camera_axis_flip = (1.0, -1.0, -1.0)
    rotation_wc = tuple(
        tuple(camera_axis_flip[row] * arkit_world_to_camera[row][column] for column in range(3))
        for row in range(3)
    )
    translation = as_object(frame["translationMicrometres"], "translation")
    centre = [cast("int", translation[axis]) / 1_000_000 for axis in ("x", "y", "z")]
    offset = [
        -sum(rotation_wc[row][column] * centre[column] for column in range(3)) for row in range(3)
    ]
    matrix = [
        rotation_wc[0][0],
        rotation_wc[0][1],
        rotation_wc[0][2],
        offset[0],
        rotation_wc[1][0],
        rotation_wc[1][1],
        rotation_wc[1][2],
        offset[1],
        rotation_wc[2][0],
        rotation_wc[2][1],
        rotation_wc[2][2],
        offset[2],
        0.0,
        0.0,
        0.0,
        1.0,
    ]
    quaternion = cast("list[int]", frame["quaternionNanounits"])
    x, y, z, w = (value / 1e9 for value in quaternion)
    length = math.sqrt(x * x + y * y + z * z + w * w)
    # q(OpenCV camera <- ARKit camera) * inverse(q(camera -> world)).
    colmap_q = [x / length, w / length, z / length, -y / length]
    if colmap_q[0] < 0:
        colmap_q = [-value for value in colmap_q]
    return matrix, colmap_q + offset


def write_colmap_prior(args: argparse.Namespace) -> None:
    export_root = Path(args.export_root)
    _, _, selection = load_selection(export_root, Path(args.selection))
    segment = selected_segment(selection, args.cohort, args.segment_id)
    frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
    ordered_image_names = bool(getattr(args, "ordered_image_names", False))
    ordered_sample_count = getattr(args, "ordered_sample_count", None)
    selected_frames = selected_colmap_frames(frames, ordered_sample_count)
    database_ids: dict[str, tuple[int, int]] = {}
    if args.database is not None:
        database = Path(args.database)
        if database.is_symlink() or not database.is_file():
            raise ValueError("COLMAP database must be a regular file")
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
            database_ids = {
                name: (image_id, camera_id)
                for image_id, name, camera_id in connection.execute(
                    "SELECT image_id,name,camera_id FROM images"
                )
            }
    output = Path(args.output)
    safe_root(output, create=True)
    camera_lines = [
        "# Camera list generated from immutable ARKit priors",
        "# CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]",
    ]
    image_lines = [
        "# Image list; poses are world-to-camera proposal diagnostics",
        "# IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
        "# POINTS2D[]",
    ]
    transform_records: list[dict[str, object]] = []
    used_ids: set[int] = set()
    for output_index, (capture_index, frame) in enumerate(selected_frames, start=1):
        image_name = colmap_image_name(
            frame, capture_index=capture_index if ordered_image_names else None
        )
        image_id, camera_id = database_ids.get(image_name, (output_index, output_index))
        if database_ids and image_name not in database_ids:
            raise ValueError("COLMAP database image names do not match the immutable selection")
        if image_id in used_ids:
            raise ValueError("COLMAP database contains duplicate selected image IDs")
        used_ids.add(image_id)
        intrinsics = as_object(frame["cameraIntrinsicsMicropixels"], "intrinsics")
        width = cast("int", intrinsics["imageWidthPixels"])
        height = cast("int", intrinsics["imageHeightPixels"])
        parameters = [cast("int", intrinsics[key]) / 1e6 for key in ("fx", "fy", "cx", "cy")]
        camera_lines.append(
            f"{camera_id} PINHOLE {width} {height} "
            + " ".join(f"{value:.12g}" for value in parameters)
        )
        matrix, pose = world_to_camera(frame)
        image_lines.append(
            f"{image_id} "
            + " ".join(f"{value:.17g}" for value in pose)
            + f" {camera_id} {image_name}"
        )
        image_lines.append("")
        transform_records.append(
            {
                "captureIndex": capture_index,
                "imageName": image_name,
                "sampleId": frame["sampleId"],
                "worldToCamera": matrix,
            }
        )
    private_write(output / "cameras.txt", ("\n".join(camera_lines) + "\n").encode())
    private_write(output / "images.txt", ("\n".join(image_lines) + "\n").encode())
    private_write(
        output / "points3D.txt", b"# Empty; point_triangulator supplies proposal points.\n"
    )
    prior = {
        "authority": "proposal-only-arkit-prior-diagnostic",
        "cohort": args.cohort,
        "frames": transform_records,
        "imageOrder": "capture-order" if ordered_image_names else "sample-id-lexical",
        "sampling": (
            "full"
            if ordered_sample_count is None
            else f"ordered-quantile-{ordered_sample_count}-v1"
        ),
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
        "sourceCoordinateSystem": "arkit-right-handed-y-up-camera-to-world",
        "targetCoordinateSystem": "colmap-world-to-camera",
        "translationUnit": "metres-from-arkit-not-independently-validated",
    }
    private_write(output / "prior-manifest.json", canonical_bytes(prior) + b"\n")
    print(json.dumps({"frameCount": len(selected_frames), "output": str(output)}, sort_keys=True))


def verified_experimental_candidates(root: Path | None) -> tuple[set[str], dict[str, str]]:
    if root is None:
        return set(), {}
    root = safe_root(root)
    registry_path = PACKAGE_ROOT / "experimental-candidates.json"
    registry = as_object(json.loads(registry_path.read_bytes()), "registry")
    registry_sha256 = sha256_file(registry_path)
    verified: set[str] = set()
    failures: dict[str, str] = {}
    for raw in cast("list[object]", registry["candidates"]):
        candidate = as_object(raw, "candidate")
        candidate_id = cast("str", candidate["candidateId"])
        code = as_object(candidate["code"], "code")
        weight = as_object(candidate["weight"], "weight")
        expected_hash = weight.get("sha256")
        if expected_hash is None:
            failures[candidate_id] = "WEIGHT_HASH_UNAVAILABLE"
            continue
        try:
            candidate_root = confined_path(root, candidate_id, directory=True)
        except (OSError, ValueError):
            failures[candidate_id] = "SOURCE_OR_WEIGHT_VERIFICATION_FAILED"
            continue
        try:
            try:
                manifest_path = confined_path(
                    candidate_root, "candidate-manifest.json", directory=False
                )
            except (OSError, ValueError):
                failures[candidate_id] = "DEPENDENCY_LOCK_AND_IMAGE_REQUIRED"
                continue
            manifest_bytes = manifest_path.read_bytes()
            manifest = as_object(json.loads(manifest_bytes), "candidate manifest")
            source = confined_path(candidate_root, "source", directory=True)
            weight_path = confined_path(
                candidate_root, cast("str", weight["file"]), directory=False
            )
            if manifest_bytes != canonical_bytes(manifest) + b"\n":
                raise ValueError
            if (
                set(manifest)
                != {
                    "candidateId",
                    "dependencyLockPath",
                    "dependencyLockSha256",
                    "imageSha256",
                    "registrySha256",
                }
                or manifest.get("candidateId") != candidate_id
            ):
                raise ValueError
            if manifest.get("registrySha256") != registry_sha256:
                raise ValueError
            lock_path = confined_path(
                candidate_root, cast("str", manifest["dependencyLockPath"]), directory=False
            )
            if sha256_file(lock_path) != manifest.get("dependencyLockSha256"):
                raise ValueError
            image_sha256 = cast("str", manifest["imageSha256"])
            if IMAGE_DIGEST.fullmatch(image_sha256) is None:
                raise ValueError
            inspected = json.loads(
                subprocess.run(
                    ["docker", "image", "inspect", image_sha256],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
            )
            if len(inspected) != 1 or inspected[0].get("Id") != image_sha256:
                raise ValueError
            if not (source / ".git").exists():
                raise ValueError
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=source, check=True, capture_output=True, text=True
            ).stdout.strip()
            if (
                head != code["commit"]
                or sha256_file(weight_path) != expected_hash
                or weight_path.stat().st_size != weight.get("sizeBytes")
            ):
                raise ValueError
            source_status = subprocess.run(
                ["git", "status", "--porcelain=v1", "--untracked-files=all"],
                cwd=source,
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            if source_status:
                raise ValueError
            if code.get("recursive") is True:
                status = subprocess.run(
                    ["git", "submodule", "status", "--recursive"],
                    cwd=source,
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
                if any(line.startswith(("-", "+", "U")) for line in status.splitlines()):
                    raise ValueError
                actual_submodules = {
                    line[42:].split(" ", maxsplit=1)[0]: line[1:41]
                    for line in status.splitlines()
                    if len(line) >= 43
                }
                expected_submodules = as_object(code.get("submodules"), "submodules")
                if actual_submodules != expected_submodules:
                    raise ValueError
            verified.add(candidate_id)
        except (json.JSONDecodeError, OSError, ValueError, subprocess.CalledProcessError):
            failures[candidate_id] = "SOURCE_OR_WEIGHT_VERIFICATION_FAILED"
    return verified, failures


def add_candidate(
    target: list[dict[str, object]],
    candidate_id: str,
    eligible: bool,
    reasons: list[str],
    role: str,
) -> None:
    target.append(
        {
            "candidateId": candidate_id,
            "role": role,
            "status": "selected" if eligible and not reasons else "abstained",
            "reasons": reasons if reasons else [],
        }
    )


def write_policy(args: argparse.Namespace) -> None:
    export_root = Path(args.export_root)
    _, envelope, selection = load_selection(export_root, Path(args.selection))
    verified, candidate_failures = verified_experimental_candidates(
        None if args.candidate_root is None else Path(args.candidate_root)
    )
    depth_sample_ids = {
        cast("str", sample_id)
        for raw in cast("list[object]", envelope.get("depthSources", []))
        for sample_id in cast("list[object]", as_object(raw, "depth")["sampleIds"])
    }
    capabilities = as_object(envelope["capabilities"], "capabilities")
    plans: list[dict[str, object]] = []
    for cohort_name, cohort_raw in as_object(selection["cohorts"], "cohorts").items():
        cohort = as_object(cohort_raw, "cohort")
        for segment_raw in cast("list[object]", cohort["segments"]):
            segment = as_object(segment_raw, "segment")
            frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
            frame_ids = {cast("str", frame["sampleId"]) for frame in frames}
            count = len(frames)
            calibrated = all(
                "cameraIntrinsicsMicropixels" in frame and "quaternionNanounits" in frame
                for frame in frames
            )
            depth_bound_frame_count = len(frame_ids.intersection(depth_sample_ids))
            has_depth = depth_bound_frame_count > 0
            candidates: list[dict[str, object]] = []
            add_candidate(
                candidates,
                "colmap-unconstrained",
                count >= 2,
                [] if count >= 2 else ["INSUFFICIENT_RGB_FRAMES"],
                "geometry-proposal-baseline",
            )
            add_candidate(
                candidates,
                "colmap-arkit-prior",
                count >= 2 and calibrated,
                [] if count >= 2 and calibrated else ["INSUFFICIENT_CALIBRATED_FRAMES"],
                "pose-prior-diagnostic",
            )
            add_candidate(
                candidates,
                "open3d-known-pose-tsdf",
                has_depth and calibrated,
                [] if has_depth and calibrated else ["EXACT_BOUND_DEPTH_ABSENT"],
                "known-pose-depth-proposal",
            )
            add_candidate(
                candidates,
                "gsplat-direct",
                count >= 3 and calibrated,
                [] if count >= 3 and calibrated else ["INSUFFICIENT_CALIBRATED_HOLDOUT_VIEWS"],
                "appearance-only",
            )
            for candidate_id, minimum, role in (
                ("vggt-1b-commercial", 2, "proposal-only-cameras-depth-point-map"),
                ("mast3r-vitlarge-512", 2, "proposal-only-matching-point-map"),
                ("metric-video-depth-anything-small", 3, "proposal-only-temporal-metric-depth"),
            ):
                reasons: list[str] = []
                if count < minimum:
                    reasons.append("INSUFFICIENT_RGB_FRAMES")
                if candidate_id not in verified:
                    reasons.append(
                        candidate_failures.get(
                            candidate_id, "PINNED_SOURCE_AND_WEIGHT_NOT_VERIFIED"
                        )
                    )
                if candidate_id == "vggt-1b-commercial":
                    reasons.append("LICENCE_ACCEPTANCE_REQUIRED")
                add_candidate(
                    candidates,
                    candidate_id,
                    count >= minimum and candidate_id in verified,
                    sorted(set(reasons)),
                    role,
                )
            plans.append(
                {
                    "candidates": candidates,
                    "cohort": cohort_name,
                    "frameCount": count,
                    "segmentId": segment["segmentId"],
                }
            )
    policy = {
        "capabilities": {
            key: capabilities[key]
            for key in (
                "cameraIntrinsics",
                "cameraPoses",
                "rgbKeyframes",
                "rgbVideo",
                "roomPlan",
                "sceneDepth",
            )
        },
        "inputEnvelopeSha256": selection["envelopeSha256"],
        "plans": plans,
        "productionAuthority": "none-evaluation-only",
        "resourceProfiles": {
            "baseline": {
                "cpus": 12,
                "memoryGiB": 24,
                "pids": 512,
                "scratchGiB": 12,
                "timeoutMinutes": 30,
                "vramGiB": 14,
            },
            "experimental": {
                "cpus": 12,
                "memoryGiB": 32,
                "pids": 512,
                "scratchGiB": 16,
                "timeoutMinutes": 45,
                "vramGiB": 15,
            },
        },
        "schemaVersion": SCHEMA_POLICY,
        "selectionSha256": sha256_file(Path(args.selection)),
    }
    output = Path(args.output)
    if not output.is_absolute() or not output.parent.is_dir() or output.parent.is_symlink():
        raise ValueError("policy output must be an absolute path in a real directory")
    private_write(output, canonical_bytes(policy) + b"\n")
    print(json.dumps({"output": str(output), "sha256": sha256_file(output)}, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="export one accepted physical envelope")
    export.add_argument("--base-url", required=True)
    export.add_argument("--project-id", required=True)
    export.add_argument("--capture-session-id", required=True)
    export.add_argument("--output-parent", required=True)
    export.add_argument("--source-commit", required=True)
    export.set_defaults(function=export_capture)
    verify = commands.add_parser("verify", help="verify an export without network access")
    verify.add_argument("--export-root", required=True)
    verify.set_defaults(
        function=lambda values: print(
            json.dumps(
                {
                    "envelopeSha256": verify_export(Path(values.export_root))[0]["envelopeSha256"],
                    "verified": True,
                },
                sort_keys=True,
            )
        )
    )
    select = commands.add_parser(
        "select", help="write deterministic normal and inclusive selections"
    )
    select.add_argument("--export-root", required=True)
    select.add_argument("--output", required=True)
    select.set_defaults(function=write_selection)
    prior = commands.add_parser(
        "colmap-prior", help="write one segment's ARKit-prior COLMAP text model"
    )
    prior.add_argument("--export-root", required=True)
    prior.add_argument("--selection", required=True)
    prior.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    prior.add_argument("--segment-id", required=True)
    prior.add_argument("--database")
    prior.add_argument("--ordered-image-names", action="store_true")
    prior.add_argument("--ordered-sample-count", type=int)
    prior.add_argument("--output", required=True)
    prior.set_defaults(function=write_colmap_prior)
    colmap_input = commands.add_parser(
        "colmap-input", help="copy one immutable segment into a flat COLMAP image root"
    )
    colmap_input.add_argument("--export-root", required=True)
    colmap_input.add_argument("--selection", required=True)
    colmap_input.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    colmap_input.add_argument("--segment-id", required=True)
    colmap_input.add_argument("--ordered-image-names", action="store_true")
    colmap_input.add_argument("--ordered-sample-count", type=int)
    colmap_input.add_argument("--output", required=True)
    colmap_input.set_defaults(function=write_colmap_input)
    policy = commands.add_parser(
        "policy", help="write an offline non-production routing evaluation"
    )
    policy.add_argument("--export-root", required=True)
    policy.add_argument("--selection", required=True)
    policy.add_argument("--candidate-root")
    policy.add_argument("--output", required=True)
    policy.set_defaults(function=write_policy)
    return parser


def main() -> None:
    try:
        args = build_parser().parse_args()
        args.function(args)
    except (
        OSError,
        ValueError,
        RuntimeError,
        subprocess.CalledProcessError,
        json.JSONDecodeError,
    ) as error:
        print(f"capture benchmark failed: {error}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
