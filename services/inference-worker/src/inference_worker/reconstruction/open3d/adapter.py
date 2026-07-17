"""Known-pose RGB-D Open3D TSDF adapter with strict proposal manifests."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

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
from ..common.hashing import JsonObject, JsonValue, canonical_json_bytes, sha256_bytes
from ..common.manifest import (
    ArtifactPublisher,
    CameraSetDescriptor,
    ComponentDescriptor,
    DiagnosticFinding,
    GeometryArtifactDescriptor,
    GeometryProposalManifest,
    ToolManifest,
)
from ..common.workspace import IsolatedWorkspace
from .types import KnownPoseRgbdInput, Matrix4, TsdfConfig

ADAPTER_ID = "local-open3d-tsdf"
ADAPTER_VERSION = "1.0.0"
RUNNER_PATH = Path(__file__).with_name("runner.py").resolve()
MAXIMUM_SOURCE_BYTES = 21_474_836_480
_VERSION_PATTERN = re.compile(rb"([0-9]+(?:\.[0-9A-Za-z+-]+){1,5})")


@dataclass(frozen=True, slots=True)
class PlyCounts:
    vertices: int
    faces: int


def _tool_version(outcome: ExecutionOutcome) -> str:
    if not outcome.succeeded:
        return "not-installed"
    match = _VERSION_PATTERN.search(outcome.stdout)
    return match.group(1).decode("ascii")[:100] if match is not None else "version-unavailable"


def _output_transform(alignment: AlignmentReport | None) -> Matrix4:
    if alignment is None:
        return (
            (1.0, 0.0, 0.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
    transform = alignment.transform
    return (
        tuple(transform.scale * value for value in transform.rotation[0])
        + (transform.translation.x,),
        tuple(transform.scale * value for value in transform.rotation[1])
        + (transform.translation.y,),
        tuple(transform.scale * value for value in transform.rotation[2])
        + (transform.translation.z,),
        (0.0, 0.0, 0.0, 1.0),
    )  # type: ignore[return-value]


def _runner_input(
    value: KnownPoseRgbdInput, config: TsdfConfig, alignment: AlignmentReport | None
) -> JsonObject:
    frames: list[JsonValue] = []
    for index, frame in enumerate(value.frames):
        color_suffix = ".jpg" if frame.color_media_type == "image/jpeg" else ".png"
        frames.append(
            {
                "color": f"rgbd/color-{index:06d}{color_suffix}",
                "depth": f"rgbd/depth-{index:06d}.png",
                "worldToCamera": [list(row) for row in frame.pose.world_to_camera],
            }
        )
    return {
        "frames": frames,
        "intrinsics": {
            "cx": value.intrinsics.cx,
            "cy": value.intrinsics.cy,
            "fx": value.intrinsics.fx,
            "fy": value.intrinsics.fy,
            "height": value.intrinsics.height,
            "width": value.intrinsics.width,
        },
        "outputTransform": [list(row) for row in _output_transform(alignment)],
        "schemaVersion": "c8-open3d-runner-input-v1",
        "tsdf": config.to_json(),
    }


def _read_ply_counts(path: Path, *, maximum_header_bytes: int = 65_536) -> PlyCounts:
    if path.is_symlink() or not path.is_file():
        raise ReconstructionError("OPEN3D_OUTPUT_MISSING", "Open3D PLY output is absent")
    consumed = 0
    vertices: int | None = None
    faces = 0
    with path.open("rb") as handle:
        if handle.readline() != b"ply\n":
            raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "PLY magic is invalid")
        consumed += 4
        while True:
            line = handle.readline(1_025)
            consumed += len(line)
            if not line or len(line) > 1_024 or consumed > maximum_header_bytes:
                raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "PLY header is malformed")
            try:
                text = line.decode("ascii").strip()
            except UnicodeDecodeError as error:
                raise ReconstructionError(
                    "OPEN3D_OUTPUT_INVALID", "PLY header is not ASCII"
                ) from error
            if text == "end_header":
                break
            fields = text.split()
            try:
                if len(fields) == 3 and fields[:2] == ["element", "vertex"]:
                    vertices = int(fields[2])
                elif len(fields) == 3 and fields[:2] == ["element", "face"]:
                    faces = int(fields[2])
            except ValueError as error:
                raise ReconstructionError(
                    "OPEN3D_OUTPUT_INVALID", "PLY element count is malformed"
                ) from error
    if (
        vertices is None
        or vertices < 0
        or faces < 0
        or vertices > 100_000_000
        or faces > 200_000_000
    ):
        raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "PLY counts are invalid")
    return PlyCounts(vertices=vertices, faces=faces)


def _parse_runner_status(outcome: ExecutionOutcome) -> tuple[str, dict[str, int]]:
    try:
        value: object = json.loads(outcome.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "runner status is malformed") from error
    if not isinstance(value, dict) or not isinstance(value.get("code"), str):
        raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "runner status is malformed")
    output = cast("dict[str, object]", value)
    allowed = {"code", "meshTriangleCount", "meshVertexCount", "pointCount"}
    if not set(output).issubset(allowed):
        raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "runner status has unknown fields")
    counts: dict[str, int] = {}
    for key in allowed - {"code"}:
        item = output.get(key)
        if item is not None:
            if isinstance(item, bool) or not isinstance(item, int) or not 0 <= item <= 200_000_000:
                raise ReconstructionError("OPEN3D_OUTPUT_INVALID", "runner count is invalid")
            counts[key] = item
    return cast("str", output["code"]), counts


def _camera_manifest(value: KnownPoseRgbdInput, alignment: AlignmentReport | None) -> JsonObject:
    return {
        "authority": "proposal-only",
        "coordinateSystem": "right-handed-local",
        "frames": [
            {
                "frameKeySha256": frame.frame_key_sha256,
                "pose": frame.pose.to_json(),
            }
            for frame in value.frames
        ],
        "intrinsics": value.intrinsics.to_json(),
        "outputSimilarity": (
            [list(row) for row in _output_transform(alignment)] if alignment is not None else None
        ),
        "poseConvention": "world-to-camera",
        "schemaVersion": "c8-calibrated-cameras-v1",
    }


def _write_diagnostics(path: Path, codes: tuple[str, ...]) -> None:
    path.write_bytes(
        canonical_json_bytes(
            {
                "authority": "proposal-only",
                "findings": [{"code": code, "count": 1} for code in sorted(codes)],
                "schemaVersion": "c8-reconstruction-diagnostics-v1",
            }
        )
    )


class Open3dTsdfAdapter:
    """Integrate validated known-pose RGB-D frames through an isolated runner."""

    def __init__(
        self,
        registry: BinaryRegistry,
        *,
        config: TsdfConfig | None = None,
        limits: SubprocessLimits | None = None,
        workspace_base: Path | None = None,
    ) -> None:
        self._registry = registry
        self._config = config or TsdfConfig()
        self._limits = limits or SubprocessLimits(timeout_seconds=3_600)
        self._workspace_base = workspace_base

    def _tool_manifest(self, workspace: Path) -> ToolManifest:
        resolved = self._registry.resolve(BinaryId.OPEN3D_PYTHON)
        probe = run_bounded(
            self._registry,
            BinaryId.OPEN3D_PYTHON,
            ("-I", "-c", "import open3d; print(open3d.__version__)"),
            workspace=workspace,
            limits=SubprocessLimits(timeout_seconds=15, maximum_output_bytes=65_536),
        )
        version = _tool_version(probe)
        evidence: Literal["system-installed", "fixture-executable", "not-run-unavailable"] = (
            "fixture-executable"
            if resolved.evidence == BinaryEvidence.FIXTURE_EXECUTABLE
            else "system-installed"
        )
        if version == "not-installed":
            evidence = "not-run-unavailable"
        return ToolManifest(
            adapter_id=ADAPTER_ID,
            adapter_version=ADAPTER_VERSION,
            executable_version=version,
            config_sha256=self._config.config_sha256,
            execution_evidence=evidence,
        )

    def _abstention(
        self,
        workspace: IsolatedWorkspace,
        *,
        value: KnownPoseRgbdInput,
        tool: ToolManifest,
        code: str,
        publisher: ArtifactPublisher,
    ) -> GeometryProposalManifest:
        diagnostics_path = workspace.path("diagnostics.json", create_parent=True)
        _write_diagnostics(diagnostics_path, (code,))
        diagnostics = publisher.publish(
            diagnostics_path,
            kind="diagnostics",
            media_type="application/json",
            source_manifest_sha256=value.source_manifest_sha256,
            tool_manifest_sha256=tool.manifest_sha256,
        )
        return GeometryProposalManifest(
            mode="open3d-known-pose-tsdf",
            status="abstained",
            source_manifest_sha256=value.source_manifest_sha256,
            tool=tool,
            input_frame_count=len(value.frames),
            registered_frame_count=0,
            components=(),
            camera_set=None,
            geometry=(),
            diagnostics_artifact=diagnostics,
            findings=(DiagnosticFinding(code=code, severity="error"),),
            scale_status="metric-estimated",
            unit="micrometres",
            tsdf_parameters=self._config.to_json(),
        )

    def run(
        self,
        value: KnownPoseRgbdInput,
        *,
        publisher: ArtifactPublisher,
        alignment_anchors: tuple[AlignmentAnchor, ...] = (),
        alignment_threshold_micrometres: float = 50_000.0,
        cancelled: Callable[[], bool] | None = None,
    ) -> GeometryProposalManifest:
        with IsolatedWorkspace(base_directory=self._workspace_base) as workspace:
            tool = self._tool_manifest(workspace.root)
            if tool.execution_evidence == "not-run-unavailable":
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code="OPEN3D_NOT_INSTALLED",
                    publisher=publisher,
                )
            alignment = (
                align_similarity(alignment_anchors, threshold=alignment_threshold_micrometres)
                if alignment_anchors
                else None
            )
            for index, frame in enumerate(value.frames):
                color_suffix = ".jpg" if frame.color_media_type == "image/jpeg" else ".png"
                workspace.stage_verified_file(
                    frame.color_path,
                    f"rgbd/color-{index:06d}{color_suffix}",
                    expected_sha256=frame.color_sha256,
                    maximum_bytes=MAXIMUM_SOURCE_BYTES,
                )
                workspace.stage_verified_file(
                    frame.depth_path,
                    f"rgbd/depth-{index:06d}.png",
                    expected_sha256=frame.depth_sha256,
                    maximum_bytes=MAXIMUM_SOURCE_BYTES,
                )
            input_path = workspace.path("open3d-input.json", create_parent=True)
            input_path.write_bytes(
                canonical_json_bytes(_runner_input(value, self._config, alignment))
            )
            outcome = run_bounded(
                self._registry,
                BinaryId.OPEN3D_PYTHON,
                ("-I", str(RUNNER_PATH)),
                workspace=workspace.root,
                limits=self._limits,
                cancelled=cancelled,
                environment={"OMP_NUM_THREADS": "4"},
            )
            if outcome.status == "cancelled":
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code="RECONSTRUCTION_CANCELLED",
                    publisher=publisher,
                )
            if outcome.status == "timed-out":
                return self._abstention(
                    workspace, value=value, tool=tool, code="OPEN3D_TIMEOUT", publisher=publisher
                )
            if outcome.status == "output-limit":
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code="OPEN3D_OUTPUT_LIMIT",
                    publisher=publisher,
                )
            if outcome.status == "memory-limit":
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code="OPEN3D_MEMORY_LIMIT",
                    publisher=publisher,
                )
            if outcome.status == "file-limit":
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code="OPEN3D_FILE_LIMIT",
                    publisher=publisher,
                )
            try:
                status_code, reported_counts = _parse_runner_status(outcome)
            except ReconstructionError as error:
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code=error.safe_code,
                    publisher=publisher,
                )
            if not outcome.succeeded or status_code != "OPEN3D_OK":
                safe_code = (
                    status_code
                    if re.fullmatch(r"^[A-Z][A-Z0-9_]{2,79}$", status_code)
                    else "OPEN3D_EXECUTION_FAILED"
                )
                return self._abstention(
                    workspace, value=value, tool=tool, code=safe_code, publisher=publisher
                )
            point_path = workspace.path("open3d-points.ply")
            mesh_path = workspace.path("open3d-mesh.ply")
            try:
                point_counts = _read_ply_counts(point_path)
                mesh_counts = _read_ply_counts(mesh_path)
            except ReconstructionError as error:
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code=error.safe_code,
                    publisher=publisher,
                )
            if (
                reported_counts.get("pointCount") != point_counts.vertices
                or reported_counts.get("meshVertexCount") != mesh_counts.vertices
                or reported_counts.get("meshTriangleCount") != mesh_counts.faces
            ):
                return self._abstention(
                    workspace,
                    value=value,
                    tool=tool,
                    code="OPEN3D_OUTPUT_MISMATCH",
                    publisher=publisher,
                )
            camera_path = workspace.path("calibrated-cameras.json", create_parent=True)
            camera_path.write_bytes(canonical_json_bytes(_camera_manifest(value, alignment)))
            camera_artifact = publisher.publish(
                camera_path,
                kind="calibrated-cameras",
                media_type="application/json",
                source_manifest_sha256=value.source_manifest_sha256,
                tool_manifest_sha256=tool.manifest_sha256,
            )
            point_artifact = publisher.publish(
                point_path,
                kind="dense-point-cloud",
                media_type="application/ply",
                source_manifest_sha256=value.source_manifest_sha256,
                tool_manifest_sha256=tool.manifest_sha256,
            )
            mesh_artifact = publisher.publish(
                mesh_path,
                kind="triangle-mesh",
                media_type="application/ply",
                source_manifest_sha256=value.source_manifest_sha256,
                tool_manifest_sha256=tool.manifest_sha256,
            )
            diagnostics_path = workspace.path("diagnostics.json", create_parent=True)
            _write_diagnostics(
                diagnostics_path,
                ("GEOMETRY_PROPOSAL_ONLY", "SCALE_SENSOR_ESTIMATED")
                if alignment is None
                else ("GEOMETRY_PROPOSAL_ONLY",),
            )
            diagnostics = publisher.publish(
                diagnostics_path,
                kind="diagnostics",
                media_type="application/json",
                source_manifest_sha256=value.source_manifest_sha256,
                tool_manifest_sha256=tool.manifest_sha256,
            )
            scale_status: ScaleStatus = (
                "metric-validated" if alignment is not None else "metric-estimated"
            )
            keys = tuple(frame.frame_key_sha256 for frame in value.frames)
            component_id = f"open3d-{sha256_bytes(''.join(keys).encode('ascii'))[:24]}"
            return GeometryProposalManifest(
                mode="open3d-known-pose-tsdf",
                status="completed",
                source_manifest_sha256=value.source_manifest_sha256,
                tool=tool,
                input_frame_count=len(value.frames),
                registered_frame_count=len(value.frames),
                components=(
                    ComponentDescriptor(
                        component_id=component_id,
                        registered_frame_count=len(value.frames),
                        point_count=point_counts.vertices,
                        registered_frame_key_sha256s=keys,
                    ),
                ),
                camera_set=CameraSetDescriptor(
                    artifact=camera_artifact,
                    camera_count=len(value.frames),
                ),
                geometry=(
                    GeometryArtifactDescriptor(
                        artifact=point_artifact,
                        vertex_count=point_counts.vertices,
                        triangle_count=0,
                        scale_status=scale_status,
                        unit="micrometres",
                    ),
                    GeometryArtifactDescriptor(
                        artifact=mesh_artifact,
                        vertex_count=mesh_counts.vertices,
                        triangle_count=mesh_counts.faces,
                        scale_status=scale_status,
                        unit="micrometres",
                    ),
                ),
                diagnostics_artifact=diagnostics,
                findings=(
                    ()
                    if alignment is not None
                    else (DiagnosticFinding(code="SCALE_SENSOR_ESTIMATED", severity="warning"),)
                ),
                scale_status=scale_status,
                unit="micrometres",
                alignment=alignment,
                tsdf_parameters=self._config.to_json(),
            )
