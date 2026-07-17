"""Fixed COLMAP argv builders and explicit CUDA-dense eligibility."""

from dataclasses import dataclass
from typing import Literal

from ..common.errors import ReconstructionError
from ..common.hashing import JsonObject, sha256_json, validate_sha256
from .components import MergePlan


@dataclass(frozen=True, slots=True)
class SparseConfig:
    matcher: Literal["exhaustive", "sequential"] = "sequential"
    camera_model: Literal["SIMPLE_RADIAL", "PINHOLE"] = "SIMPLE_RADIAL"
    maximum_image_size: int = 3_200
    maximum_features: int = 8_192
    threads: int = 4

    def __post_init__(self) -> None:
        if self.matcher not in {"exhaustive", "sequential"}:
            raise ValueError("COLMAP matcher is invalid")
        if self.camera_model not in {"SIMPLE_RADIAL", "PINHOLE"}:
            raise ValueError("COLMAP camera model is invalid")
        if not 256 <= self.maximum_image_size <= 8_192:
            raise ValueError("maximum image size is invalid")
        if not 512 <= self.maximum_features <= 32_768 or not 1 <= self.threads <= 32:
            raise ValueError("COLMAP sparse resource settings are invalid")

    def to_json(self) -> JsonObject:
        return {
            "cameraModel": self.camera_model,
            "matcher": self.matcher,
            "maximumFeatures": self.maximum_features,
            "maximumImageSize": self.maximum_image_size,
            "threads": self.threads,
            "useGpu": False,
        }

    @property
    def config_sha256(self) -> str:
        return sha256_json(self.to_json())


@dataclass(frozen=True, slots=True)
class DenseConfig:
    maximum_image_size: int = 2_000
    geometric_consistency: bool = True
    mesh: Literal["poisson", "none"] = "poisson"

    def __post_init__(self) -> None:
        if self.mesh not in {"poisson", "none"}:
            raise ValueError("dense mesh mode is invalid")
        if not 256 <= self.maximum_image_size <= 8_192:
            raise ValueError("dense maximum image size is invalid")

    def to_json(self) -> JsonObject:
        return {
            "geometricConsistency": self.geometric_consistency,
            "maximumImageSize": self.maximum_image_size,
            "mesh": self.mesh,
            "requiresCuda": True,
        }

    @property
    def config_sha256(self) -> str:
        return sha256_json(self.to_json())


def sparse_commands(config: SparseConfig) -> tuple[tuple[str, ...], ...]:
    matcher = "exhaustive_matcher" if config.matcher == "exhaustive" else "sequential_matcher"
    return (
        (
            "feature_extractor",
            "--database_path",
            "database.db",
            "--image_path",
            "images",
            "--ImageReader.camera_model",
            config.camera_model,
            "--FeatureExtraction.use_gpu",
            "0",
            "--FeatureExtraction.max_image_size",
            str(config.maximum_image_size),
            "--FeatureExtraction.max_num_features",
            str(config.maximum_features),
            "--FeatureExtraction.num_threads",
            str(config.threads),
        ),
        (
            matcher,
            "--database_path",
            "database.db",
            "--FeatureMatching.use_gpu",
            "0",
            "--FeatureMatching.num_threads",
            str(config.threads),
        ),
        (
            "mapper",
            "--database_path",
            "database.db",
            "--image_path",
            "images",
            "--output_path",
            "sparse",
            "--Mapper.num_threads",
            str(config.threads),
        ),
    )


@dataclass(frozen=True, slots=True)
class DenseCapability:
    colmap_installed: bool
    cuda_runtime_available: bool
    nvidia_device_count: int
    colmap_cuda_enabled: bool
    sparse_registered_frame_count: int
    sparse_component_count: int

    def __post_init__(self) -> None:
        if (
            self.nvidia_device_count < 0
            or self.sparse_registered_frame_count < 0
            or self.sparse_component_count < 0
        ):
            raise ValueError("dense capability counts cannot be negative")


@dataclass(frozen=True, slots=True)
class DenseEligibility:
    eligible: bool
    safe_codes: tuple[str, ...]

    def __post_init__(self) -> None:
        allowed = {
            "COLMAP_NOT_INSTALLED",
            "CUDA_NOT_AVAILABLE",
            "NVIDIA_DEVICE_NOT_AVAILABLE",
            "COLMAP_CUDA_UNVERIFIED",
            "SPARSE_MODEL_INSUFFICIENT",
            "DISCONNECTED_COMPONENTS",
        }
        if len(set(self.safe_codes)) != len(self.safe_codes) or not set(self.safe_codes).issubset(
            allowed
        ):
            raise ValueError("dense eligibility findings are invalid")
        if self.eligible == bool(self.safe_codes):
            raise ValueError("dense eligibility state disagrees with its findings")


