"""Production Nerfstudio adapter for optional, non-dimensional C8 appearance."""

from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import tarfile
import tempfile
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, cast

from .contracts import (
    APPEARANCE_SCHEMA_VERSION,
    MAXIMUM_ARTIFACT_BYTES,
    AppearanceInput,
    AppearanceMethod,
    CameraFrame,
    JsonObject,
    JsonValue,
    ManifestError,
    PreparedFrame,
    canonical_json_bytes,
    finite_decimal,
    parse_appearance_input,
    sha256_json,
)
from .runtime import (
    CommandCancelled,
    CommandExecutor,
    CommandOutputLimit,
    CommandTimedOut,
    RegisteredRuntime,
    RuntimeRegistration,
    SubprocessExecutor,
    register_runtime,
)

type RunStatus = Literal["cancelled", "completed", "failed", "stale", "unavailable"]


@dataclass(frozen=True, slots=True)
class FixedProfile:
    """Compile-time bounded profile; jobs cannot inject flags or resource values."""

    identifier: str = "c8-balanced-v1"
    maximum_iterations: int = 30_000
    timeout_seconds: int = 86_400
    maximum_artifact_bytes: int = MAXIMUM_ARTIFACT_BYTES

    def json(self) -> JsonObject:
        return {
            "identifier": self.identifier,
            "maximumArtifactBytes": self.maximum_artifact_bytes,
            "maximumIterations": self.maximum_iterations,
            "timeoutSeconds": self.timeout_seconds,
        }


@dataclass(frozen=True, slots=True)
class TrustedStagedFrames:
    """Private worker-owned file mapping, deliberately absent from public manifests."""

    root: Path
    by_frame_id: Mapping[str, Path]


@dataclass(frozen=True, slots=True)
class ResourceObservations:
    """Bounded numeric observations that never include command text or paths."""

    duration_milliseconds: int
    peak_resident_memory_bytes: int | None
    runtime_evidence: Literal["live-runtime", "synthetic-fixture"]


@dataclass(frozen=True, slots=True)
class AppearanceRunOutcome:
    """Safe adapter outcome. Only completed outcomes contain a public result."""

    status: RunStatus
    safe_code: str
    result: JsonObject | None = None
    observations: ResourceObservations | None = None


class ArtifactPublisher(Protocol):
    """Synchronous, fence-aware storage boundary supplied by durable workflow code."""

    def publish(self, artifact_file: Path, public_result: JsonObject) -> None: ...


@dataclass(frozen=True, slots=True)
class AdapterDefinition:
    """Method-specific fixed command and artifact policy."""

    adapter_id: str
    adapter_version: str
    artifact_kind: Literal["nerfstudio-viewer", "gaussian-splat"]
    artifact_media_type: str
    method: AppearanceMethod
    model: Literal["nerfacto", "splatfacto"]


NERFSTUDIO_DEFINITION = AdapterDefinition(
    adapter_id="c8.nerfstudio",
    adapter_version="1.0.0",
    artifact_kind="nerfstudio-viewer",
    artifact_media_type="application/vnd.interior-design.nerfstudio-viewer+tar",
    method="nerfstudio",
    model="nerfacto",
)

_ALLOWED_FRAME_SUFFIXES = frozenset({".jpeg", ".jpg", ".png"})
_FORBIDDEN_OUTPUT_MARKERS = (
    b"Bearer ",
    b"X-Amz-Credential",
    b"X-Amz-Signature",
    b"x-amz-security-token",
    b"file://",
    b"http://",
    b"https://",
)


