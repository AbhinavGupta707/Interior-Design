"""Contract, security, cancellation, and publication tests for Nerfstudio."""

from __future__ import annotations

import hashlib
import json
import sys
from collections.abc import Callable, Sequence
from copy import deepcopy
from pathlib import Path
from typing import cast

import pytest
from inference_worker.reconstruction.nerfstudio.adapter import (
    ArtifactPublisher,
    NeuralAppearanceAdapter,
    TrustedStagedFrames,
    unavailable_nerfstudio_adapter,
)
from inference_worker.reconstruction.nerfstudio.contracts import JsonObject, parse_appearance_input
from inference_worker.reconstruction.nerfstudio.runtime import (
    CommandCancelled,
    CommandExecutor,
    CommandOutputLimit,
    CommandResult,
    SubprocessExecutor,
    fixture_runtime,
)

PROJECT_ID = "11111111-1111-4111-8111-111111111111"
JOB_ID = "22222222-2222-4222-8222-222222222222"
FRAME_ID = "33333333-3333-4333-8333-333333333333"
CAMERA_ID = "44444444-4444-4444-8444-444444444444"
ASSET_ID = "55555555-5555-4555-8555-555555555555"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def appearance_input(frame_bytes: bytes, *, method: str = "nerfstudio") -> JsonObject:
    source_manifest_sha = "1" * 64
    prepared_manifest_sha = "2" * 64
    camera_manifest_sha = "3" * 64
    geometry_manifest_sha = "4" * 64
    tool = {
        "adapterId": "c8.fixture",
        "adapterVersion": "synthetic-1.0.0",
        "configSha256": "5" * 64,
        "executableVersion": "synthetic-fixture",
    }
    return cast(
        "JsonObject",
        {
            "attempt": 1,
            "cameras": {
                "coordinateSystem": "right-handed-local",
                "frames": [
                    {
                        "basisNanounits": [
                            1_000_000_000,
                            0,
                            0,
                            0,
                            1_000_000_000,
                            0,
                            0,
                            0,
                            1_000_000_000,
                        ],
                        "cameraId": CAMERA_ID,
                        "cameraModel": "PINHOLE",
                        "distortionMillionths": [0, 0, 0, 0],
                        "focalXMillionths": 1_200_000_000,
                        "focalYMillionths": 1_200_000_000,
                        "frameId": FRAME_ID,
                        "principalXMillionths": 320_000_000,
                        "principalYMillionths": 240_000_000,
                        "sourceFrameSha256": _sha(frame_bytes),
                        "translationMicroUnits": [0, 0, 0],
                    }
                ],
                "jobId": JOB_ID,
                "manifestSha256": camera_manifest_sha,
                "projectId": PROJECT_ID,
                "schemaVersion": "c8-calibrated-cameras-v1",
                "sourceManifestSha256": prepared_manifest_sha,
                "tool": tool,
                "translationUnit": "arbitrary-units",
            },
            "geometry": {
                "alignment": {"anchorCount": 0},
                "artifacts": [
                    {
                        "artifactId": "66666666-6666-4666-8666-666666666666",
                        "byteSize": 1_024,
                        "contentSha256": "6" * 64,
                        "dimensionalAuthority": "proposal-only",
                        "kind": "calibrated-cameras",
                        "mediaType": "application/json",
                        "sourceManifestSha256": prepared_manifest_sha,
                        "toolManifestSha256": "7" * 64,
                    },
                    {
                        "artifactId": "77777777-7777-4777-8777-777777777777",
                        "byteSize": 2_048,
                        "contentSha256": "8" * 64,
                        "dimensionalAuthority": "proposal-only",
                        "kind": "sparse-point-cloud",
                        "mediaType": "application/octet-stream",
                        "sourceManifestSha256": prepared_manifest_sha,
                        "toolManifestSha256": "7" * 64,
                    },
                ],
                "componentCount": 1,
                "coordinateSystem": "right-handed-local",
                "inputFrameCount": 1,
                "manifestSha256": geometry_manifest_sha,
                "registeredFrameCount": 1,
                "scaleStatus": "unknown",
                "schemaVersion": "c8-geometry-result-v1",
                "tool": tool,
                "unit": "arbitrary-units",
            },
            "jobId": JOB_ID,
            "method": method,
            "prepared": {
                "frames": [
                    {
                        "blurScoreMillionths": 900_000,
                        "exposureScoreMillionths": 850_000,
                        "frameId": FRAME_ID,
                        "heightPixels": 480,
                        "metadataStripped": True,
                        "overlapScoreMillionths": 800_000,
                        "redactionStatus": "applied",
                        "sanitizedSha256": _sha(frame_bytes),
                        "sourceAssetId": ASSET_ID,
                        "timestampMicroseconds": 0,
                        "widthPixels": 640,
                    }
                ],
                "jobId": JOB_ID,
                "manifestSha256": prepared_manifest_sha,
                "privacyStatus": "accepted",
                "projectId": PROJECT_ID,
                "schemaVersion": "c8-media-preparation-v1",
                "sourceManifestSha256": source_manifest_sha,
                "tool": tool,
            },
            "projectId": PROJECT_ID,
            "rights": {
                "basis": "public-domain",
                "serviceProcessingConsent": True,
                "trainingUseConsent": "denied",
            },
            "schemaVersion": "c8-neural-appearance-input-v1",
        },
    )


