"""Provider states, deterministic replay, and geometry-guard behavior."""

from __future__ import annotations

from dataclasses import replace

from inference_worker.image_enhancement import (
    ArtifactRole,
    ConditioningHashes,
    DeterministicLocalTestAdapter,
    EnhancementCandidate,
    EnhancementOutcomeState,
    EnhancementRequest,
    EnhancementSafeCode,
    EnhancementService,
    ExactArtifact,
    ExecutionLimits,
    ProviderProvenance,
    ProviderResponse,
    ProviderResponseState,
    sha256_bytes,
)
from inference_worker.image_enhancement.adapters import ExecutionContext
from inference_worker.image_enhancement.evaluator import PreparedEnhancementInput
from inference_worker.image_enhancement.png import decode_png, encode_grayscale8, encode_rgba8

from .conftest import HEIGHT, WIDTH, make_request


class StaticProvider:
    def __init__(self, provenance: ProviderProvenance, response: ProviderResponse) -> None:
        self._provenance = provenance
        self._response = response
        self.calls = 0

    @property
    def provenance(self) -> ProviderProvenance:
        return self._provenance

    def enhance(
        self, prepared: PreparedEnhancementInput, context: ExecutionContext
    ) -> ProviderResponse:
        del prepared
        context.checkpoint()
        self.calls += 1
        return self._response


def _changed_output(request: EnhancementRequest, pixels: set[tuple[int, int]]) -> ExactArtifact:
    base = decode_png(request.base.content, allowed_colour_types=frozenset({6}))
    rgba = bytearray(base.rgba8)
    for x, y in pixels:
        rgba[(y * WIDTH + x) * 4] ^= 0x01
    content = encode_rgba8(WIDTH, HEIGHT, bytes(rgba))
    return ExactArtifact(
        role=ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG,
        media_type="image/png",
        sha256=sha256_bytes(content),
        width_px=WIDTH,
        height_px=HEIGHT,
        content=content,
    )


def _candidate(
    request: EnhancementRequest,
    provenance: ProviderProvenance,
    *,
    pixels: set[tuple[int, int]],
    base_sha256: str | None = None,
    conditioning: ConditioningHashes | None = None,
    camera_sha256: str | None = None,
) -> EnhancementCandidate:
    output = _changed_output(request, pixels)
    return EnhancementCandidate(
        output=output,
        output_sha256=output.sha256,
        base_artifact_sha256=base_sha256 or request.base.sha256,
        conditioning=conditioning or request.conditioning_hashes,
        allowed_mask_sha256=request.allowed_edit_mask.sha256,
        camera_sha256=camera_sha256 or request.camera_sha256,
        provenance=provenance,
    )


def test_provider_is_disabled_by_default_and_safe_result_remains_primary(
    synthetic_request: EnhancementRequest,
) -> None:
    result = EnhancementService().run(synthetic_request)

    assert result.state is EnhancementOutcomeState.DISABLED
    assert result.safe_code is EnhancementSafeCode.PROVIDER_DISABLED
    assert not result.presentable
    assert result.artifact is None
    assert result.geometry_guard is None
    assert result.safe_result_affected is False
    assert result.provenance.external_network_used is False


def test_local_adapter_requires_explicit_test_opt_in(
    synthetic_request: EnhancementRequest,
) -> None:
    result = EnhancementService(DeterministicLocalTestAdapter()).run(synthetic_request)

    assert result.state is EnhancementOutcomeState.DISABLED
    assert result.safe_code is EnhancementSafeCode.TEST_ADAPTER_NOT_ALLOWED
    assert not result.presentable


def test_local_adapter_is_replay_deterministic_and_explicitly_non_production(
    synthetic_request: EnhancementRequest,
) -> None:
    service = EnhancementService(DeterministicLocalTestAdapter(), allow_test_adapter=True)
    first = service.run(synthetic_request)
    second = service.run(synthetic_request)

    assert first.state is second.state is EnhancementOutcomeState.SUCCEEDED
    assert first.presentable and second.presentable
    assert first.artifact is not None and second.artifact is not None
    assert first.artifact.sha256 == second.artifact.sha256
    assert first.artifact.content == second.artifact.content
    assert first.geometry_guard == second.geometry_guard
    assert first.geometry_guard is not None
    assert first.geometry_guard.changed_outside_allowed_mask_pixels == 0
    assert first.geometry_guard.protected_geometry_moved is False
    assert first.provenance.test_only is True
    assert first.provenance.production_eligible is False
    assert first.provenance.external_network_used is False


def test_cancellation_timeout_and_resource_states_do_not_publish(
    synthetic_request: EnhancementRequest,
) -> None:
    adapter = DeterministicLocalTestAdapter()
    cancelled = EnhancementService(adapter, allow_test_adapter=True).run(
        synthetic_request, cancelled=lambda: True
    )
    assert cancelled.state is EnhancementOutcomeState.CANCELLED
    assert not cancelled.presentable

    class AdvancingClock:
        def __init__(self) -> None:
            self.value = 0

        def __call__(self) -> int:
            self.value += 2_000_000
            return self.value

    timed_out = EnhancementService(adapter, allow_test_adapter=True, clock_ns=AdvancingClock()).run(
        synthetic_request, limits=ExecutionLimits(timeout_milliseconds=1)
    )
    assert timed_out.state is EnhancementOutcomeState.TIMED_OUT
    assert not timed_out.presentable

    limited = EnhancementService(adapter, allow_test_adapter=True).run(
        synthetic_request, limits=ExecutionLimits(maximum_output_bytes=64)
    )
    assert limited.state is EnhancementOutcomeState.RESOURCE_LIMITED
    assert limited.artifact is None
    assert limited.safe_result_affected is False