class NeuralAppearanceAdapter:
    """Shared fixed-command implementation used by Nerfstudio and gsplat modes."""

    def __init__(
        self,
        *,
        definition: AdapterDefinition,
        registration: RuntimeRegistration,
        executor: CommandExecutor | None = None,
        profile: FixedProfile | None = None,
        runtime_evidence: Literal["live-runtime", "synthetic-fixture"] = "live-runtime",
    ) -> None:
        self._definition = definition
        self._registration = registration
        self._executor = executor or SubprocessExecutor()
        self._profile = profile or FixedProfile()
        self._runtime_evidence = runtime_evidence

    @classmethod
    def discover(cls) -> NeuralAppearanceAdapter:
        """Register Nerfstudio only through the official fixed activation probe."""

        return cls(definition=NERFSTUDIO_DEFINITION, registration=register_runtime())

    @classmethod
    def with_runtime(
        cls,
        runtime: RegisteredRuntime,
        *,
        executor: CommandExecutor,
        runtime_evidence: Literal["live-runtime", "synthetic-fixture"] = "synthetic-fixture",
    ) -> NeuralAppearanceAdapter:
        """Dependency-injected constructor used by explicitly synthetic adapter tests."""

        return cls(
            definition=NERFSTUDIO_DEFINITION,
            registration=RuntimeRegistration(
                status="available", safe_code="APPEARANCE_READY", runtime=runtime
            ),
            executor=executor,
            runtime_evidence=runtime_evidence,
        )

    def execute(
        self,
        raw_input: object,
        *,
        workspace_root: Path,
        staged_frames: TrustedStagedFrames,
        cancelled: Callable[[], bool],
        publication_fence: Callable[[], bool],
        publisher: ArtifactPublisher,
    ) -> AppearanceRunOutcome:
        """Validate, train, package, fence, and synchronously publish appearance only."""

        if self._registration.status != "available" or self._registration.runtime is None:
            return AppearanceRunOutcome(
                status="unavailable", safe_code=self._registration.safe_code
            )
        if cancelled():
            return AppearanceRunOutcome(status="cancelled", safe_code="APPEARANCE_CANCELLED")
        try:
            request = parse_appearance_input(raw_input, expected_method=self._definition.method)
            attempt_root = self._create_private_attempt_root(workspace_root, request)
        except (ManifestError, OSError):
            return AppearanceRunOutcome(status="failed", safe_code="APPEARANCE_MANIFEST_REJECTED")

        try:
            dataset_root = attempt_root / "dataset"
            output_root = attempt_root / "output"
            artifact_root = attempt_root / "artifact"
            dataset_root.mkdir(mode=0o700)
            output_root.mkdir(mode=0o700)
            artifact_root.mkdir(mode=0o700)
            self._materialize_dataset(request, staged_frames, dataset_root)
            runtime = self._registration.runtime
            assert runtime is not None
            total_duration = 0
            peak_memory: int | None = None
            for argv in self._fixed_commands(
                runtime=runtime,
                request=request,
                dataset_root=dataset_root,
                output_root=output_root,
            ):
                command_result = self._executor.run(
                    argv,
                    cwd=attempt_root,
                    timeout_seconds=self._profile.timeout_seconds,
                    cancelled=cancelled,
                )
                total_duration += command_result.duration_milliseconds
                peak_memory = self._maximum_optional(
                    peak_memory, command_result.peak_resident_memory_bytes
                )
                if command_result.exit_code != 0:
                    return AppearanceRunOutcome(status="failed", safe_code="APPEARANCE_TOOL_FAILED")
            if cancelled():
                return AppearanceRunOutcome(status="cancelled", safe_code="APPEARANCE_CANCELLED")
            artifact_file = self._package_artifact(
                request=request,
                staged_frames=staged_frames,
                output_root=output_root,
                artifact_root=artifact_root,
            )
            public_result = self._public_result(request, runtime, artifact_file)
            if not publication_fence():
                return AppearanceRunOutcome(status="stale", safe_code="APPEARANCE_STALE_ATTEMPT")
            publisher.publish(artifact_file, public_result)
            return AppearanceRunOutcome(
                status="completed",
                safe_code="APPEARANCE_COMPLETED",
                result=public_result,
                observations=ResourceObservations(
                    duration_milliseconds=total_duration,
                    peak_resident_memory_bytes=peak_memory,
                    runtime_evidence=self._runtime_evidence,
                ),
            )
        except CommandCancelled:
            return AppearanceRunOutcome(status="cancelled", safe_code="APPEARANCE_CANCELLED")
        except CommandTimedOut:
            return AppearanceRunOutcome(status="failed", safe_code="APPEARANCE_TIMEOUT")
        except CommandOutputLimit:
            return AppearanceRunOutcome(status="failed", safe_code="APPEARANCE_OUTPUT_LIMIT")
        except (ManifestError, OSError, ValueError):
            return AppearanceRunOutcome(status="failed", safe_code="APPEARANCE_OUTPUT_INVALID")
        finally:
            self._remove_private_attempt_root(workspace_root, attempt_root)

    @staticmethod
    def _maximum_optional(first: int | None, second: int | None) -> int | None:
        if first is None:
            return second
        if second is None:
            return first
        return max(first, second)

    def _create_private_attempt_root(self, workspace_root: Path, request: AppearanceInput) -> Path:
        root = workspace_root.resolve(strict=True)
        if root.is_symlink() or not root.is_dir():
            raise ManifestError("APPEARANCE_WORKSPACE_INVALID")
        prefix = f"c8-{request.job_id}-a{request.attempt}-{self._definition.method}-"
        return Path(tempfile.mkdtemp(prefix=prefix, dir=root)).resolve(strict=True)

    @staticmethod
    def _remove_private_attempt_root(workspace_root: Path, attempt_root: Path) -> None:
        try:
            root = workspace_root.resolve(strict=True)
            resolved = attempt_root.resolve(strict=True)
        except FileNotFoundError:
            return
        if resolved.parent != root or not resolved.name.startswith("c8-"):
            return
        shutil.rmtree(resolved)

    def _materialize_dataset(
        self,
        request: AppearanceInput,
        staged_frames: TrustedStagedFrames,
        dataset_root: Path,
    ) -> None:
        frame_root = staged_frames.root.resolve(strict=True)
        if frame_root.is_symlink() or not frame_root.is_dir():
            raise ManifestError("STAGED_FRAME_ROOT_INVALID")
        expected_ids = {camera.frame_id for camera in request.cameras}
        if set(staged_frames.by_frame_id) != expected_ids:
            raise ManifestError("STAGED_FRAME_SET_MISMATCH")
        prepared_by_id = {frame.frame_id: frame for frame in request.frames}
        images_root = dataset_root / "images"
        images_root.mkdir(mode=0o700)
        dataset_frames: list[JsonValue] = []
        for camera in sorted(request.cameras, key=lambda item: item.frame_id):
            prepared = prepared_by_id[camera.frame_id]
            source = self._validate_staged_frame(
                frame_root, staged_frames.by_frame_id[camera.frame_id], prepared
            )
            destination = images_root / f"{camera.frame_id}{source.suffix.lower()}"
            shutil.copyfile(source, destination)
            os.chmod(destination, 0o600)
            dataset_frames.append(
                self._dataset_frame(camera, prepared, f"images/{destination.name}")
            )
        transforms: JsonObject = {
            "camera_model": "OPENCV",
            "c8_authority": "non-dimensional-appearance-input",
            "c8_camera_manifest_sha256": request.camera_manifest_sha256,
            "c8_geometry_manifest_sha256": request.geometry_manifest_sha256,
            "c8_geometry_unit": request.geometry_unit,
            "c8_prepared_manifest_sha256": request.prepared_manifest_sha256,
            "frames": dataset_frames,
        }
        (dataset_root / "transforms.json").write_bytes(canonical_json_bytes(transforms))

    @staticmethod
    def _validate_staged_frame(frame_root: Path, candidate: Path, prepared: PreparedFrame) -> Path:
        if candidate.is_symlink():
            raise ManifestError("STAGED_FRAME_INVALID")
        resolved = candidate.resolve(strict=True)
        if resolved.parent != frame_root or resolved.suffix.lower() not in _ALLOWED_FRAME_SUFFIXES:
            raise ManifestError("STAGED_FRAME_INVALID")
        if not resolved.is_file() or resolved.stat().st_size > MAXIMUM_ARTIFACT_BYTES:
            raise ManifestError("STAGED_FRAME_INVALID")
        if NeuralAppearanceAdapter._sha256_file(resolved) != prepared.sanitized_sha256:
            raise ManifestError("STAGED_FRAME_HASH_MISMATCH")
        return resolved

    @staticmethod
    def _dataset_frame(
        camera: CameraFrame, prepared: PreparedFrame, relative_file: str
    ) -> JsonObject:
        basis = [finite_decimal(value, 1_000_000_000) for value in camera.basis_nanounits]
        translation = [finite_decimal(value, 1_000_000) for value in camera.translation_micro_units]
        transform = cast(
            "list[JsonValue]",
            cast(
                "object",
                [
                    [basis[0], basis[1], basis[2], translation[0]],
                    [basis[3], basis[4], basis[5], translation[1]],
                    [basis[6], basis[7], basis[8], translation[2]],
                    [0, 0, 0, 1],
                ],
            ),
        )
        # Floats are used only in the private Nerfstudio dataset. Public C8
        # manifests remain integer-unit JSON and the result is non-dimensional.
        result = cast(
            "JsonObject",
            {
                "camera_model": camera.camera_model,
                "cx": finite_decimal(camera.principal_x_millionths, 1_000_000),
                "cy": finite_decimal(camera.principal_y_millionths, 1_000_000),
                "file_path": relative_file,
                "fl_x": finite_decimal(camera.focal_x_millionths, 1_000_000),
                "fl_y": finite_decimal(camera.focal_y_millionths, 1_000_000),
                "h": prepared.height_pixels,
                "k1": finite_decimal(camera.distortion_millionths[0], 1_000_000),
                "k2": finite_decimal(camera.distortion_millionths[1], 1_000_000),
                "p1": finite_decimal(camera.distortion_millionths[2], 1_000_000),
                "p2": finite_decimal(camera.distortion_millionths[3], 1_000_000),
                "transform_matrix": transform,
                "w": prepared.width_pixels,
            },
        )
        return result

    def _fixed_commands(
        self,
        *,
        runtime: RegisteredRuntime,
        request: AppearanceInput,
        dataset_root: Path,
        output_root: Path,
    ) -> tuple[tuple[str, ...], ...]:
        timestamp = f"attempt-{request.attempt:02d}"
        train = (
            str(runtime.ns_train),
            self._definition.model,
            "--data",
            str(dataset_root),
            "--output-dir",
            str(output_root),
            "--experiment-name",
            "c8-appearance",
            "--timestamp",
            timestamp,
            "--vis",
            "tensorboard",
            "--max-num-iterations",
            str(self._profile.maximum_iterations),
            "--viewer.quit-on-train-completion",
            "True",
        )
        if self._definition.method == "nerfstudio":
            return (train,)
        config = self._config_path(output_root, request.attempt)
        export = (
            str(runtime.ns_export),
            "gaussian-splat",
            "--load-config",
            str(config),
            "--output-dir",
            str(output_root / "c8-export"),
        )
        return train, export

    def _config_path(self, output_root: Path, attempt: int) -> Path:
        return (
            output_root
            / "c8-appearance"
            / self._definition.model
            / f"attempt-{attempt:02d}"
            / "config.yml"
        )

    def _package_artifact(
        self,
        *,
        request: AppearanceInput,
        staged_frames: TrustedStagedFrames,
        output_root: Path,
        artifact_root: Path,
    ) -> Path:
        if self._definition.method == "gsplat":
            return self._package_splat(
                request=request,
                staged_frames=staged_frames,
                output_root=output_root,
                artifact_root=artifact_root,
            )
        config = self._config_path(output_root, request.attempt)
        if config.is_symlink() or not config.is_file() or config.stat().st_size > 2_000_000:
            raise ManifestError("APPEARANCE_CONFIG_INVALID")
        checkpoints_root = config.parent / "nerfstudio_models"
        checkpoints = sorted(checkpoints_root.glob("*.ckpt"))
        if len(checkpoints) != 1:
            raise ManifestError("APPEARANCE_CHECKPOINT_INVALID")
        checkpoint = checkpoints[0]
        if checkpoint.is_symlink() or not checkpoint.is_file():
            raise ManifestError("APPEARANCE_CHECKPOINT_INVALID")
        forbidden = self._private_markers(
            request=request,
            staged_frames=staged_frames,
            output_root=output_root,
        )
        sanitized_config = self._sanitize_config(config, forbidden)
        if self._contains_marker(checkpoint, forbidden + _FORBIDDEN_OUTPUT_MARKERS):
            raise ManifestError("APPEARANCE_CHECKPOINT_PRIVATE_DATA")
        artifact = artifact_root / "nerfstudio-viewer.tar"
        manifest: JsonObject = {
            "authority": "non-dimensional",
            "checkpointSha256": self._sha256_file(checkpoint),
            "geometryManifestSha256": request.geometry_manifest_sha256,
            "method": "nerfstudio",
            "schemaVersion": "c8-nerfstudio-viewer-bundle-v1",
        }
        with tarfile.open(artifact, mode="w", format=tarfile.PAX_FORMAT) as archive:
            self._add_bytes(archive, "viewer-manifest.json", canonical_json_bytes(manifest))
            self._add_bytes(archive, "config.yml", sanitized_config)
            self._add_file(archive, "nerfstudio_models/model.ckpt", checkpoint)
        self._validate_artifact_file(artifact, forbidden)
        return artifact

    @staticmethod
    def _package_splat(
        *,
        request: AppearanceInput,
        staged_frames: TrustedStagedFrames,
        output_root: Path,
        artifact_root: Path,
    ) -> Path:
        source = output_root / "c8-export" / "splat.ply"
        if source.is_symlink() or not source.is_file():
            raise ManifestError("APPEARANCE_SPLAT_INVALID")
        with source.open("rb") as stream:
            header = stream.read(256)
        if not header.startswith(b"ply\n") or b"format binary_little_endian 1.0" not in header:
            raise ManifestError("APPEARANCE_SPLAT_INVALID")
        artifact = artifact_root / "gaussian-splat.ply"
        shutil.copyfile(source, artifact)
        private_markers = NeuralAppearanceAdapter._private_markers(
            request=request,
            staged_frames=staged_frames,
            output_root=output_root,
        )
        NeuralAppearanceAdapter._validate_artifact_file(
            artifact, private_markers + _FORBIDDEN_OUTPUT_MARKERS
        )
        return artifact

    @staticmethod
    def _private_markers(
        *, request: AppearanceInput, staged_frames: TrustedStagedFrames, output_root: Path
    ) -> tuple[bytes, ...]:
        del request
        roots = {
            str(staged_frames.root.resolve()).encode(),
            str(output_root.resolve()).encode(),
            str(output_root.parent.resolve()).encode(),
        }
        expanded = set(roots)
        for root in roots:
            expanded.add(root.replace(b"/", b"\\"))
            expanded.add(root.replace(b"\\", b"/"))
        return tuple(marker for marker in sorted(expanded) if marker)

    @staticmethod
    def _sanitize_config(config: Path, forbidden: tuple[bytes, ...]) -> bytes:
        raw = config.read_bytes()
        if b"\x00" in raw:
            raise ManifestError("APPEARANCE_CONFIG_INVALID")
        for marker in sorted(forbidden, key=len, reverse=True):
            raw = raw.replace(marker, b"${C8_PRIVATE_RUNTIME_ROOT}")
        # Nerfstudio config is YAML. Remove any remaining absolute path-shaped
        # scalar, including tool/cache paths that were not known to the caller.
        raw = re.sub(
            rb"(?m)(:\s*)(?:[A-Za-z]:[\\/]|/)[^\r\n]*$",
            rb"\1${C8_PRIVATE_RUNTIME_ROOT}",
            raw,
        )
        if any(marker in raw for marker in forbidden + _FORBIDDEN_OUTPUT_MARKERS):
            raise ManifestError("APPEARANCE_CONFIG_PRIVATE_DATA")
        try:
            raw.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ManifestError("APPEARANCE_CONFIG_INVALID") from error
        return raw

    @staticmethod
    def _add_bytes(archive: tarfile.TarFile, name: str, content: bytes) -> None:
        info = tarfile.TarInfo(name=name)
        info.size = len(content)
        info.mode = 0o600
        info.mtime = 0
        info.uid = 0
        info.gid = 0
        info.uname = ""
        info.gname = ""
        archive.addfile(info, io.BytesIO(content))

    @staticmethod
    def _add_file(archive: tarfile.TarFile, name: str, source: Path) -> None:
        info = tarfile.TarInfo(name=name)
        info.size = source.stat().st_size
        info.mode = 0o600
        info.mtime = 0
        info.uid = 0
        info.gid = 0
        info.uname = ""
        info.gname = ""
        with source.open("rb") as stream:
            archive.addfile(info, stream)

    @staticmethod
    def _validate_artifact_file(artifact: Path, forbidden: Sequence[bytes]) -> None:
        size = artifact.stat().st_size
        if artifact.is_symlink() or not 0 < size <= MAXIMUM_ARTIFACT_BYTES:
            raise ManifestError("APPEARANCE_ARTIFACT_INVALID")
        if NeuralAppearanceAdapter._contains_marker(artifact, forbidden):
            raise ManifestError("APPEARANCE_ARTIFACT_PRIVATE_DATA")

    @staticmethod
    def _contains_marker(path: Path, markers: Sequence[bytes]) -> bool:
        bounded = tuple(marker for marker in markers if marker)
        if not bounded:
            return False
        overlap = max(len(marker) for marker in bounded) - 1
        previous = b""
        with path.open("rb") as stream:
            while chunk := stream.read(1_048_576):
                block = previous + chunk
                if any(marker in block for marker in bounded):
                    return True
                previous = block[-overlap:] if overlap > 0 else b""
        return False

    def _public_result(
        self, request: AppearanceInput, runtime: RegisteredRuntime, artifact_file: Path
    ) -> JsonObject:
        content_sha256 = self._sha256_file(artifact_file)
        config_sha256 = sha256_json(self._profile.json())
        tool: JsonObject = {
            "adapterId": self._definition.adapter_id,
            "adapterVersion": self._definition.adapter_version,
            "configSha256": config_sha256,
            "executableVersion": runtime.executable_version,
        }
        tool_manifest_sha256 = sha256_json(tool)
        artifact: JsonObject = {
            "artifactId": str(
                uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    (
                        f"c8:{request.job_id}:{request.attempt}:{self._definition.method}:"
                        f"{content_sha256}"
                    ),
                )
            ),
            "byteSize": artifact_file.stat().st_size,
            "contentSha256": content_sha256,
            "dimensionalAuthority": "non-dimensional",
            "kind": self._definition.artifact_kind,
            "mediaType": self._definition.artifact_media_type,
            "sourceManifestSha256": request.prepared_manifest_sha256,
            "toolManifestSha256": tool_manifest_sha256,
        }
        core: JsonObject = {
            "artifacts": [artifact],
            "geometryManifestSha256": request.geometry_manifest_sha256,
            "method": self._definition.method,
            "schemaVersion": APPEARANCE_SCHEMA_VERSION,
            "tool": tool,
        }
        return {**core, "manifestSha256": sha256_json(core)}

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while chunk := stream.read(1_048_576):
                digest.update(chunk)
        return digest.hexdigest()


def unavailable_nerfstudio_adapter(safe_code: str) -> NeuralAppearanceAdapter:
    """Construct an explicitly disabled adapter for worker registration tests."""

    return NeuralAppearanceAdapter(
        definition=NERFSTUDIO_DEFINITION,
        registration=RuntimeRegistration(status="unavailable", safe_code=safe_code),
    )
