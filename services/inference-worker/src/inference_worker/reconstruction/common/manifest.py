"""Strict proposal-only descriptors shared by COLMAP and Open3D adapters."""

import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from .alignment import AlignmentReport, ScaleStatus
from .errors import ReconstructionError
from .hashing import JsonObject, canonical_json_bytes, sha256_file, sha256_json, validate_sha256

ADAPTER_MANIFEST_SCHEMA_VERSION = "c8-geometry-adapter-manifest-v1"
TOOL_ID_PATTERN = re.compile(r"^[a-z][a-z0-9.-]{2,79}$")
SAFE_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{2,79}$")
MAXIMUM_ARTIFACT_BYTES = 53_687_091_200

ArtifactKind = Literal[
    "calibrated-cameras", "sparse-point-cloud", "dense-point-cloud", "triangle-mesh", "diagnostics"
]
GeometryUnit = Literal["micrometres", "arbitrary-units"]
ProposalStatus = Literal["completed", "partial", "abstained"]


@dataclass(frozen=True, slots=True)
class ToolManifest:
    adapter_id: str
    adapter_version: str
    executable_version: str
    config_sha256: str
    execution_evidence: Literal["system-installed", "fixture-executable", "not-run-unavailable"]

    def __post_init__(self) -> None:
        if self.execution_evidence not in {
            "system-installed",
            "fixture-executable",
            "not-run-unavailable",
        }:
            raise ReconstructionError("INVALID_MANIFEST", "execution evidence is invalid")
        if TOOL_ID_PATTERN.fullmatch(self.adapter_id) is None:
            raise ReconstructionError("INVALID_MANIFEST", "adapter identifier is invalid")
        if not self.adapter_version.strip() or len(self.adapter_version) > 100:
            raise ReconstructionError("INVALID_MANIFEST", "adapter version is invalid")
        if not self.executable_version.strip() or len(self.executable_version) > 100:
            raise ReconstructionError("INVALID_MANIFEST", "executable version is invalid")
        validate_sha256(self.config_sha256, name="config sha256")

    def to_json(self) -> JsonObject:
        return {
            "adapterId": self.adapter_id,
            "adapterVersion": self.adapter_version,
            "configSha256": self.config_sha256,
            "executableVersion": self.executable_version,
            "executionEvidence": self.execution_evidence,
        }

    @property
    def manifest_sha256(self) -> str:
        return sha256_json(self.to_json())


@dataclass(frozen=True, slots=True)
class ArtifactDescriptor:
    artifact_id: str
    kind: ArtifactKind
    media_type: str
    byte_size: int
    content_sha256: str
    source_manifest_sha256: str
    tool_manifest_sha256: str
    dimensional_authority: Literal["proposal-only"] = "proposal-only"

    def __post_init__(self) -> None:
        if (
            self.kind
            not in {
                "calibrated-cameras",
                "sparse-point-cloud",
                "dense-point-cloud",
                "triangle-mesh",
                "diagnostics",
            }
            or self.dimensional_authority != "proposal-only"
        ):
            raise ReconstructionError("INVALID_MANIFEST", "artifact authority or kind is invalid")
        try:
            uuid.UUID(self.artifact_id)
        except ValueError as error:
            raise ReconstructionError(
                "INVALID_MANIFEST", "artifact identifier is invalid"
            ) from error
        if not 0 < self.byte_size <= MAXIMUM_ARTIFACT_BYTES:
            raise ReconstructionError("RESOURCE_LIMIT", "artifact byte size is invalid")
        if re.fullmatch(r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$", self.media_type) is None:
            raise ReconstructionError("INVALID_MANIFEST", "artifact media type is invalid")
        validate_sha256(self.content_sha256, name="artifact sha256")
        validate_sha256(self.source_manifest_sha256, name="source manifest sha256")
        validate_sha256(self.tool_manifest_sha256, name="tool manifest sha256")

    def to_json(self) -> JsonObject:
        return {
            "artifactId": self.artifact_id,
            "byteSize": self.byte_size,
            "contentSha256": self.content_sha256,
            "dimensionalAuthority": self.dimensional_authority,
            "kind": self.kind,
            "mediaType": self.media_type,
            "sourceManifestSha256": self.source_manifest_sha256,
            "toolManifestSha256": self.tool_manifest_sha256,
        }


class ArtifactPublisher(Protocol):
    """Storage-owned publication port; implementations must return no locator."""

    def publish(
        self,
        local_path: Path,
        *,
        kind: ArtifactKind,
        media_type: str,
        source_manifest_sha256: str,
        tool_manifest_sha256: str,
    ) -> ArtifactDescriptor: ...


class HashOnlyArtifactPublisher:
    """Descriptor-only publisher for synthetic adapter evidence.

    This does not retain artifact bytes and must not be represented as live
    object-storage publication.
    """

    def publish(
        self,
        local_path: Path,
        *,
        kind: ArtifactKind,
        media_type: str,
        source_manifest_sha256: str,
        tool_manifest_sha256: str,
    ) -> ArtifactDescriptor:
        content_sha256, byte_size = sha256_file(local_path, maximum_bytes=MAXIMUM_ARTIFACT_BYTES)
        identifier = uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"c8:{kind}:{content_sha256}:{source_manifest_sha256}:{tool_manifest_sha256}",
        )
        return ArtifactDescriptor(
            artifact_id=str(identifier),
            kind=kind,
            media_type=media_type,
            byte_size=byte_size,
            content_sha256=content_sha256,
            source_manifest_sha256=source_manifest_sha256,
            tool_manifest_sha256=tool_manifest_sha256,
        )


