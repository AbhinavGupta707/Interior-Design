"""Independent hostile-provider, privacy, and resource-bound evidence for C14."""

from __future__ import annotations

import dataclasses
import math
import socket
from collections.abc import Callable
from typing import cast

import pytest
from inference_worker.image_enhancement import (
    ArtifactRole,
    DeterministicLocalTestAdapter,
    EnhancementCandidate,
    EnhancementError,
    EnhancementOutcomeState,
    EnhancementProvider,
    EnhancementRequest,
    EnhancementSafeCode,
    EnhancementService,
    ExactArtifact,
    GeometryGuardReport,
    ProviderExecutionClass,
    ProviderProvenance,
    ProviderResponse,
    ProviderResponseState,
    canonical_json_sha256,
    sha256_bytes,
)
from inference_worker.image_enhancement.adapters import ExecutionContext
from inference_worker.image_enhancement.evaluator import PreparedEnhancementInput
from inference_worker.image_enhancement.png import PNG_SIGNATURE


class FixtureProvider:
    def __init__(
        self,
        provenance: ProviderProvenance,
        response: ProviderResponse | Callable[[], ProviderResponse],
    ) -> None:
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
        return self._response() if callable(self._response) else self._response


def _candidate(
    request: EnhancementRequest,
    provenance: ProviderProvenance,
    output: ExactArtifact,
) -> EnhancementCandidate:
    return EnhancementCandidate(
        output=output,
        output_sha256=output.sha256,
        base_artifact_sha256=request.base.sha256,
        conditioning=request.conditioning_hashes,
        allowed_mask_sha256=request.allowed_edit_mask.sha256,
        camera_sha256=request.camera_sha256,
        provenance=provenance,
    )


def test_truncated_untrusted_output_is_quarantined(
    security_request: EnhancementRequest,
) -> None:
    content = PNG_SIGNATURE + b"truncated-hostile-output"
    output = ExactArtifact(
        role=ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG,
        media_type="image/png",
        sha256=sha256_bytes(content),
        width_px=64,
        height_px=64,
        content=content,
    )
    provenance = DeterministicLocalTestAdapter().provenance
    response = ProviderResponse(
        state=ProviderResponseState.CANDIDATE,
        candidate=_candidate(security_request, provenance, output),
    )

    result = EnhancementService(FixtureProvider(provenance, response), allow_test_adapter=True).run(
        security_request
    )

    assert result.state is EnhancementOutcomeState.REJECTED
    assert result.safe_code is EnhancementSafeCode.PNG_INVALID
    assert result.geometry_guard is not None
    assert not result.geometry_guard.accepted
    assert result.artifact is None
    assert not result.presentable
    assert result.safe_result_affected is False


def test_type_confused_provider_response_and_non_finite_config_fail_closed(
    security_request: EnhancementRequest,
) -> None:
    provenance = DeterministicLocalTestAdapter().provenance

    class TypeConfusedProvider:
        @property
        def provenance(self) -> ProviderProvenance:
            return provenance

        def enhance(
            self, prepared: PreparedEnhancementInput, context: ExecutionContext
        ) -> ProviderResponse:
            del prepared, context
            return cast("ProviderResponse", {"state": "candidate", "score": math.nan})

    result = EnhancementService(
        cast("EnhancementProvider", TypeConfusedProvider()), allow_test_adapter=True
    ).run(security_request)
    assert result.state is EnhancementOutcomeState.FAILED
    assert result.safe_code is EnhancementSafeCode.PROVIDER_OUTPUT_INVALID
    assert not result.presentable

    for non_finite in (math.nan, math.inf, -math.inf):
        with pytest.raises(EnhancementError, match=EnhancementSafeCode.NON_FINITE_VALUE.value):
            canonical_json_sha256({"hostileMetric": non_finite})
    for oversized in ("x" * 4_097, 2**64):
        with pytest.raises(EnhancementError, match=EnhancementSafeCode.RESOURCE_LIMIT.value):
            canonical_json_sha256({"hostile": oversized})
    deeply_nested: object = "leaf"
    for _index in range(18):
        deeply_nested = [deeply_nested]
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.RESOURCE_LIMIT.value):
        canonical_json_sha256(deeply_nested)


def test_exact_provider_model_and_config_provenance_is_required(
    security_request: EnhancementRequest,
) -> None:
    adapter = DeterministicLocalTestAdapter()
    accepted = EnhancementService(adapter, allow_test_adapter=True).run(security_request)
    assert accepted.artifact is not None
    output = ExactArtifact(
        role=ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG,
        media_type="image/png",
        sha256=accepted.artifact.sha256,
        width_px=accepted.artifact.width_px,
        height_px=accepted.artifact.height_px,
        content=accepted.artifact.content,
    )
    mismatched = dataclasses.replace(
        adapter.provenance,
        config_sha256=canonical_json_sha256({"different": True}),
    )
    candidate = _candidate(security_request, mismatched, output)
    provider = FixtureProvider(
        adapter.provenance,
        ProviderResponse(state=ProviderResponseState.CANDIDATE, candidate=candidate),
    )

    result = EnhancementService(provider, allow_test_adapter=True).run(security_request)

    assert result.state is EnhancementOutcomeState.REJECTED
    assert result.safe_code is EnhancementSafeCode.PROVIDER_PROVENANCE_MISMATCH
    assert result.artifact is None
    assert not result.presentable


