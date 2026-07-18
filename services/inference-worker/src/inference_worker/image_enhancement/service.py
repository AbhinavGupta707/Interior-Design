"""Fail-closed orchestration for optional C14 image enhancement."""

from __future__ import annotations

from collections.abc import Callable

from .adapters import (
    EnhancementProvider,
    ExecutionContext,
    default_clock_ns,
    default_provider,
)
from .contracts import (
    EnhancementArtifact,
    EnhancementOutcome,
    EnhancementOutcomeState,
    EnhancementRequest,
    ExecutionLimits,
    ProviderExecutionClass,
    ProviderProvenance,
    ProviderResponse,
    ProviderResponseState,
)
from .errors import EnhancementError, EnhancementSafeCode
from .evaluator import evaluate_candidate, prepare_request, rejected_candidate_report

_STATE_MAP = {
    ProviderResponseState.DISABLED: EnhancementOutcomeState.DISABLED,
    ProviderResponseState.FAILED: EnhancementOutcomeState.FAILED,
    ProviderResponseState.CANCELLED: EnhancementOutcomeState.CANCELLED,
    ProviderResponseState.TIMED_OUT: EnhancementOutcomeState.TIMED_OUT,
    ProviderResponseState.RESOURCE_LIMITED: EnhancementOutcomeState.RESOURCE_LIMITED,
}


def _failure_state(code: EnhancementSafeCode) -> EnhancementOutcomeState:
    if code is EnhancementSafeCode.CANCELLED:
        return EnhancementOutcomeState.CANCELLED
    if code is EnhancementSafeCode.TIME_LIMIT:
        return EnhancementOutcomeState.TIMED_OUT
    if code in {EnhancementSafeCode.RESOURCE_LIMIT, EnhancementSafeCode.PNG_RESOURCE_LIMIT}:
        return EnhancementOutcomeState.RESOURCE_LIMITED
    return EnhancementOutcomeState.FAILED


