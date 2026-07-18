"""Disabled-by-default and deterministic-test C14 enhancement adapters."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from .contracts import (
    ArtifactRole,
    EnhancementCandidate,
    ExactArtifact,
    ProviderExecutionClass,
    ProviderProvenance,
    ProviderResponse,
    ProviderResponseState,
    canonical_json_sha256,
    sha256_bytes,
)
from .errors import EnhancementError, EnhancementSafeCode
from .evaluator import PreparedEnhancementInput
from .png import encode_rgba8


@dataclass(frozen=True, slots=True)
class ExecutionContext:
    deadline_monotonic_ns: int
    maximum_output_bytes: int
    cancelled: Callable[[], bool]
    clock_ns: Callable[[], int]

    def __post_init__(self) -> None:
        if (
            type(self.deadline_monotonic_ns) is not int
            or self.deadline_monotonic_ns < 0
            or type(self.maximum_output_bytes) is not int
            or self.maximum_output_bytes <= 0
            or not callable(self.cancelled)
            or not callable(self.clock_ns)
        ):
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "invalid execution context"
            )

    def checkpoint(self) -> None:
        cancelled = self.cancelled()
        if type(cancelled) is not bool:
            raise EnhancementError(
                EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "invalid cancellation result"
            )
        if cancelled:
            raise EnhancementError(EnhancementSafeCode.CANCELLED, "enhancement cancelled")
        now = self.clock_ns()
        if type(now) is not int or now < 0:
            raise EnhancementError(EnhancementSafeCode.TIME_LIMIT, "invalid monotonic clock")
        if now >= self.deadline_monotonic_ns:
            raise EnhancementError(EnhancementSafeCode.TIME_LIMIT, "enhancement timed out")


class EnhancementProvider(Protocol):
    """Typed provider port. Implementations receive only the strict C14 allowlist."""

    @property
    def provenance(self) -> ProviderProvenance: ...

    def enhance(
        self, prepared: PreparedEnhancementInput, context: ExecutionContext
    ) -> ProviderResponse: ...


_DISABLED_PROVENANCE = ProviderProvenance(
    provider_id="disabled",
    provider_version="1",
    model_id="none",
    model_version="none",
    adapter_version="c14-disabled-v1",
    config_sha256=canonical_json_sha256({"enabled": False}),
    execution_class=ProviderExecutionClass.DISABLED,
    external_network_used=False,
    test_only=False,
    production_eligible=False,
)


class DisabledEnhancementProvider:
    """Production default: honest unavailable state without provider discovery or I/O."""

    @property
    def provenance(self) -> ProviderProvenance:
        return _DISABLED_PROVENANCE

    def enhance(
        self, prepared: PreparedEnhancementInput, context: ExecutionContext
    ) -> ProviderResponse:
        del prepared
        context.checkpoint()
        return ProviderResponse(
            state=ProviderResponseState.DISABLED,
            safe_code=EnhancementSafeCode.PROVIDER_DISABLED,
        )


@dataclass(frozen=True, slots=True)
class DeterministicTestConfig:
    red_delta: int = 1
    green_delta: int = 0
    blue_delta: int = 0

    def __post_init__(self) -> None:
        for value in (self.red_delta, self.green_delta, self.blue_delta):
            if type(value) is not int or not 0 <= value <= 32:
                raise ValueError("test adapter channel deltas must be integers from 0 to 32")
        if self.red_delta == self.green_delta == self.blue_delta == 0:
            raise ValueError("test adapter must make a visible deterministic edit")

    def manifest(self) -> dict[str, int | str]:
        return {
            "adapter": "deterministic-local-test",
            "blueDelta": self.blue_delta,
            "greenDelta": self.green_delta,
            "redDelta": self.red_delta,
            "transform": "bounded-reversible-channel-delta-v1",
        }


def _apply_delta(value: int, delta: int) -> int:
    return value + delta if value <= 255 - delta else value - delta


class DeterministicLocalTestAdapter:
    """Non-production evidence adapter used only to exercise validation.

    It performs no inference, model loading, subprocess execution, file access,
    or networking. It deterministically changes RGB values only where the
    explicit binary mask is 255 and preserves alpha.
    """

    def __init__(self, config: DeterministicTestConfig | None = None) -> None:
        self._config = config or DeterministicTestConfig()
        self._provenance = ProviderProvenance(
            provider_id="deterministic-local-test",
            provider_version="1",
            model_id="pixel-transform-not-a-model",
            model_version="1",
            adapter_version="c14-local-test-v1",
            config_sha256=canonical_json_sha256(self._config.manifest()),
            execution_class=ProviderExecutionClass.DETERMINISTIC_LOCAL_TEST,
            external_network_used=False,
            test_only=True,
            production_eligible=False,
        )

    @property
    def provenance(self) -> ProviderProvenance:
        return self._provenance

    def enhance(
        self, prepared: PreparedEnhancementInput, context: ExecutionContext
    ) -> ProviderResponse:
        context.checkpoint()
        rgba = bytearray(prepared.base.rgba8)
        mask = prepared.allowed_edit_mask.rgba8[0::4]
        for index, editable in enumerate(mask):
            if index % 4_096 == 0:
                context.checkpoint()
            if editable != 255:
                continue
            offset = index * 4
            rgba[offset] = _apply_delta(rgba[offset], self._config.red_delta)
            rgba[offset + 1] = _apply_delta(rgba[offset + 1], self._config.green_delta)
            rgba[offset + 2] = _apply_delta(rgba[offset + 2], self._config.blue_delta)
        content = encode_rgba8(prepared.base.width_px, prepared.base.height_px, bytes(rgba))
        if len(content) > context.maximum_output_bytes:
            return ProviderResponse(
                state=ProviderResponseState.RESOURCE_LIMITED,
                safe_code=EnhancementSafeCode.RESOURCE_LIMIT,
            )
        digest = sha256_bytes(content)
        output = ExactArtifact(
            role=ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG,
            media_type="image/png",
            sha256=digest,
            width_px=prepared.base.width_px,
            height_px=prepared.base.height_px,
            content=content,
        )
        return ProviderResponse(
            state=ProviderResponseState.CANDIDATE,
            candidate=EnhancementCandidate(
                output=output,
                output_sha256=digest,
                base_artifact_sha256=prepared.request.base.sha256,
                conditioning=prepared.request.conditioning_hashes,
                allowed_mask_sha256=prepared.request.allowed_edit_mask.sha256,
                camera_sha256=prepared.request.camera_sha256,
                provenance=self.provenance,
            ),
        )


def default_provider() -> EnhancementProvider:
    """Return the only production default; environment variables cannot enable a provider."""

    return DisabledEnhancementProvider()


def default_clock_ns() -> int:
    return time.monotonic_ns()