def test_artifact_dimensions_hashes_and_runtime_types_are_bounded(
    security_request: EnhancementRequest,
) -> None:
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.INPUT_INVALID.value):
        dataclasses.replace(security_request.base, width_px=cast("int", True))
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.INPUT_INVALID.value):
        dataclasses.replace(security_request.base, width_px=4_097)
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.INPUT_HASH_MISMATCH.value):
        dataclasses.replace(security_request.base, sha256="0" * 64)
    with pytest.raises(EnhancementError, match=EnhancementSafeCode.CONDITIONING_MISMATCH.value):
        dataclasses.replace(
            security_request,
            depth=dataclasses.replace(security_request.depth, width_px=128),
        )


def test_request_schema_cannot_carry_private_unrelated_context() -> None:
    names = {field.name for field in dataclasses.fields(EnhancementRequest)}
    assert names == {
        "base",
        "depth",
        "normal",
        "segmentation",
        "allowed_edit_mask",
        "camera_sha256",
        "schema_version",
    }
    assert names.isdisjoint({"address", "notes", "schedules", "prompt", "evidence", "token"})
    guard_names = {field.name for field in dataclasses.fields(GeometryGuardReport)}
    assert all("millimetre" not in name and not name.endswith("_mm") for name in guard_names)
    assert guard_names.isdisjoint({"depth_error_mm", "depth_deviation_mm", "inferred_depth_mm"})


def test_cancellation_after_hostile_provider_return_still_blocks_publication(
    security_request: EnhancementRequest,
) -> None:
    adapter = DeterministicLocalTestAdapter()
    successful = EnhancementService(adapter, allow_test_adapter=True).run(security_request)
    assert successful.artifact is not None
    output = ExactArtifact(
        role=ArtifactRole.ILLUSTRATIVE_ENHANCEMENT_PNG,
        media_type="image/png",
        sha256=successful.artifact.sha256,
        width_px=64,
        height_px=64,
        content=successful.artifact.content,
    )
    response = ProviderResponse(
        state=ProviderResponseState.CANDIDATE,
        candidate=_candidate(security_request, adapter.provenance, output),
    )
    checks = 0

    def cancelled() -> bool:
        nonlocal checks
        checks += 1
        return checks >= 3

    result = EnhancementService(
        FixtureProvider(adapter.provenance, response), allow_test_adapter=True
    ).run(security_request, cancelled=cancelled)
    assert result.state is EnhancementOutcomeState.CANCELLED
    assert result.artifact is None
    assert not result.presentable
    assert result.safe_result_affected is False


def test_local_test_adapter_performs_no_network_or_provider_discovery(
    security_request: EnhancementRequest,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_socket(*args: object, **kwargs: object) -> socket.socket:
        del args, kwargs
        raise AssertionError("network access is forbidden")

    monkeypatch.setattr(socket, "socket", forbidden_socket)
    result = EnhancementService(DeterministicLocalTestAdapter(), allow_test_adapter=True).run(
        security_request
    )
    assert result.state is EnhancementOutcomeState.SUCCEEDED
    assert result.provenance.external_network_used is False
    assert result.provenance.test_only is True
    assert result.provenance.production_eligible is False


def test_injected_external_provider_has_no_activation_path(
    security_request: EnhancementRequest,
) -> None:
    provenance = ProviderProvenance(
        provider_id="hostile-external-fixture",
        provider_version="1",
        model_id="unapproved-model",
        model_version="1",
        adapter_version="unapproved-adapter-v1",
        config_sha256=canonical_json_sha256({"enabled": True}),
        execution_class=ProviderExecutionClass.EXTERNAL,
        external_network_used=True,
        test_only=False,
        production_eligible=True,
    )
    provider = FixtureProvider(
        provenance,
        ProviderResponse(
            state=ProviderResponseState.FAILED,
            safe_code=EnhancementSafeCode.PROVIDER_FAILED,
        ),
    )

    result = EnhancementService(provider).run(security_request)

    assert result.state is EnhancementOutcomeState.DISABLED
    assert result.safe_code is EnhancementSafeCode.PROVIDER_DISABLED
    assert provider.calls == 0
    assert not result.presentable
    assert result.safe_result_affected is False


def test_diagnostics_and_exceptions_exclude_private_payloads_and_hashes(
    security_request: EnhancementRequest,
) -> None:
    private_markers = (
        "14 Private Address",
        "household medical note",
        "private schedule",
        security_request.base.sha256,
        security_request.camera_sha256,
    )
    error = EnhancementError(
        EnhancementSafeCode.PROVIDER_FAILED,
        "14 Private Address household medical note private schedule",
    )
    assert str(error) == EnhancementSafeCode.PROVIDER_FAILED.value
    assert all(marker not in repr(security_request) for marker in private_markers)

    result = EnhancementService().run(security_request)
    rendered = repr(result.diagnostic()) + repr(result) + str(error)
    assert all(marker not in rendered for marker in private_markers)
    assert result.diagnostic() == {
        "event": "image-enhancement.completed",
        "state": "disabled",
        "safeCode": "IMAGE_ENHANCEMENT_PROVIDER_DISABLED",
        "providerClass": "disabled",
        "testOnly": False,
        "presentable": False,
        "safeResultAffected": False,
    }