class EnhancementService:
    """Run a provider child operation without ever changing the safe result."""

    def __init__(
        self,
        provider: EnhancementProvider | None = None,
        *,
        allow_test_adapter: bool = False,
        clock_ns: Callable[[], int] = default_clock_ns,
    ) -> None:
        selected_provider = provider or default_provider()
        self._invalid_provider = False
        try:
            provenance = selected_provider.provenance
            if type(provenance) is not ProviderProvenance:
                raise TypeError("invalid provider provenance")
        except Exception:
            selected_provider = default_provider()
            provenance = selected_provider.provenance
            self._invalid_provider = True
        self._provider = selected_provider
        self._provenance = provenance
        self._allow_test_adapter = allow_test_adapter if type(allow_test_adapter) is bool else False
        self._clock_ns = clock_ns

    def _outcome(
        self,
        state: EnhancementOutcomeState,
        safe_code: EnhancementSafeCode,
    ) -> EnhancementOutcome:
        return EnhancementOutcome(
            state=state,
            safe_code=safe_code,
            provenance=self._provenance,
            safe_result_affected=False,
        )

    def run(
        self,
        request: EnhancementRequest,
        *,
        limits: ExecutionLimits | None = None,
        cancelled: Callable[[], bool] | None = None,
    ) -> EnhancementOutcome:
        effective_limits = limits or ExecutionLimits()
        if self._invalid_provider:
            return self._outcome(
                EnhancementOutcomeState.FAILED, EnhancementSafeCode.PROVIDER_OUTPUT_INVALID
            )
        if self._provenance.execution_class in {
            ProviderExecutionClass.DISABLED,
            ProviderExecutionClass.EXTERNAL,
        }:
            return self._outcome(
                EnhancementOutcomeState.DISABLED, EnhancementSafeCode.PROVIDER_DISABLED
            )
        if (
            self._provenance.execution_class is ProviderExecutionClass.DETERMINISTIC_LOCAL_TEST
            and not self._allow_test_adapter
        ):
            return self._outcome(
                EnhancementOutcomeState.DISABLED, EnhancementSafeCode.TEST_ADAPTER_NOT_ALLOWED
            )
        try:
            prepared = prepare_request(request)
        except EnhancementError as error:
            return self._outcome(_failure_state(error.safe_code), error.safe_code)
        except Exception:
            return self._outcome(EnhancementOutcomeState.FAILED, EnhancementSafeCode.INPUT_INVALID)

        try:
            started = self._clock_ns()
            if type(started) is not int or started < 0:
                raise EnhancementError(EnhancementSafeCode.TIME_LIMIT, "invalid monotonic clock")
        except EnhancementError as error:
            return self._outcome(_failure_state(error.safe_code), error.safe_code)
        except Exception:
            return self._outcome(
                EnhancementOutcomeState.FAILED, EnhancementSafeCode.PROVIDER_FAILED
            )
        context = ExecutionContext(
            deadline_monotonic_ns=started + effective_limits.timeout_milliseconds * 1_000_000,
            maximum_output_bytes=effective_limits.maximum_output_bytes,
            cancelled=cancelled or (lambda: False),
            clock_ns=self._clock_ns,
        )
        try:
            context.checkpoint()
            response = self._provider.enhance(prepared, context)
            context.checkpoint()
            if type(response) is not ProviderResponse:
                raise EnhancementError(
                    EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "provider response type"
                )
        except EnhancementError as error:
            return self._outcome(_failure_state(error.safe_code), error.safe_code)
        except Exception:
            return self._outcome(
                EnhancementOutcomeState.FAILED, EnhancementSafeCode.PROVIDER_FAILED
            )

        if response.state is not ProviderResponseState.CANDIDATE:
            state = _STATE_MAP.get(response.state, EnhancementOutcomeState.FAILED)
            return self._outcome(
                state, response.safe_code or EnhancementSafeCode.PROVIDER_OUTPUT_INVALID
            )
        candidate = response.candidate
        if candidate is None:
            return self._outcome(
                EnhancementOutcomeState.FAILED, EnhancementSafeCode.PROVIDER_OUTPUT_INVALID
            )
        if len(candidate.output.content) > effective_limits.maximum_output_bytes:
            return self._outcome(
                EnhancementOutcomeState.RESOURCE_LIMITED, EnhancementSafeCode.RESOURCE_LIMIT
            )
        try:
            guard = evaluate_candidate(
                prepared,
                candidate,
                self._provenance,
                checkpoint=context.checkpoint,
            )
        except EnhancementError as error:
            if error.safe_code in {
                EnhancementSafeCode.CANCELLED,
                EnhancementSafeCode.TIME_LIMIT,
                EnhancementSafeCode.RESOURCE_LIMIT,
                EnhancementSafeCode.PNG_RESOURCE_LIMIT,
            }:
                return self._outcome(_failure_state(error.safe_code), error.safe_code)
            guard = rejected_candidate_report(prepared, candidate, error.safe_code)
            return EnhancementOutcome(
                state=EnhancementOutcomeState.REJECTED,
                safe_code=error.safe_code,
                provenance=self._provenance,
                geometry_guard=guard,
                safe_result_affected=False,
            )
        except Exception:
            guard = rejected_candidate_report(
                prepared, candidate, EnhancementSafeCode.PROVIDER_OUTPUT_INVALID
            )
            return EnhancementOutcome(
                state=EnhancementOutcomeState.REJECTED,
                safe_code=EnhancementSafeCode.PROVIDER_OUTPUT_INVALID,
                provenance=self._provenance,
                geometry_guard=guard,
                safe_result_affected=False,
            )
        if not guard.accepted:
            return EnhancementOutcome(
                state=EnhancementOutcomeState.REJECTED,
                safe_code=guard.safe_code or EnhancementSafeCode.PROVIDER_OUTPUT_INVALID,
                provenance=self._provenance,
                geometry_guard=guard,
                safe_result_affected=False,
            )
        artifact = EnhancementArtifact(
            sha256=candidate.output.sha256,
            width_px=candidate.output.width_px,
            height_px=candidate.output.height_px,
            byte_length=len(candidate.output.content),
            content=candidate.output.content,
        )
        return EnhancementOutcome(
            state=EnhancementOutcomeState.SUCCEEDED,
            safe_code=None,
            provenance=self._provenance,
            geometry_guard=guard,
            artifact=artifact,
            safe_result_affected=False,
        )