@dataclass(frozen=True, slots=True)
class ComponentDescriptor:
    component_id: str
    registered_frame_count: int
    point_count: int
    registered_frame_key_sha256s: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.component_id or len(self.component_id) > 100:
            raise ReconstructionError("INVALID_MANIFEST", "component identifier is invalid")
        if not 1 <= self.registered_frame_count <= 10_000 or self.point_count < 0:
            raise ReconstructionError("INVALID_MANIFEST", "component counts are invalid")
        if len(self.registered_frame_key_sha256s) != self.registered_frame_count:
            raise ReconstructionError("INVALID_MANIFEST", "component frame count disagrees")
        for value in self.registered_frame_key_sha256s:
            validate_sha256(value, name="registered frame key sha256")

    def to_json(self) -> JsonObject:
        return {
            "componentId": self.component_id,
            "pointCount": self.point_count,
            "registeredFrameCount": self.registered_frame_count,
            "registeredFrameKeySha256s": list(self.registered_frame_key_sha256s),
        }


@dataclass(frozen=True, slots=True)
class CameraSetDescriptor:
    artifact: ArtifactDescriptor
    camera_count: int
    pose_convention: Literal["world-to-camera"] = "world-to-camera"
    coordinate_system: Literal["right-handed-local"] = "right-handed-local"

    def __post_init__(self) -> None:
        if (
            self.artifact.kind != "calibrated-cameras"
            or not 1 <= self.camera_count <= 10_000
            or self.pose_convention != "world-to-camera"
            or self.coordinate_system != "right-handed-local"
        ):
            raise ReconstructionError("INVALID_MANIFEST", "camera descriptor is invalid")

    def to_json(self) -> JsonObject:
        return {
            "artifact": self.artifact.to_json(),
            "cameraCount": self.camera_count,
            "coordinateSystem": self.coordinate_system,
            "poseConvention": self.pose_convention,
        }


@dataclass(frozen=True, slots=True)
class GeometryArtifactDescriptor:
    artifact: ArtifactDescriptor
    vertex_count: int
    triangle_count: int
    scale_status: ScaleStatus
    unit: GeometryUnit

    def __post_init__(self) -> None:
        if self.artifact.kind not in {"sparse-point-cloud", "dense-point-cloud", "triangle-mesh"}:
            raise ReconstructionError("INVALID_MANIFEST", "geometry artifact kind is invalid")
        if self.vertex_count < 0 or self.triangle_count < 0:
            raise ReconstructionError("INVALID_MANIFEST", "geometry counts are invalid")
        if self.scale_status not in {"metric-validated", "metric-estimated", "unknown"}:
            raise ReconstructionError("INVALID_MANIFEST", "geometry scale status is invalid")
        if self.unit not in {"micrometres", "arbitrary-units"}:
            raise ReconstructionError("INVALID_MANIFEST", "geometry unit is invalid")
        if (self.scale_status == "unknown") != (self.unit == "arbitrary-units"):
            raise ReconstructionError("INVALID_MANIFEST", "unknown scale must use arbitrary units")

    def to_json(self) -> JsonObject:
        return {
            "artifact": self.artifact.to_json(),
            "scaleStatus": self.scale_status,
            "triangleCount": self.triangle_count,
            "unit": self.unit,
            "vertexCount": self.vertex_count,
        }


