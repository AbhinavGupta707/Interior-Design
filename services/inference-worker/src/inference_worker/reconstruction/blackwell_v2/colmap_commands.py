"""COLMAP 3.13 command contract verified against the Blackwell container."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..common.hashing import JsonObject, sha256_json


@dataclass(frozen=True, slots=True)
class ColmapV2Config:
    matcher: Literal["exhaustive", "sequential"] = "exhaustive"
    camera_model: Literal["PINHOLE", "SIMPLE_RADIAL"] = "PINHOLE"
    maximum_features: int = 16_384
    maximum_matches: int = 32_768
    maximum_image_size: int = 3_200
    geometric_consistency: bool = True

    def __post_init__(self) -> None:
        if self.matcher not in {"exhaustive", "sequential"}:
            raise ValueError("COLMAP matcher is invalid")
        if self.camera_model not in {"PINHOLE", "SIMPLE_RADIAL"}:
            raise ValueError("COLMAP camera model is invalid")
        if not 512 <= self.maximum_features <= 32_768:
            raise ValueError("maximum features is invalid")
        if not 512 <= self.maximum_matches <= 65_536:
            raise ValueError("maximum matches is invalid")
        if not 256 <= self.maximum_image_size <= 8_192:
            raise ValueError("maximum image size is invalid")

    def to_json(self) -> JsonObject:
        return {
            "cameraModel": self.camera_model,
            "geometricConsistency": self.geometric_consistency,
            "matcher": self.matcher,
            "maximumFeatures": self.maximum_features,
            "maximumImageSize": self.maximum_image_size,
            "maximumMatches": self.maximum_matches,
            "targetArchitecture": "sm_120",
            "toolVersion": "3.13.0",
        }

    @property
    def config_sha256(self) -> str:
        return sha256_json(self.to_json())


def sparse_commands(config: ColmapV2Config) -> tuple[tuple[str, ...], ...]:
    matcher = "exhaustive_matcher" if config.matcher == "exhaustive" else "sequential_matcher"
    return (
        (
            "feature_extractor",
            "--database_path",
            "/c8/work/database.db",
            "--image_path",
            "/c8/input/images",
            "--ImageReader.camera_model",
            config.camera_model,
            "--FeatureExtraction.use_gpu",
            "1",
            "--FeatureExtraction.gpu_index",
            "0",
            "--SiftExtraction.max_image_size",
            str(config.maximum_image_size),
            "--SiftExtraction.max_num_features",
            str(config.maximum_features),
        ),
        (
            matcher,
            "--database_path",
            "/c8/work/database.db",
            "--FeatureMatching.use_gpu",
            "1",
            "--FeatureMatching.gpu_index",
            "0",
            "--FeatureMatching.max_num_matches",
            str(config.maximum_matches),
            "--FeatureMatching.guided_matching",
            "1",
        ),
        (
            "mapper",
            "--database_path",
            "/c8/work/database.db",
            "--image_path",
            "/c8/input/images",
            "--output_path",
            "/c8/work/sparse",
        ),
    )


def dense_commands(config: ColmapV2Config) -> tuple[tuple[str, ...], ...]:
    return (
        (
            "image_undistorter",
            "--image_path",
            "/c8/input/images",
            "--input_path",
            "/c8/work/sparse/0",
            "--output_path",
            "/c8/work/dense",
            "--output_type",
            "COLMAP",
            "--max_image_size",
            str(config.maximum_image_size),
        ),
        (
            "patch_match_stereo",
            "--workspace_path",
            "/c8/work/dense",
            "--workspace_format",
            "COLMAP",
            "--PatchMatchStereo.gpu_index",
            "0",
            "--PatchMatchStereo.geom_consistency",
            "true" if config.geometric_consistency else "false",
        ),
        (
            "stereo_fusion",
            "--workspace_path",
            "/c8/work/dense",
            "--workspace_format",
            "COLMAP",
            "--input_type",
            "geometric" if config.geometric_consistency else "photometric",
            "--output_path",
            "/c8/output/fused.ply",
        ),
    )


def flattened_option_names(commands: tuple[tuple[str, ...], ...]) -> tuple[str, ...]:
    return tuple(part for command in commands for part in command if part.startswith("--"))
