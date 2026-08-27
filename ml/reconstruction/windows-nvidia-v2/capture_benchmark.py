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
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, cast

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
    if not base_url.startswith(("http://", "https://")) or token.strip() != token or not token:
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
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"API request failed with status {response.status}")
            return as_object(json.load(response), "API response")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"API request failed with status {error.code}") from None
    except urllib.error.URLError:
        raise RuntimeError("API request failed before a response was received") from None


def download_verified(url: str, destination: Path, size: int, expected_sha256: str) -> None:
    if size <= 0 or size > MAX_DOWNLOAD_BYTES or SHA256.fullmatch(expected_sha256) is None:
        raise ValueError("declared download size or hash is invalid")
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    digest = hashlib.sha256()
    written = 0
    try:
        with os.fdopen(descriptor, "wb") as output:
            try:
                response: BinaryIO = urllib.request.urlopen(url, timeout=120)
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
    subprocess.run(["git", "diff", "--quiet"], cwd=REPOSITORY_ROOT, check=True)
    subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPOSITORY_ROOT, check=True)
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
    for source_value in cast("list[object]", envelope.get("mediaSources", [])):
        source = as_object(source_value, "media source")
        asset_id = cast("str", source.get("assetId"))
        content_type = cast("str", source.get("mimeType"))
        access = api_json(
            args.base_url,
            f"/v1/projects/{project_id}/assets/{asset_id}/access",
            token,
            body={"representation": "original"},
            idempotency_key=str(
                uuid.uuid5(uuid.NAMESPACE_URL, f"c14.9:{envelope_sha}:asset:{asset_id}")
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
                f"/v1/projects/{project_id}/capture-sessions/{session_id}/artifacts/{artifact_id}/access",
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
        "envelopeId": acceptance.get("envelopeId"),
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


def verify_export(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    root = safe_root(root)
    manifest_path = root / "export-manifest.json"
    envelope_path = root / "envelope.json"
    for path in (manifest_path, envelope_path):
        if path.is_symlink() or not path.is_file():
            raise ValueError("export is missing a regular authority file")
    manifest = as_object(json.loads(manifest_path.read_bytes()), "export manifest")
    envelope = as_object(json.loads(envelope_path.read_bytes()), "envelope")
    if manifest.get("schemaVersion") != SCHEMA_EXPORT:
        raise ValueError("export manifest schema is unsupported")
    envelope_bytes = canonical_bytes(envelope)
    if envelope_path.read_bytes() != envelope_bytes:
        raise ValueError("envelope.json is not exact canonical JSON")
    if manifest.get("envelopeSha256") != sha256_bytes(envelope_bytes):
        raise ValueError("canonical envelope hash mismatch")
    if manifest.get("rights") != envelope.get("rights"):
        raise ValueError("manifest rights do not match the accepted envelope")
    forbidden_keys = {"authorization", "bearerToken", "objectKey", "signedUrl", "url"}
    if forbidden_keys.intersection(manifest):
        raise ValueError("export manifest contains a forbidden secret-bearing field")
    entries = manifest.get("files")
    if not isinstance(entries, list) or len(entries) > 10_000:
        raise ValueError("export file list is invalid")
    expected = {"envelope.json", "export-manifest.json"}
    seen: set[str] = set()
    by_source: dict[str, dict[str, Any]] = {}
    for raw in entries:
        entry = as_object(raw, "export file")
        relative = safe_relative(cast("str", entry.get("path"))).as_posix()
        if relative in seen:
            raise ValueError("export contains duplicate file paths")
        seen.add(relative)
        expected.add(relative)
        path = root.joinpath(*PurePosixPath(relative).parts)
        if path.resolve().parent == root.parent or root not in path.resolve().parents:
            raise ValueError("export file escapes its root")
        if path.is_symlink() or not path.is_file():
            raise ValueError("export entry is not a regular file")
        if path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
            raise ValueError("export file is not private")
        if path.stat().st_size != entry.get("byteSize") or sha256_file(path) != entry.get("sha256"):
            raise ValueError("export file bytes do not match their manifest")
        source_id = entry.get("sourceId")
        if isinstance(source_id, str):
            by_source[source_id] = entry
    actual: set[str] = set()
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("links are forbidden anywhere in an export")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != expected:
        raise ValueError("export contains missing or unlisted files")
    for raw in cast("list[object]", envelope.get("mediaSources", [])):
        source = as_object(raw, "media source")
        source_entry = by_source.get(cast("str", source.get("assetId")))
        if (
            source_entry is None
            or source_entry.get("sha256") != source.get("sha256")
            or source_entry.get("byteSize") != source.get("byteSize")
        ):
            raise ValueError("RGB source is not exactly represented in the export")
    for raw in cast("list[object]", envelope.get("depthSources", [])):
        source = as_object(raw, "depth source")
        source_entry = by_source.get(cast("str", source.get("artifactId")))
        if (
            source_entry is None
            or source_entry.get("sha256") != source.get("sha256")
            or source_entry.get("byteSize") != source.get("byteSize")
        ):
            raise ValueError("depth source is not exactly represented in the export")
    return manifest, envelope


def write_selection(args: argparse.Namespace) -> None:
    root = Path(args.export_root)
    manifest, envelope = verify_export(root)
    by_source = {
        cast("str", entry["sourceId"]): entry
        for raw in cast("list[object]", manifest["files"])
        for entry in [as_object(raw, "file")]
        if entry.get("kind") == "rgb-original"
    }
    segments = {
        cast("str", segment["segmentId"]): segment
        for raw in cast("list[object]", envelope.get("coordinateSegments", []))
        for segment in [as_object(raw, "segment")]
    }
    samples = [
        as_object(raw, "camera sample")
        for raw in cast("list[object]", envelope.get("cameraSamples", []))
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
            for sample in (item for item in samples if item["segmentId"] == segment_id):
                source_id = cast("str", sample["sourceAssetId"])
                source = by_source.get(source_id)
                if sample.get("trackingState") not in allowed:
                    tracking_reason = str(sample.get("trackingState")).upper().replace("-", "_")
                    exclusions.append(
                        {
                            "reason": f"TRACKING_{tracking_reason}",
                            "sampleId": cast("str", sample["sampleId"]),
                        }
                    )
                    continue
                if source is None:
                    exclusions.append(
                        {"reason": "RGB_SOURCE_ABSENT", "sampleId": cast("str", sample["sampleId"])}
                    )
                    continue
                frames.append(
                    {
                        "blurScoreMillionths": sample["blurScoreMillionths"],
                        "cameraIntrinsicsMicropixels": sample["cameraIntrinsicsMicropixels"],
                        "exposureScoreMillionths": sample["exposureScoreMillionths"],
                        "imagePath": source["path"],
                        "imageSha256": source["sha256"],
                        "orientation": sample["orientation"],
                        "motionScoreMillionths": sample["motionScoreMillionths"],
                        "quaternionNanounits": sample["quaternionNanounits"],
                        "roomId": sample["roomId"],
                        "sampleId": sample["sampleId"],
                        "sourceAssetId": source_id,
                        "timestampMicroseconds": sample["timestampMicroseconds"],
                        "trackingState": sample["trackingState"],
                        "translationMicrometres": sample["translationMicrometres"],
                    }
                )
            selected_segments.append({"frames": frames, "segmentId": segment_id})
        cohorts[cohort] = {"exclusions": exclusions, "segments": selected_segments}
    selection = {
        "cohorts": cohorts,
        "envelopeSha256": manifest["envelopeSha256"],
        "exportManifestSha256": sha256_file(root / "export-manifest.json"),
        "inputClass": manifest["inputClass"],
        "ordering": ["segmentId", "timestampMicroseconds", "sampleId"],
        "productionAuthority": "none-proposal-only",
        "schemaVersion": SCHEMA_SELECTION,
    }
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
    export_root: Path, selection_path: Path
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    manifest, envelope = verify_export(export_root)
    if selection_path.is_symlink() or not selection_path.is_file():
        raise ValueError("selection must be a regular file")
    selection = as_object(json.loads(selection_path.read_bytes()), "selection")
    if (
        selection.get("schemaVersion") != SCHEMA_SELECTION
        or selection.get("envelopeSha256") != manifest.get("envelopeSha256")
        or selection.get("exportManifestSha256")
        != sha256_file(export_root / "export-manifest.json")
    ):
        raise ValueError("selection is not bound to this verified export")
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


def colmap_image_name(frame: dict[str, Any]) -> str:
    suffix = PurePosixPath(cast("str", frame["imagePath"])).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png"}:
        raise ValueError("COLMAP baseline supports selected JPEG/PNG keyframes only")
    return cast("str", frame["sampleId"]) + suffix


def write_colmap_input(args: argparse.Namespace) -> None:
    export_root = Path(args.export_root)
    _, _, selection = load_selection(export_root, Path(args.selection))
    segment = selected_segment(selection, args.cohort, args.segment_id)
    frames = [as_object(raw, "frame") for raw in cast("list[object]", segment["frames"])]
    if len(frames) < 2:
        raise ValueError("COLMAP requires at least two selected frames")
    output = Path(args.output)
    safe_root(output, create=True)
    images = output / "images"
    images.mkdir(mode=0o700)
    records: list[dict[str, object]] = []
    for frame in frames:
        source = export_root.joinpath(*PurePosixPath(cast("str", frame["imagePath"])).parts)
        name = colmap_image_name(frame)
        destination = images / name
        private_copy(source, destination)
        if sha256_file(destination) != frame["imageSha256"]:
            raise ValueError("derived COLMAP input copy changed immutable RGB bytes")
        records.append(
            {"imageName": name, "imageSha256": frame["imageSha256"], "sampleId": frame["sampleId"]}
        )
    input_manifest = {
        "authority": "proposal-only-input-copy",
        "cohort": args.cohort,
        "frames": records,
        "schemaVersion": "c14-9-colmap-input-v1",
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
    }
    private_write(output / "colmap-input.json", canonical_bytes(input_manifest) + b"\n")
    print(json.dumps({"frameCount": len(frames), "output": str(output)}, sort_keys=True))


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
    rotation_wc = tuple(tuple(rotation_cw[column][row] for column in range(3)) for row in range(3))
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
    colmap_q = [
        quaternion[3] / 1e9,
        -quaternion[0] / 1e9,
        -quaternion[1] / 1e9,
        -quaternion[2] / 1e9,
    ]
    return matrix, colmap_q + offset


def write_colmap_prior(args: argparse.Namespace) -> None:
    export_root = Path(args.export_root)
    _, _, selection = load_selection(export_root, Path(args.selection))
    segment = selected_segment(selection, args.cohort, args.segment_id)
    frames = cast("list[object]", segment["frames"])
    if len(frames) < 2:
        raise ValueError("ARKit-prior COLMAP requires at least two selected frames")
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
    for index, raw in enumerate(frames, start=1):
        frame = as_object(raw, "frame")
        image_name = colmap_image_name(frame)
        image_id, camera_id = database_ids.get(image_name, (index, index))
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
            {"imageName": image_name, "sampleId": frame["sampleId"], "worldToCamera": matrix}
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
        "segmentId": args.segment_id,
        "selectionSha256": sha256_file(Path(args.selection)),
        "sourceCoordinateSystem": "arkit-right-handed-y-up-camera-to-world",
        "targetCoordinateSystem": "colmap-world-to-camera",
        "translationUnit": "metres-from-arkit-not-independently-validated",
    }
    private_write(output / "prior-manifest.json", canonical_bytes(prior) + b"\n")
    print(json.dumps({"frameCount": len(frames), "output": str(output)}, sort_keys=True))


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
        candidate_root = root / candidate_id
        source = candidate_root / "source"
        weight_path = candidate_root / cast("str", weight["file"])
        if expected_hash is None:
            failures[candidate_id] = "WEIGHT_HASH_UNAVAILABLE"
            continue
        try:
            manifest_path = candidate_root / "candidate-manifest.json"
            if manifest_path.is_symlink() or not manifest_path.is_file():
                failures[candidate_id] = "DEPENDENCY_LOCK_AND_IMAGE_REQUIRED"
                continue
            manifest = as_object(json.loads(manifest_path.read_bytes()), "candidate manifest")
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
            lock_relative = safe_relative(cast("str", manifest["dependencyLockPath"]))
            lock_path = candidate_root.joinpath(*lock_relative.parts)
            if (
                lock_path.is_symlink()
                or not lock_path.is_file()
                or sha256_file(lock_path) != manifest.get("dependencyLockSha256")
            ):
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
            if (
                source.is_symlink()
                or not (source / ".git").exists()
                or weight_path.is_symlink()
                or not weight_path.is_file()
            ):
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
            subprocess.run(["git", "diff", "--quiet"], cwd=source, check=True)
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
                if any(
                    actual_submodules.get(path) != commit
                    for path, commit in expected_submodules.items()
                ):
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
    quality = as_object(envelope["quality"], "quality")
    camera_count = len(cast("list[object]", envelope["cameraSamples"]))
    majority_unusable = cast("int", quality["unusableBlurSampleCount"]) * 2 >= camera_count
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
            has_depth = bool(frame_ids.intersection(depth_sample_ids))
            candidates: list[dict[str, object]] = []
            quality_reasons = ["QUALITY_UNUSABLE_BLUR_MAJORITY"] if majority_unusable else []
            add_candidate(
                candidates,
                "colmap-unconstrained",
                count >= 2,
                quality_reasons + ([] if count >= 2 else ["INSUFFICIENT_RGB_FRAMES"]),
                "geometry-proposal-baseline",
            )
            add_candidate(
                candidates,
                "colmap-arkit-prior",
                count >= 2 and calibrated,
                quality_reasons
                + ([] if count >= 2 and calibrated else ["INSUFFICIENT_CALIBRATED_FRAMES"]),
                "pose-prior-diagnostic",
            )
            add_candidate(
                candidates,
                "open3d-known-pose-tsdf",
                has_depth and calibrated,
                quality_reasons
                + ([] if has_depth and calibrated else ["EXACT_BOUND_DEPTH_ABSENT"]),
                "known-pose-depth-proposal",
            )
            add_candidate(
                candidates,
                "gsplat-direct",
                count >= 3 and calibrated,
                quality_reasons
                + ([] if count >= 3 and calibrated else ["INSUFFICIENT_CALIBRATED_HOLDOUT_VIEWS"]),
                "appearance-only",
            )
            for candidate_id, minimum, role in (
                ("vggt-1b-commercial", 2, "proposal-only-cameras-depth-point-map"),
                ("mast3r-vitlarge-512", 2, "proposal-only-matching-point-map"),
                ("metric-video-depth-anything-small", 3, "proposal-only-temporal-metric-depth"),
            ):
                reasons = list(quality_reasons)
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
    prior.add_argument("--output", required=True)
    prior.set_defaults(function=write_colmap_prior)
    colmap_input = commands.add_parser(
        "colmap-input", help="copy one immutable segment into a flat COLMAP image root"
    )
    colmap_input.add_argument("--export-root", required=True)
    colmap_input.add_argument("--selection", required=True)
    colmap_input.add_argument("--cohort", choices=("normal", "inclusive"), required=True)
    colmap_input.add_argument("--segment-id", required=True)
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
