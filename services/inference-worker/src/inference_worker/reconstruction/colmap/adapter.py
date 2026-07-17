"""Provider-neutral COLMAP sparse adapter with proposal-only publication."""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from ..common.alignment import (
    AlignmentAnchor,
    AlignmentReport,
    ScaleStatus,
    align_similarity,
)
from ..common.errors import ReconstructionError
from ..common.execution import (
    BinaryEvidence,
    BinaryId,
    BinaryRegistry,
    ExecutionOutcome,
    SubprocessLimits,
    run_bounded,
)
from ..common.hashing import (
    JsonObject,
    JsonValue,
    canonical_json_bytes,
    sha256_bytes,
    validate_sha256,
)
from ..common.manifest import (
    ArtifactPublisher,
    CameraSetDescriptor,
    ComponentDescriptor,
    DiagnosticFinding,
    GeometryArtifactDescriptor,
    GeometryProposalManifest,
    GeometryUnit,
    ToolManifest,
)
from ..common.workspace import IsolatedWorkspace
from .commands import SparseConfig, sparse_commands
from .components import image_components, registered_image_key
from .models import Image, SparseModel, camera_center, quaternion_rotation
from .parser import discover_sparse_model_directories, read_sparse_model

ADAPTER_ID = "local-colmap"
ADAPTER_VERSION = "1.0.0"
MAXIMUM_SOURCE_BYTES = 21_474_836_480
_VERSION_PATTERN = re.compile(rb"(?:COLMAP\s+)?([0-9]+(?:\.[0-9A-Za-z+-]+){1,5})")


@dataclass(frozen=True, slots=True)
class StagedImage:
    source_path: Path = field(repr=False)
    sha256: str
    media_type: str

    def __post_init__(self) -> None:
        validate_sha256(self.sha256, name="frame sha256")
        if self.media_type not in {"image/jpeg", "image/png"}:
            raise ReconstructionError("UNSUPPORTED_INPUT", "COLMAP frame media type is unsupported")

    @property
    def suffix(self) -> str:
        return ".jpg" if self.media_type == "image/jpeg" else ".png"


def _tool_version(outcome: ExecutionOutcome) -> str:
    if not outcome.succeeded:
        return "version-unavailable"
    match = _VERSION_PATTERN.search(outcome.stdout + b"\n" + outcome.stderr)
    if match is None:
        return "version-unavailable"
    return match.group(1).decode("ascii")[:100]


def _run_code(outcome: ExecutionOutcome) -> str | None:
    by_status = {
        "cancelled": "RECONSTRUCTION_CANCELLED",
        "failed": "COLMAP_EXECUTION_FAILED",
        "file-limit": "COLMAP_FILE_LIMIT",
        "memory-limit": "COLMAP_MEMORY_LIMIT",
        "output-limit": "COLMAP_OUTPUT_LIMIT",
        "timed-out": "COLMAP_TIMEOUT",
    }
    return None if outcome.succeeded else by_status.get(outcome.status, "COLMAP_EXECUTION_FAILED")


def _transpose(matrix: tuple[tuple[float, ...], ...]) -> tuple[tuple[float, ...], ...]:
    return tuple(tuple(matrix[column][row] for column in range(3)) for row in range(3))


def _matrix_product(
    left: tuple[tuple[float, ...], ...], right: tuple[tuple[float, ...], ...]
) -> tuple[tuple[float, ...], ...]:
    return tuple(
        tuple(
            sum(left[row][inner] * right[inner][column] for inner in range(3))
            for column in range(3)
        )
        for row in range(3)
    )


def _output_camera(image: Image, alignment: AlignmentReport | None) -> JsonObject:
    center = camera_center(image)
    rotation = quaternion_rotation(image.quaternion_wxyz)
    if alignment is not None:
        center = alignment.transform.apply(center)
        rotation = _matrix_product(rotation, _transpose(alignment.transform.rotation))
    return {
        "cameraCenter": [center.x, center.y, center.z],
        "cameraId": image.camera_id,
        "frameKeySha256": registered_image_key(image.name),
        "imageId": image.image_id,
        "worldToCameraRotation": [list(row) for row in rotation],
    }