@dataclass(frozen=True, slots=True)
class DiagnosticFinding:
    code: str
    severity: Literal["info", "warning", "error"]
    count: int = 1

    def __post_init__(self) -> None:
        if (
            SAFE_CODE_PATTERN.fullmatch(self.code) is None
            or self.severity not in {"info", "warning", "error"}
            or not 1 <= self.count <= 1_000_000_000
        ):
            raise ReconstructionError("INVALID_MANIFEST", "diagnostic finding is invalid")

    def to_json(self) -> JsonObject:
        return {"code": self.code, "count": self.count, "severity": self.severity}


def _alignment_json(alignment: AlignmentReport | None) -> JsonObject:
    if alignment is None:
        return {
            "anchorCount": 0,
            "authority": "proposal-only-no-survey-claim",
            "residualP90Micrometres": None,
            "thresholdMicrometres": None,
        }
    return {
        "anchorCount": len(alignment.inlier_anchor_ids) + len(alignment.outlier_anchor_ids),
        "authority": alignment.authority,
        "inlierAnchorIds": list(alignment.inlier_anchor_ids),
        "outlierAnchorIds": list(alignment.outlier_anchor_ids),
        "residualMaximumMicrometres": int(math_floor_half_up(alignment.residual_maximum)),
        "residualP50Micrometres": int(math_floor_half_up(alignment.residual_p50)),
        "residualP90Micrometres": int(math_floor_half_up(alignment.residual_p90)),
        "thresholdMicrometres": int(math_floor_half_up(alignment.threshold)),
    }


def math_floor_half_up(value: float) -> int:
    if value < 0:
        raise ReconstructionError("INVALID_MANIFEST", "distance cannot be negative")
    return int(value + 0.5)


