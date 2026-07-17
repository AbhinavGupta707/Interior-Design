"""COLMAP CPU-sparse parsing/execution and explicit CUDA-dense eligibility."""

from .adapter import ColmapAdapter, StagedImage
from .commands import (
    DenseCapability,
    DenseConfig,
    DenseEligibility,
    DenseEligibilityManifest,
    SparseConfig,
    assess_dense_eligibility,
    build_dense_eligibility_manifest,
    dense_commands,
    sparse_commands,
)
from .parser import ParserLimits, read_sparse_model

__all__ = [
    "ColmapAdapter",
    "DenseCapability",
    "DenseConfig",
    "DenseEligibility",
    "DenseEligibilityManifest",
    "ParserLimits",
    "SparseConfig",
    "StagedImage",
    "assess_dense_eligibility",
    "build_dense_eligibility_manifest",
    "dense_commands",
    "read_sparse_model",
    "sparse_commands",
]