def _camera_manifest(
    models: tuple[SparseModel, ...], alignment: AlignmentReport | None
) -> JsonObject:
    cameras: list[JsonValue] = []
    images: list[JsonValue] = []
    for model_index, model in enumerate(models):
        for camera in sorted(model.cameras.values(), key=lambda item: item.camera_id):
            cameras.append(
                {
                    "cameraId": camera.camera_id,
                    "componentModelIndex": model_index,
                    "heightPixels": camera.height,
                    "model": camera.model.name,
                    "parameters": list(camera.parameters),
                    "widthPixels": camera.width,
                }
            )
        for image in sorted(model.images.values(), key=lambda item: item.image_id):
            images.append({"componentModelIndex": model_index, **_output_camera(image, alignment)})
    return {
        "authority": "proposal-only",
        "cameras": cameras,
        "coordinateSystem": "right-handed-local",
        "images": images,
        "poseConvention": "world-to-camera",
        "schemaVersion": "c8-calibrated-cameras-v1",
    }


def _write_sparse_ply(path: Path, model: SparseModel, alignment: AlignmentReport | None) -> int:
    points = sorted(model.points3d.values(), key=lambda item: item.point3d_id)
    with path.open("w", encoding="ascii", newline="\n") as handle:
        handle.write("ply\nformat ascii 1.0\n")
        handle.write(f"element vertex {len(points)}\n")
        handle.write("property double x\nproperty double y\nproperty double z\n")
        handle.write("property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
        for point in points:
            output = alignment.transform.apply(point.xyz) if alignment is not None else point.xyz
            handle.write(
                f"{output.x:.17g} {output.y:.17g} {output.z:.17g} "
                f"{point.rgb[0]} {point.rgb[1]} {point.rgb[2]}\n"
            )
    return len(points)


def _component_descriptors(models: tuple[SparseModel, ...]) -> tuple[ComponentDescriptor, ...]:
    descriptors: list[ComponentDescriptor] = []
    for model_index, model in enumerate(models):
        for graph_index, image_ids in enumerate(image_components(model)):
            keys = tuple(
                sorted(registered_image_key(model.images[image_id].name) for image_id in image_ids)
            )
            point_count = sum(
                1
                for point in model.points3d.values()
                if any(element.image_id in image_ids for element in point.track)
            )
            digest = sha256_bytes("".join(keys).encode("ascii"))[:24]
            descriptors.append(
                ComponentDescriptor(
                    component_id=f"colmap-{model_index:04d}-{graph_index:04d}-{digest}",
                    registered_frame_count=len(image_ids),
                    point_count=point_count,
                    registered_frame_key_sha256s=keys,
                )
            )
    return tuple(descriptors)


def _write_diagnostics(path: Path, codes: tuple[str, ...]) -> None:
    payload = {
        "authority": "proposal-only",
        "findings": [{"code": code, "count": 1} for code in sorted(codes)],
        "schemaVersion": "c8-reconstruction-diagnostics-v1",
    }
    path.write_bytes(canonical_json_bytes(payload))


class ColmapAdapter:
    """Execute fixed CPU sparse commands and parse every emitted component."""

    def __init__(
        self,
        registry: BinaryRegistry,
        *,
        config: SparseConfig | None = None,
        limits: SubprocessLimits | None = None,
        workspace_base: Path | None = None,
    ) -> None:
        self._registry = registry
        self._config = config or SparseConfig()
        self._limits = limits or SubprocessLimits(timeout_seconds=3_600)
        self._workspace_base = workspace_base

    def _tool_manifest(self, workspace: Path) -> ToolManifest:
        try:
            resolved = self._registry.resolve(BinaryId.COLMAP)
        except ReconstructionError:
            return ToolManifest(
                adapter_id=ADAPTER_ID,
                adapter_version=ADAPTER_VERSION,
                executable_version="not-installed",
                config_sha256=self._config.config_sha256,
                execution_evidence="not-run-unavailable",
            )
        probe = run_bounded(
            self._registry,
            BinaryId.COLMAP,
            ("-h",),
            workspace=workspace,
            limits=SubprocessLimits(timeout_seconds=10, maximum_output_bytes=65_536),
        )
        evidence: Literal["system-installed", "fixture-executable"] = (
            "fixture-executable"
            if resolved.evidence == BinaryEvidence.FIXTURE_EXECUTABLE
            else "system-installed"
        )
        return ToolManifest(
            adapter_id=ADAPTER_ID,
            adapter_version=ADAPTER_VERSION,
            executable_version=_tool_version(probe),
            config_sha256=self._config.config_sha256,
            execution_evidence=evidence,
        )

    def _abstention(
        self,
        workspace: IsolatedWorkspace,
        *,
        source_manifest_sha256: str,
        tool: ToolManifest,
        input_frame_count: int,
        code: str,
        publisher: ArtifactPublisher,
    ) -> GeometryProposalManifest:
        diagnostics_path = workspace.path("diagnostics.json", create_parent=True)
        _write_diagnostics(diagnostics_path, (code,))
        diagnostics = publisher.publish(
            diagnostics_path,
            kind="diagnostics",
            media_type="application/json",
            source_manifest_sha256=source_manifest_sha256,
            tool_manifest_sha256=tool.manifest_sha256,
        )
        return GeometryProposalManifest(
            mode="colmap-sparse",
            status="abstained",
            source_manifest_sha256=source_manifest_sha256,
            tool=tool,
            input_frame_count=input_frame_count,
            registered_frame_count=0,
            components=(),
            camera_set=None,
            geometry=(),
            diagnostics_artifact=diagnostics,
            findings=(DiagnosticFinding(code=code, severity="error"),),
            scale_status="unknown",
            unit="arbitrary-units",
        )

    def run_sparse(
        self,
        frames: tuple[StagedImage, ...],
        *,
        source_manifest_sha256: str,
        publisher: ArtifactPublisher,
        alignment_anchors: tuple[AlignmentAnchor, ...] = (),
        alignment_threshold_micrometres: float = 50_000.0,
        cancelled: Callable[[], bool] | None = None,
    ) -> GeometryProposalManifest:
        """Run one isolated sparse reconstruction or return an explicit abstention."""

        validate_sha256(source_manifest_sha256, name="source manifest sha256")
        if not 2 <= len(frames) <= 10_000:
            raise ReconstructionError("INVALID_FRAME_COUNT", "COLMAP needs 2 to 10,000 frames")
        if len({frame.sha256 for frame in frames}) != len(frames):
            raise ReconstructionError("DUPLICATE_FRAME", "COLMAP frames must be unique")
        with IsolatedWorkspace(base_directory=self._workspace_base) as workspace:
            tool = self._tool_manifest(workspace.root)
            if tool.execution_evidence == "not-run-unavailable":
                return self._abstention(
                    workspace,
                    source_manifest_sha256=source_manifest_sha256,
                    tool=tool,
                    input_frame_count=len(frames),
                    code="COLMAP_NOT_INSTALLED",
                    publisher=publisher,
                )
            for index, frame in enumerate(frames):
                workspace.stage_verified_file(
                    frame.source_path,
                    f"images/frame-{index:06d}{frame.suffix}",
                    expected_sha256=frame.sha256,
                    maximum_bytes=MAXIMUM_SOURCE_BYTES,
                )
            workspace.path("sparse", create_parent=True).mkdir(mode=0o700, exist_ok=True)
            for command in sparse_commands(self._config):
                outcome = run_bounded(
                    self._registry,
                    BinaryId.COLMAP,
                    command,
                    workspace=workspace.root,
                    limits=self._limits,
                    cancelled=cancelled,
                    environment={
                        "CUDA_VISIBLE_DEVICES": "",
                        "OMP_NUM_THREADS": str(self._config.threads),
                    },
                )
                code = _run_code(outcome)
                if code is not None:
                    return self._abstention(
                        workspace,
                        source_manifest_sha256=source_manifest_sha256,
                        tool=tool,
                        input_frame_count=len(frames),
                        code=code,
                        publisher=publisher,
                    )
            try:
                model_directories = discover_sparse_model_directories(workspace.root, "sparse")
                models = tuple(
                    read_sparse_model(workspace.root, directory) for directory in model_directories
                )
            except ReconstructionError as error:
                return self._abstention(
                    workspace,
                    source_manifest_sha256=source_manifest_sha256,
                    tool=tool,
                    input_frame_count=len(frames),
                    code=error.safe_code,
                    publisher=publisher,
                )
            if not models or not any(model.points3d for model in models):
                return self._abstention(
                    workspace,
                    source_manifest_sha256=source_manifest_sha256,
                    tool=tool,
                    input_frame_count=len(frames),
                    code="COLMAP_GEOMETRY_EMPTY",
                    publisher=publisher,
                )
            expected_names = {
                f"frame-{index:06d}{frame.suffix}" for index, frame in enumerate(frames)
            }
            registered_name_sequence = [
                image.name for model in models for image in model.images.values()
            ]
            registered_names = set(registered_name_sequence)
            if not registered_names.issubset(expected_names):
                return self._abstention(
                    workspace,
                    source_manifest_sha256=source_manifest_sha256,
                    tool=tool,
                    input_frame_count=len(frames),
                    code="COLMAP_SOURCE_MISMATCH",
                    publisher=publisher,
                )
            if len(registered_names) != len(registered_name_sequence):
                return self._abstention(
                    workspace,
                    source_manifest_sha256=source_manifest_sha256,
                    tool=tool,
                    input_frame_count=len(frames),
                    code="COLMAP_DUPLICATE_REGISTRATION",
                    publisher=publisher,
                )
            alignment = (
                align_similarity(alignment_anchors, threshold=alignment_threshold_micrometres)
                if alignment_anchors
                else None
            )
            camera_path = workspace.path("calibrated-cameras.json", create_parent=True)
            camera_path.write_bytes(canonical_json_bytes(_camera_manifest(models, alignment)))
            camera_artifact = publisher.publish(
                camera_path,
                kind="calibrated-cameras",
                media_type="application/json",
                source_manifest_sha256=source_manifest_sha256,
                tool_manifest_sha256=tool.manifest_sha256,
            )
            geometry: list[GeometryArtifactDescriptor] = []
            scale_status: ScaleStatus = "metric-validated" if alignment is not None else "unknown"
            unit: GeometryUnit = "micrometres" if alignment is not None else "arbitrary-units"
            for index, model in enumerate(models):
                ply_path = workspace.path(f"artifacts/sparse-{index:04d}.ply", create_parent=True)
                point_count = _write_sparse_ply(ply_path, model, alignment)
                artifact = publisher.publish(
                    ply_path,
                    kind="sparse-point-cloud",
                    media_type="application/ply",
                    source_manifest_sha256=source_manifest_sha256,
                    tool_manifest_sha256=tool.manifest_sha256,
                )
                geometry.append(
                    GeometryArtifactDescriptor(
                        artifact=artifact,
                        vertex_count=point_count,
                        triangle_count=0,
                        scale_status=scale_status,
                        unit=unit,
                    )
                )
            components = _component_descriptors(models)
            finding_codes: list[str] = []
            if len(registered_names) < len(frames):
                finding_codes.append("PARTIAL_REGISTRATION")
            if len(components) > 1:
                finding_codes.append("DISCONNECTED_COMPONENTS")
            diagnostics_path = workspace.path("diagnostics.json", create_parent=True)
            _write_diagnostics(diagnostics_path, tuple(finding_codes or ["GEOMETRY_PROPOSAL_ONLY"]))
            diagnostics = publisher.publish(
                diagnostics_path,
                kind="diagnostics",
                media_type="application/json",
                source_manifest_sha256=source_manifest_sha256,
                tool_manifest_sha256=tool.manifest_sha256,
            )
            return GeometryProposalManifest(
                mode="colmap-sparse",
                status="partial" if finding_codes else "completed",
                source_manifest_sha256=source_manifest_sha256,
                tool=tool,
                input_frame_count=len(frames),
                registered_frame_count=len(registered_names),
                components=components,
                camera_set=CameraSetDescriptor(
                    artifact=camera_artifact,
                    camera_count=len(registered_names),
                ),
                geometry=tuple(geometry),
                diagnostics_artifact=diagnostics,
                findings=tuple(
                    DiagnosticFinding(code=code, severity="warning") for code in finding_codes
                ),
                scale_status=scale_status,
                unit=unit,
                alignment=alignment,
            )