@dataclass(frozen=True, slots=True)
class GeometryProposalManifest:
    mode: Literal["colmap-sparse", "colmap-cuda-dense", "open3d-known-pose-tsdf"]
    status: ProposalStatus
    source_manifest_sha256: str
    tool: ToolManifest
    input_frame_count: int
    registered_frame_count: int
    components: tuple[ComponentDescriptor, ...]
    camera_set: CameraSetDescriptor | None
    geometry: tuple[GeometryArtifactDescriptor, ...]
    diagnostics_artifact: ArtifactDescriptor
    findings: tuple[DiagnosticFinding, ...]
    scale_status: ScaleStatus
    unit: GeometryUnit
    alignment: AlignmentReport | None = None
    tsdf_parameters: JsonObject | None = None
    authority: Literal["proposal-only"] = "proposal-only"
    schema_version: Literal["c8-geometry-adapter-manifest-v1"] = "c8-geometry-adapter-manifest-v1"

    def __post_init__(self) -> None:
        if self.mode not in {"colmap-sparse", "colmap-cuda-dense", "open3d-known-pose-tsdf"}:
            raise ReconstructionError("INVALID_MANIFEST", "geometry mode is invalid")
        if self.status not in {"completed", "partial", "abstained"}:
            raise ReconstructionError("INVALID_MANIFEST", "proposal status is invalid")
        if self.scale_status not in {"metric-validated", "metric-estimated", "unknown"}:
            raise ReconstructionError("INVALID_MANIFEST", "scale status is invalid")
        if self.unit not in {"micrometres", "arbitrary-units"}:
            raise ReconstructionError("INVALID_MANIFEST", "geometry unit is invalid")
        if (
            self.authority != "proposal-only"
            or self.schema_version != ADAPTER_MANIFEST_SCHEMA_VERSION
        ):
            raise ReconstructionError("INVALID_MANIFEST", "proposal authority or schema is invalid")
        validate_sha256(self.source_manifest_sha256, name="source manifest sha256")
        if not 1 <= self.input_frame_count <= 10_000:
            raise ReconstructionError("INVALID_MANIFEST", "input frame count is invalid")
        if not 0 <= self.registered_frame_count <= self.input_frame_count:
            raise ReconstructionError("INVALID_MANIFEST", "registered frame count is invalid")
        if not 0 <= len(self.components) <= 1_000:
            raise ReconstructionError("INVALID_MANIFEST", "component count is invalid")
        if sum(component.registered_frame_count for component in self.components) != (
            self.registered_frame_count
        ):
            raise ReconstructionError("INVALID_MANIFEST", "component frame counts disagree")
        if self.diagnostics_artifact.kind != "diagnostics":
            raise ReconstructionError("INVALID_MANIFEST", "diagnostics artifact has wrong kind")
        if (self.scale_status == "unknown") != (self.unit == "arbitrary-units"):
            raise ReconstructionError("INVALID_MANIFEST", "scale and unit disagree")
        if self.scale_status == "metric-validated" and self.alignment is None:
            raise ReconstructionError(
                "INVALID_MANIFEST", "validated scale needs alignment evidence"
            )
        if self.alignment is not None and self.scale_status != self.alignment.scale_status:
            raise ReconstructionError("INVALID_MANIFEST", "alignment and scale status disagree")
        if self.status == "abstained" and (self.camera_set is not None or self.geometry):
            raise ReconstructionError("INVALID_MANIFEST", "abstention cannot carry geometry")
        if self.status != "abstained" and (self.camera_set is None or not self.geometry):
            raise ReconstructionError("INVALID_MANIFEST", "proposal requires cameras and geometry")
        if (
            self.camera_set is not None
            and self.camera_set.camera_count != self.registered_frame_count
        ):
            raise ReconstructionError("INVALID_MANIFEST", "camera and registration counts disagree")
        artifacts = [self.diagnostics_artifact]
        if self.camera_set is not None:
            artifacts.append(self.camera_set.artifact)
        artifacts.extend(item.artifact for item in self.geometry)
        if any(
            artifact.source_manifest_sha256 != self.source_manifest_sha256
            or artifact.tool_manifest_sha256 != self.tool.manifest_sha256
            for artifact in artifacts
        ):
            raise ReconstructionError("INVALID_MANIFEST", "artifact provenance hashes disagree")
        if any(
            item.scale_status != self.scale_status or item.unit != self.unit
            for item in self.geometry
        ):
            raise ReconstructionError("INVALID_MANIFEST", "geometry scale labels disagree")
        if self.mode == "open3d-known-pose-tsdf" and self.tsdf_parameters is None:
            raise ReconstructionError("INVALID_MANIFEST", "TSDF output must record its parameters")
        if self.mode != "open3d-known-pose-tsdf" and self.tsdf_parameters is not None:
            raise ReconstructionError(
                "INVALID_MANIFEST", "non-TSDF output cannot record TSDF settings"
            )

    def _core_json(self) -> JsonObject:
        result: JsonObject = {
            "alignment": _alignment_json(self.alignment),
            "authority": self.authority,
            "cameraSet": self.camera_set.to_json() if self.camera_set is not None else None,
            "components": [component.to_json() for component in self.components],
            "diagnosticsArtifact": self.diagnostics_artifact.to_json(),
            "findings": [finding.to_json() for finding in self.findings],
            "geometry": [item.to_json() for item in self.geometry],
            "inputFrameCount": self.input_frame_count,
            "mode": self.mode,
            "registeredFrameCount": self.registered_frame_count,
            "scaleStatus": self.scale_status,
            "schemaVersion": self.schema_version,
            "sourceManifestSha256": self.source_manifest_sha256,
            "status": self.status,
            "tool": self.tool.to_json(),
            "tsdfParameters": self.tsdf_parameters,
            "unit": self.unit,
        }
        return result

    @property
    def manifest_sha256(self) -> str:
        return sha256_json(self._core_json())

    def to_json(self) -> JsonObject:
        return {**self._core_json(), "manifestSha256": self.manifest_sha256}

    def to_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_json())
