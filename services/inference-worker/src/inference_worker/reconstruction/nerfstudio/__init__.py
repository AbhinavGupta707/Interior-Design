"""Optional C8 Nerfstudio appearance adapter."""

from .adapter import (
    AppearanceRunOutcome,
    ArtifactPublisher,
    NeuralAppearanceAdapter,
    TrustedStagedFrames,
    unavailable_nerfstudio_adapter,
)
from .contracts import ManifestError, parse_appearance_input
from .runtime import register_runtime

__all__ = [
    "AppearanceRunOutcome",
    "ArtifactPublisher",
    "ManifestError",
    "NeuralAppearanceAdapter",
    "TrustedStagedFrames",
    "parse_appearance_input",
    "register_runtime",
    "unavailable_nerfstudio_adapter",
]
