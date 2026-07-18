"""Provider-disabled-by-default optional image enhancement for C14."""

from .adapters import (
    DeterministicLocalTestAdapter,
    DeterministicTestConfig,
    DisabledEnhancementProvider,
    EnhancementProvider,
    default_provider,
)
from .contracts import (
    ArtifactRole,
    ConditioningHashes,
    EnhancementArtifact,
    EnhancementCandidate,
    EnhancementOutcome,
    EnhancementOutcomeState,
    EnhancementRequest,
    ExactArtifact,
    ExecutionLimits,
    GeometryGuardReport,
    ProviderExecutionClass,
    ProviderProvenance,
    ProviderResponse,
    ProviderResponseState,
    canonical_json_sha256,
    sha256_bytes,
)
from .errors import EnhancementError, EnhancementSafeCode
from .service import EnhancementService

__all__ = [
    "ArtifactRole",
    "ConditioningHashes",
    "DeterministicLocalTestAdapter",
    "DeterministicTestConfig",
    "DisabledEnhancementProvider",
    "EnhancementArtifact",
    "EnhancementCandidate",
    "EnhancementError",
    "EnhancementOutcome",
    "EnhancementOutcomeState",
    "EnhancementProvider",
    "EnhancementRequest",
    "EnhancementSafeCode",
    "EnhancementService",
    "ExactArtifact",
    "ExecutionLimits",
    "GeometryGuardReport",
    "ProviderExecutionClass",
    "ProviderProvenance",
    "ProviderResponse",
    "ProviderResponseState",
    "canonical_json_sha256",
    "default_provider",
    "sha256_bytes",
]
