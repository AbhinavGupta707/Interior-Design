"""Private C8 worker-protocol composition tests."""

import hashlib
from pathlib import Path

import pytest
from inference_worker.reconstruction.common import BinaryRegistry
from inference_worker.reconstruction.worker_protocol import execute_protocol


def request(root: Path) -> dict[str, object]:
    first = root / "first.png"
    second = root / "second.png"
    first.write_bytes(b"synthetic-first")
    second.write_bytes(b"synthetic-second")
    first_sha = hashlib.sha256(first.read_bytes()).hexdigest()
    second_sha = hashlib.sha256(second.read_bytes()).hexdigest()
    first_id = "26f47f9e-2a8a-4d10-b3af-bcc8bcda4f81"
    second_id = "4c365e99-7b76-49cc-9153-35ab332a23a5"
    prepared_frames = [
        {
            "blurScoreMillionths": 900_000,
            "exposureScoreMillionths": 900_000,
            "frameId": first_id,
            "heightPixels": 24,
            "metadataStripped": True,
            "overlapScoreMillionths": 0,
            "redactionStatus": "not-required",
            "sanitizedSha256": first_sha,
            "sourceAssetId": "45a12f8a-7e8a-427e-8a97-0379df4ca450",
            "timestampMicroseconds": 0,
            "widthPixels": 32,
        },
        {
            "blurScoreMillionths": 900_000,
            "exposureScoreMillionths": 900_000,
            "frameId": second_id,
            "heightPixels": 24,
            "metadataStripped": True,
            "overlapScoreMillionths": 800_000,
            "redactionStatus": "not-required",
            "sanitizedSha256": second_sha,
            "sourceAssetId": "45a12f8a-7e8a-427e-8a97-0379df4ca450",
            "timestampMicroseconds": 1_000_000,
            "widthPixels": 32,
        },
    ]
    return {
        "attempt": 1,
        "appearanceMode": "disabled",
        "frames": [
            {
                "frameId": first_id,
                "path": str(first),
                "sha256": first_sha,
            },
            {
                "frameId": second_id,
                "path": str(second),
                "sha256": second_sha,
            },
        ],
        "inputRoot": str(root),
        "jobId": "420f1e9a-5e08-452a-a8ab-794f095388d7",
        "jobSourceManifestSha256": "3" * 64,
        "mode": "rgb-sfm",
        "prepared": {
            "frames": prepared_frames,
            "jobId": "420f1e9a-5e08-452a-a8ab-794f095388d7",
            "manifestSha256": "4" * 64,
            "privacyStatus": "accepted",
            "projectId": "3ad4e2b0-394b-4d4d-ad24-083160491672",
            "schemaVersion": "c8-media-preparation-v1",
            "sourceManifestSha256": "3" * 64,
            "tool": {
                "adapterId": "ffmpeg-media-prep",
                "adapterVersion": "1.0.0",
                "configSha256": "5" * 64,
                "executableVersion": "synthetic",
            },
        },
        "projectId": "3ad4e2b0-394b-4d4d-ad24-083160491672",
        "registrationAnchors": [],
        "rights": {
            "basis": "owned-by-user",
            "serviceProcessingConsent": True,
            "trainingUseConsent": "denied",
        },
    }


def test_registered_but_unavailable_colmap_returns_bounded_abstention(tmp_path: Path) -> None:
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    output = execute_protocol(
        request(inputs), output_root=tmp_path / "output", registry=BinaryRegistry({})
    )
    private = output["privateArtifacts"]
    assert isinstance(private, list) and len(private) == 1
    record = private[0]
    assert isinstance(record, dict)
    assert output["result"] == {
        "diagnosticArtifact": record["artifact"],
        "findings": ["COLMAP_NOT_INSTALLED"],
        "safeCode": "COLMAP_NOT_INSTALLED",
        "status": "abstained",
    }
    assert Path(str(record["privatePath"])).is_file()
    assert "privatePath" not in str(record["artifact"])


def test_protocol_rejects_paths_outside_the_attempt_root(tmp_path: Path) -> None:
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    value = request(inputs)
    outside = tmp_path / "outside.png"
    outside.write_bytes(b"outside")
    frames = value["frames"]
    assert isinstance(frames, list) and isinstance(frames[0], dict)
    frames[0]["path"] = str(outside)
    with pytest.raises(ValueError, match="PROTOCOL_FRAME_INVALID"):
        execute_protocol(value, output_root=tmp_path / "output", registry=BinaryRegistry({}))


def test_protocol_rejects_unknown_mode_before_execution(tmp_path: Path) -> None:
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    value = request(inputs)
    value["mode"] = "arbitrary"
    with pytest.raises(ValueError, match="PROTOCOL_MODE_UNSUPPORTED"):
        execute_protocol(value, output_root=tmp_path / "output", registry=BinaryRegistry({}))