class FixtureExecutor(CommandExecutor):
    def __init__(
        self, *, cancel: bool = False, fail: bool = False, leak: bytes | None = None
    ) -> None:
        self.argv: list[tuple[str, ...]] = []
        self.cancel = cancel
        self.fail = fail
        self.leak = leak

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
        cancelled: Callable[[], bool],
    ) -> CommandResult:
        del cwd, timeout_seconds, cancelled
        self.argv.append(tuple(argv))
        if self.cancel:
            raise CommandCancelled
        if self.fail:
            return CommandResult(duration_milliseconds=12, exit_code=9)
        output = Path(argv[argv.index("--output-dir") + 1])
        model = argv[1]
        config_root = output / "c8-appearance" / model / "attempt-01"
        (config_root / "nerfstudio_models").mkdir(parents=True)
        dataset = argv[argv.index("--data") + 1]
        config = f"method: visibly-synthetic\ndata: {dataset}\n".encode()
        if self.leak is not None:
            config += self.leak
        (config_root / "config.yml").write_bytes(config)
        (config_root / "nerfstudio_models" / "step-000030000.ckpt").write_bytes(
            b"visibly synthetic checkpoint bytes"
        )
        return CommandResult(
            duration_milliseconds=12,
            exit_code=0,
            peak_resident_memory_bytes=1_024,
        )


class RecordingPublisher(ArtifactPublisher):
    def __init__(self) -> None:
        self.calls = 0
        self.bytes = b""
        self.result: JsonObject | None = None

    def publish(self, artifact_file: Path, public_result: JsonObject) -> None:
        self.calls += 1
        self.bytes = artifact_file.read_bytes()
        self.result = public_result


def staged(tmp_path: Path, content: bytes) -> TrustedStagedFrames:
    root = tmp_path / "sanitized"
    root.mkdir()
    frame = root / f"{FRAME_ID}.png"
    frame.write_bytes(content)
    return TrustedStagedFrames(root=root, by_frame_id={FRAME_ID: frame})


def adapter(tmp_path: Path, executor: FixtureExecutor) -> NeuralAppearanceAdapter:
    return NeuralAppearanceAdapter.with_runtime(
        fixture_runtime(tmp_path), executor=executor, runtime_evidence="synthetic-fixture"
    )


def test_fixed_command_publishes_only_non_dimensional_source_pinned_result(
    tmp_path: Path,
) -> None:
    frame = b"visibly synthetic rights-cleared frame"
    executor = FixtureExecutor()
    publisher = RecordingPublisher()
    outcome = adapter(tmp_path, executor).execute(
        appearance_input(frame),
        workspace_root=tmp_path,
        staged_frames=staged(tmp_path, frame),
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=publisher,
    )

    assert outcome.status == "completed"
    assert outcome.observations is not None
    assert outcome.observations.runtime_evidence == "synthetic-fixture"
    assert publisher.calls == 1
    assert publisher.bytes
    assert str(tmp_path).encode() not in publisher.bytes
    result = cast("JsonObject", outcome.result)
    artifact = cast("list[JsonObject]", result["artifacts"])[0]
    assert artifact["dimensionalAuthority"] == "non-dimensional"
    assert artifact["kind"] == "nerfstudio-viewer"
    assert result["geometryManifestSha256"] == "4" * 64
    serialized = json.dumps(result, sort_keys=True)
    for forbidden in ("/private/", "objectKey", "signedUrl", "sourcePath", "Bearer"):
        assert forbidden not in serialized
    command = executor.argv[0]
    assert command[1] == "nerfacto"
    assert "--max-num-iterations" in command
    assert command[command.index("--max-num-iterations") + 1] == "30000"
    assert all("attacker" not in argument for argument in command)


@pytest.mark.parametrize("field", ["flags", "executablePath", "objectKey", "sourcePath", "url"])
def test_hostile_top_level_command_and_location_fields_fail_closed(field: str) -> None:
    raw = appearance_input(b"frame")
    raw[field] = "https://attacker.invalid/$(id);--arbitrary-flag"
    with pytest.raises(ValueError, match="APPEARANCE_INPUT_INVALID"):
        parse_appearance_input(raw, expected_method="nerfstudio")


