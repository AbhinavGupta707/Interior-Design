"""Strict proposal authority and deterministic manifest hash tests."""

from dataclasses import replace
from pathlib import Path

import pytest
from inference_worker.reconstruction.common.errors import ReconstructionError
from inference_worker.reconstruction.common.hashing import canonical_json_bytes, sha256_json
from inference_worker.reconstruction.common.manifest import (
    CameraSetDescriptor,
    ComponentDescriptor,
    DiagnosticFinding,
    GeometryArtifactDescriptor,
    GeometryProposalManifest,
    HashOnlyArtifactPublisher,
    ToolManifest,
)


def _tool() -> ToolManifest:
    return ToolManifest(
        adapter_id="fixture-adapter",
        adapter_version="1.0.0",
        executable_version="fixture-1.0",
        config_sha256=sha256_json({"fixed": True}),
        execution_evidence="fixture-executable",
    )


def test_manifest_is_proposal_only_source_tool_config_pinned_and_stable(tmp_path: Path) -> None:
    source_hash = sha256_json({"source": "synthetic-rights-cleared", "training": "denied"})
    tool = _tool()
    publisher = HashOnlyArtifactPublisher()
    camera_file = tmp_path / "cameras.json"
    point_file = tmp_path / "points.ply"
    diagnostics_file = tmp_path / "diagnostics.json"
    camera_file.write_bytes(canonical_json_bytes({"camera": "synthetic"}))
    point_file.write_bytes(b"ply\nformat ascii 1.0\nelement vertex 0\nend_header\n")
    diagnostics_file.write_bytes(canonical_json_bytes({"code": "GEOMETRY_PROPOSAL_ONLY"}))
    camera = publisher.publish(
        camera_file,
        kind="calibrated-cameras",
        media_type="application/json",
        source_manifest_sha256=source_hash,
        tool_manifest_sha256=tool.manifest_sha256,
    )
    points = publisher.publish(
        point_file,
        kind="sparse-point-cloud",
        media_type="application/ply",
        source_manifest_sha256=source_hash,
        tool_manifest_sha256=tool.manifest_sha256,
    )
    diagnostics = publisher.publish(
        diagnostics_file,
        kind="diagnostics",
        media_type="application/json",
        source_manifest_sha256=source_hash,
        tool_manifest_sha256=tool.manifest_sha256,
    )
    key = "1" * 64
    manifest = GeometryProposalManifest(
        mode="colmap-sparse",
        status="completed",
        source_manifest_sha256=source_hash,
        tool=tool,
        input_frame_count=1,
        registered_frame_count=1,
        components=(ComponentDescriptor("component-1", 1, 0, (key,)),),
        camera_set=CameraSetDescriptor(camera, 1),
        geometry=(GeometryArtifactDescriptor(points, 0, 0, "unknown", "arbitrary-units"),),
        diagnostics_artifact=diagnostics,
        findings=(DiagnosticFinding("GEOMETRY_PROPOSAL_ONLY", "info"),),
        scale_status="unknown",
        unit="arbitrary-units",
    )

    assert manifest.to_json()["authority"] == "proposal-only"
    assert manifest.to_json()["manifestSha256"] == manifest.manifest_sha256
    assert manifest.to_bytes() == manifest.to_bytes()
    assert b"proposal-only-no-survey-claim" in manifest.to_bytes().lower()
    assert b"path" not in manifest.to_bytes().lower()

    mismatched_points = replace(points, source_manifest_sha256="b" * 64)
    with pytest.raises(ReconstructionError, match="INVALID_MANIFEST"):
        replace(
            manifest,
            geometry=(replace(manifest.geometry[0], artifact=mismatched_points),),
        )


def test_unknown_scale_cannot_claim_metric_units_or_validated_without_alignment(
    tmp_path: Path,
) -> None:
    source_hash = "a" * 64
    tool = _tool()
    publisher = HashOnlyArtifactPublisher()
    diagnostic_file = tmp_path / "diagnostic.json"
    diagnostic_file.write_text("{}", encoding="utf-8")
    diagnostic = publisher.publish(
        diagnostic_file,
        kind="diagnostics",
        media_type="application/json",
        source_manifest_sha256=source_hash,
        tool_manifest_sha256=tool.manifest_sha256,
    )
    with pytest.raises(ReconstructionError, match="INVALID_MANIFEST"):
        GeometryProposalManifest(
            mode="colmap-sparse",
            status="abstained",
            source_manifest_sha256=source_hash,
            tool=tool,
            input_frame_count=1,
            registered_frame_count=0,
            components=(),
            camera_set=None,
            geometry=(),
            diagnostics_artifact=diagnostic,
            findings=(DiagnosticFinding("SAFE_ABSTENTION", "error"),),
            scale_status="unknown",
            unit="micrometres",
        )


def test_canonical_manifest_hash_rejects_non_finite_values() -> None:
    with pytest.raises(ReconstructionError, match="NON_FINITE_VALUE"):
        sha256_json({"hostile": float("nan")})
