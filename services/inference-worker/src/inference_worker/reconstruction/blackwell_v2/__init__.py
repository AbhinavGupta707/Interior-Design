"""C8 v2 Blackwell contracts; the frozen C8 v1 adapters remain untouched."""

from .colmap_commands import ColmapV2Config, dense_commands, sparse_commands
from .evidence import (
    AlgorithmEvidence,
    AlgorithmVerdict,
    FieldVerdict,
    RepeatabilityVerdict,
    RunEvidence,
    RuntimeVerdict,
)

__all__ = [
    "AlgorithmEvidence",
    "AlgorithmVerdict",
    "ColmapV2Config",
    "FieldVerdict",
    "RepeatabilityVerdict",
    "RunEvidence",
    "RuntimeVerdict",
    "dense_commands",
    "sparse_commands",
]
