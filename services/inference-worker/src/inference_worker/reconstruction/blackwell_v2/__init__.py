"""C8 v2 Blackwell acceptance contracts; frozen C8 v1 remains untouched."""

from .colmap_commands import ColmapV2Config, dense_commands, sparse_commands
from .evidence import (
    AlgorithmComponent,
    AlgorithmEvidence,
    AlgorithmVerdict,
    FieldVerdict,
    HashedObject,
    RepeatabilityEvidence,
    RepeatabilityVerdict,
    ResourcePeaks,
    RightsEvidence,
    RunEvidence,
    RuntimeEvidence,
    RuntimeVerdict,
    WorkstationEvidence,
)
from .exposure import (
    CAPABILITY_STATUS,
    PRODUCTION_ROUTING_ENABLED,
    require_production_routing,
)

__all__ = [
    "AlgorithmComponent",
    "AlgorithmEvidence",
    "AlgorithmVerdict",
    "CAPABILITY_STATUS",
    "ColmapV2Config",
    "FieldVerdict",
    "HashedObject",
    "PRODUCTION_ROUTING_ENABLED",
    "RepeatabilityEvidence",
    "RepeatabilityVerdict",
    "ResourcePeaks",
    "RightsEvidence",
    "RunEvidence",
    "RuntimeEvidence",
    "RuntimeVerdict",
    "WorkstationEvidence",
    "dense_commands",
    "require_production_routing",
    "sparse_commands",
]