@dataclass(frozen=True, slots=True)
class DenseEligibilityManifest:
    """Hash-bound eligibility decision; this is not CUDA execution evidence."""

    capability: DenseCapability
    eligibility: DenseEligibility
    source_manifest_sha256: str
    tool_manifest_sha256: str
    config_sha256: str
    schema_version: Literal["c8-colmap-dense-eligibility-v1"] = "c8-colmap-dense-eligibility-v1"

    def __post_init__(self) -> None:
        validate_sha256(self.source_manifest_sha256, name="source manifest sha256")
        validate_sha256(self.tool_manifest_sha256, name="tool manifest sha256")
        validate_sha256(self.config_sha256, name="config sha256")
        expected = assess_dense_eligibility(self.capability)
        if expected != self.eligibility:
            raise ReconstructionError(
                "INVALID_MANIFEST", "dense eligibility does not match measured capability"
            )

    def _core_json(self) -> JsonObject:
        return {
            "authority": "proposal-only",
            "configSha256": self.config_sha256,
            "eligible": self.eligibility.eligible,
            "executionStatus": (
                "eligible-not-run" if self.eligibility.eligible else "abstained-not-run"
            ),
            "findings": list(self.eligibility.safe_codes),
            "nvidiaDeviceCount": self.capability.nvidia_device_count,
            "requiresCuda": True,
            "schemaVersion": self.schema_version,
            "sourceManifestSha256": self.source_manifest_sha256,
            "sparseComponentCount": self.capability.sparse_component_count,
            "sparseRegisteredFrameCount": self.capability.sparse_registered_frame_count,
            "toolManifestSha256": self.tool_manifest_sha256,
        }

    @property
    def manifest_sha256(self) -> str:
        return sha256_json(self._core_json())

    def to_json(self) -> JsonObject:
        return {**self._core_json(), "manifestSha256": self.manifest_sha256}


def build_dense_eligibility_manifest(
    capability: DenseCapability,
    config: DenseConfig,
    *,
    source_manifest_sha256: str,
    tool_manifest_sha256: str,
) -> DenseEligibilityManifest:
    return DenseEligibilityManifest(
        capability=capability,
        eligibility=assess_dense_eligibility(capability),
        source_manifest_sha256=source_manifest_sha256,
        tool_manifest_sha256=tool_manifest_sha256,
        config_sha256=config.config_sha256,
    )


def assess_dense_eligibility(capability: DenseCapability) -> DenseEligibility:
    codes: list[str] = []
    if not capability.colmap_installed:
        codes.append("COLMAP_NOT_INSTALLED")
    if not capability.cuda_runtime_available:
        codes.append("CUDA_NOT_AVAILABLE")
    if capability.nvidia_device_count < 1:
        codes.append("NVIDIA_DEVICE_NOT_AVAILABLE")
    if not capability.colmap_cuda_enabled:
        codes.append("COLMAP_CUDA_UNVERIFIED")
    if capability.sparse_registered_frame_count < 2:
        codes.append("SPARSE_MODEL_INSUFFICIENT")
    if capability.sparse_component_count != 1:
        codes.append("DISCONNECTED_COMPONENTS")
    return DenseEligibility(eligible=not codes, safe_codes=tuple(codes))


def dense_commands(
    config: DenseConfig, eligibility: DenseEligibility
) -> tuple[tuple[str, ...], ...]:
    if not eligibility.eligible:
        raise ReconstructionError("CUDA_DENSE_INELIGIBLE", "CUDA-dense prerequisites are unmet")
    commands: list[tuple[str, ...]] = [
        (
            "image_undistorter",
            "--image_path",
            "images",
            "--input_path",
            "sparse/0",
            "--output_path",
            "dense",
            "--output_type",
            "COLMAP",
            "--max_image_size",
            str(config.maximum_image_size),
        ),
        (
            "patch_match_stereo",
            "--workspace_path",
            "dense",
            "--workspace_format",
            "COLMAP",
            "--PatchMatchStereo.geom_consistency",
            "true" if config.geometric_consistency else "false",
        ),
        (
            "stereo_fusion",
            "--workspace_path",
            "dense",
            "--workspace_format",
            "COLMAP",
            "--input_type",
            "geometric" if config.geometric_consistency else "photometric",
            "--output_path",
            "dense/fused.ply",
        ),
    ]
    if config.mesh == "poisson":
        commands.append(
            (
                "poisson_mesher",
                "--input_path",
                "dense/fused.ply",
                "--output_path",
                "dense/meshed-poisson.ply",
            )
        )
    return tuple(commands)


def merge_commands(plan: MergePlan) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Build merger plus mandatory global bundle adjustment after overlap proof."""

    if not plan.shared_image_keys:
        raise ReconstructionError("MODEL_MERGE_NO_OVERLAP", "merge plan has no shared images")
    return (
        (
            "model_merger",
            "--input_path1",
            plan.left_relative_model,
            "--input_path2",
            plan.right_relative_model,
            "--output_path",
            plan.output_relative_model,
        ),
        (
            "bundle_adjuster",
            "--input_path",
            plan.output_relative_model,
            "--output_path",
            plan.output_relative_model,
            "--BundleAdjustment.refine_principal_point",
            "1",
        ),
    )