def test_change_outside_allowed_mask_is_rejected(
    synthetic_request: EnhancementRequest,
) -> None:
    provenance = DeterministicLocalTestAdapter().provenance
    candidate = _candidate(synthetic_request, provenance, pixels={(2, 2)})
    provider = StaticProvider(
        provenance,
        ProviderResponse(state=ProviderResponseState.CANDIDATE, candidate=candidate),
    )

    result = EnhancementService(provider, allow_test_adapter=True).run(synthetic_request)

    assert result.state is EnhancementOutcomeState.REJECTED
    assert result.safe_code is EnhancementSafeCode.OUTSIDE_ALLOWED_MASK_CHANGED
    assert result.geometry_guard is not None
    assert result.geometry_guard.changed_outside_allowed_mask_pixels == 1
    assert result.artifact is None
    assert not result.presentable
    assert result.safe_result_affected is False


def test_changed_protected_edge_is_rejected_even_when_mask_allows_it() -> None:
    protected_edge = (8, 8)
    request = make_request(editable_pixels={protected_edge})
    provenance = DeterministicLocalTestAdapter().provenance
    candidate = _candidate(request, provenance, pixels={protected_edge})
    provider = StaticProvider(
        provenance,
        ProviderResponse(state=ProviderResponseState.CANDIDATE, candidate=candidate),
    )

    result = EnhancementService(provider, allow_test_adapter=True).run(request)

    assert result.state is EnhancementOutcomeState.REJECTED
    assert result.safe_code is EnhancementSafeCode.PROTECTED_GEOMETRY_CHANGED
    assert result.geometry_guard is not None
    assert result.geometry_guard.changed_outside_allowed_mask_pixels == 0
    assert result.geometry_guard.protected_geometry_moved is True
    assert result.geometry_guard.protected_edge_agreement_basis_points < 10_000
    assert result.artifact is None


def test_hostile_protected_edge_fixture_fails_both_frozen_thresholds() -> None:
    protected_edges = {
        (x, y) for y in range(8, 56) for x in range(8, 56) if x in {8, 55} or y in {8, 55}
    }
    request = make_request(editable_pixels=protected_edges)
    provenance = DeterministicLocalTestAdapter().provenance
    candidate = _candidate(request, provenance, pixels=protected_edges)
    provider = StaticProvider(
        provenance,
        ProviderResponse(state=ProviderResponseState.CANDIDATE, candidate=candidate),
    )

    result = EnhancementService(provider, allow_test_adapter=True).run(request)

    assert result.state is EnhancementOutcomeState.REJECTED
    assert result.geometry_guard is not None
    assert result.geometry_guard.protected_edge_agreement_basis_points < 9_800
    assert result.geometry_guard.segmentation_iou_basis_points < 9_800
    assert result.artifact is None


def test_non_binary_allowed_edit_mask_fails_before_provider_execution(
    synthetic_request: EnhancementRequest,
) -> None:
    invalid_mask = encode_grayscale8(WIDTH, HEIGHT, bytes((127,)) * (WIDTH * HEIGHT))
    request = replace(
        synthetic_request,
        allowed_edit_mask=ExactArtifact(
            role=ArtifactRole.ALLOWED_EDIT_MASK_PNG,
            media_type="image/png",
            sha256=sha256_bytes(invalid_mask),
            width_px=WIDTH,
            height_px=HEIGHT,
            content=invalid_mask,
        ),
    )
    adapter = DeterministicLocalTestAdapter()
    provider = StaticProvider(
        adapter.provenance,
        ProviderResponse(
            state=ProviderResponseState.FAILED,
            safe_code=EnhancementSafeCode.PROVIDER_FAILED,
        ),
    )

    result = EnhancementService(provider, allow_test_adapter=True).run(request)

    assert result.state is EnhancementOutcomeState.FAILED
    assert result.safe_code is EnhancementSafeCode.ALLOWED_MASK_INVALID
    assert provider.calls == 0


def test_mismatched_base_conditioning_and_camera_are_fail_closed(
    synthetic_request: EnhancementRequest,
) -> None:
    provenance = DeterministicLocalTestAdapter().provenance
    cases = (
        (
            _candidate(
                synthetic_request,
                provenance,
                pixels={(20, 20)},
                base_sha256="0" * 64,
            ),
            EnhancementSafeCode.BASE_ARTIFACT_MISMATCH,
        ),
        (
            _candidate(
                synthetic_request,
                provenance,
                pixels={(20, 20)},
                conditioning=replace(synthetic_request.conditioning_hashes, depth="0" * 64),
            ),
            EnhancementSafeCode.CONDITIONING_MISMATCH,
        ),
        (
            _candidate(
                synthetic_request,
                provenance,
                pixels={(20, 20)},
                camera_sha256="0" * 64,
            ),
            EnhancementSafeCode.CAMERA_MISMATCH,
        ),
    )
    for candidate, safe_code in cases:
        provider = StaticProvider(
            provenance,
            ProviderResponse(state=ProviderResponseState.CANDIDATE, candidate=candidate),
        )
        result = EnhancementService(provider, allow_test_adapter=True).run(synthetic_request)
        assert result.state is EnhancementOutcomeState.REJECTED
        assert result.safe_code is safe_code
        assert result.artifact is None
        assert not result.presentable