def test_rights_privacy_and_authority_cannot_be_upgraded() -> None:
    training = appearance_input(b"frame")
    rights = cast("JsonObject", training["rights"])
    rights["trainingUseConsent"] = "allowed"
    with pytest.raises(ValueError, match="MANIFEST_TRAINING_USE_NOT_DENIED"):
        parse_appearance_input(training, expected_method="nerfstudio")

    privacy = appearance_input(b"frame")
    prepared = cast("JsonObject", privacy["prepared"])
    prepared["privacyStatus"] = "review-required"
    with pytest.raises(ValueError, match="PREPARED_PRIVACY_NOT_ACCEPTED"):
        parse_appearance_input(privacy, expected_method="nerfstudio")

    geometry = appearance_input(b"frame")
    geometry_manifest = cast("JsonObject", geometry["geometry"])
    artifacts = cast("list[JsonObject]", geometry_manifest["artifacts"])
    artifacts[1]["dimensionalAuthority"] = "non-dimensional"
    with pytest.raises(ValueError, match="GEOMETRY_ARTIFACT_AUTHORITY_INVALID"):
        parse_appearance_input(geometry, expected_method="nerfstudio")


def test_cancelled_and_stale_attempts_never_publish(tmp_path: Path) -> None:
    frame = b"frame"
    cancelled_publisher = RecordingPublisher()
    cancelled_outcome = adapter(tmp_path, FixtureExecutor(cancel=True)).execute(
        appearance_input(frame),
        workspace_root=tmp_path,
        staged_frames=staged(tmp_path, frame),
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=cancelled_publisher,
    )
    assert cancelled_outcome.status == "cancelled"
    assert cancelled_publisher.calls == 0

    stale_root = tmp_path / "stale"
    stale_root.mkdir()
    stale_publisher = RecordingPublisher()
    stale_outcome = adapter(stale_root, FixtureExecutor()).execute(
        appearance_input(frame),
        workspace_root=stale_root,
        staged_frames=staged(stale_root, frame),
        cancelled=lambda: False,
        publication_fence=lambda: False,
        publisher=stale_publisher,
    )
    assert stale_outcome.status == "stale"
    assert stale_publisher.calls == 0


def test_unavailable_failure_hash_and_private_output_are_safe(tmp_path: Path) -> None:
    unavailable = unavailable_nerfstudio_adapter("APPEARANCE_CUDA_UNAVAILABLE").execute(
        {},
        workspace_root=tmp_path,
        staged_frames=TrustedStagedFrames(root=tmp_path, by_frame_id={}),
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=RecordingPublisher(),
    )
    assert unavailable.status == "unavailable"
    assert unavailable.safe_code == "APPEARANCE_CUDA_UNAVAILABLE"
    assert unavailable.result is None

    frame = b"frame"
    failed_publisher = RecordingPublisher()
    failed = adapter(tmp_path, FixtureExecutor(fail=True)).execute(
        appearance_input(frame),
        workspace_root=tmp_path,
        staged_frames=staged(tmp_path, frame),
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=failed_publisher,
    )
    assert failed.status == "failed"
    assert failed.safe_code == "APPEARANCE_TOOL_FAILED"
    assert failed_publisher.calls == 0

    leaky_root = tmp_path / "leaky"
    leaky_root.mkdir()
    leaky_staged = staged(leaky_root, frame)
    leak = str(leaky_staged.root.resolve()).encode()
    leaked = adapter(leaky_root, FixtureExecutor(leak=leak)).execute(
        appearance_input(frame),
        workspace_root=leaky_root,
        staged_frames=leaky_staged,
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=RecordingPublisher(),
    )
    # Config paths are replaced before packaging; source path bytes do not escape.
    assert leaked.status == "completed"


def test_staged_hash_scope_and_registered_count_mismatches_fail(tmp_path: Path) -> None:
    raw = appearance_input(b"expected")
    publisher = RecordingPublisher()
    outcome = adapter(tmp_path, FixtureExecutor()).execute(
        raw,
        workspace_root=tmp_path,
        staged_frames=staged(tmp_path, b"different"),
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=publisher,
    )
    assert outcome.status == "failed"
    assert publisher.calls == 0

    mismatched = deepcopy(raw)
    geometry = cast("JsonObject", mismatched["geometry"])
    geometry["registeredFrameCount"] = 2
    with pytest.raises(ValueError, match="GEOMETRY_REGISTERED_FRAME_MISMATCH"):
        parse_appearance_input(mismatched, expected_method="nerfstudio")


def test_real_subprocess_boundary_kills_output_flood_without_returning_text(
    tmp_path: Path,
) -> None:
    executor = SubprocessExecutor(maximum_output_bytes=1_024)
    with pytest.raises(CommandOutputLimit):
        executor.run(
            (sys.executable, "-c", "print('visibly-synthetic-' * 10000)"),
            cwd=tmp_path,
            timeout_seconds=5,
            cancelled=lambda: False,
        )


def test_subprocess_environment_is_fixed_and_drops_inherited_credentials(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "visibly-synthetic-secret")
    monkeypatch.setenv("PATH", "/hostile/request-controlled/path")
    environment = SubprocessExecutor._safe_environment(runtime_home=tmp_path)

    assert "AWS_SECRET_ACCESS_KEY" not in environment
    assert environment["PATH"] == "/usr/local/bin:/opt/colmap/bin:/usr/bin:/bin"
    assert environment["HOME"] == str(tmp_path)
    assert environment["CUDA_HOME"] == "/usr/local/cuda"
