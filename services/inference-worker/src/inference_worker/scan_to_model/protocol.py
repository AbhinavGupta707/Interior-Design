"""Fixed private entry point for bounded C9 scan-to-model execution."""

from __future__ import annotations

import time
from collections.abc import Callable

from .canonical import canonical_json_bytes, sha256_json
from .errors import (
    FittingAbstention,
    WorkCancelled,
    WorkDeadlineExceeded,
    WorkLimitExceeded,
)
from .fitter import WorkGuard, fit_proposal
from .schema import RESULT_SCHEMA_VERSION, parse_request
from .types import FittingRequest, JsonObject, JsonValue

FITTER_NAME = "stdlib-semantic-fitter"
FITTER_VERSION = "1.0.0"
FITTER_CONFIG: JsonObject = {
    "conflictPolicy": "expose-or-abstain",
    "coordinateUnit": "mm",
    "minimumGeometryConfidenceBasisPoints": 1_000,
    "occlusionPolicy": "preserve-unknown",
    "projectionArithmetic": "integer-fixed-point-v1",
    "topologyPolicy": "strict-v1",
}


def _base_json(request: FittingRequest) -> JsonObject:
    return {
        "modelId": request.base_snapshot.model_id,
        "profile": "existing",
        "snapshotId": request.base_snapshot.snapshot_id,
        "snapshotSha256": request.base_snapshot.snapshot_sha256,
    }


def _fitter_manifest() -> JsonObject:
    identity: JsonObject = {"name": FITTER_NAME, "version": FITTER_VERSION}
    return {
        **identity,
        "configSha256": sha256_json(FITTER_CONFIG),
        "manifestSha256": sha256_json({**identity, "config": FITTER_CONFIG}),
        "toolSha256": sha256_json(identity),
    }


def _result(request: FittingRequest, payload: JsonObject) -> JsonObject:
    status = payload.get("status")
    if not isinstance(status, str):
        raise ValueError("result payload has no status")
    return {
        "authority": "proposal-only",
        "baseSnapshot": _base_json(request),
        "fitter": _fitter_manifest(),
        "jobId": request.job_id,
        "payload": payload,
        "payloadSha256": sha256_json(payload),
        "profile": "existing",
        "projectId": request.project_id,
        "requestSha256": request.request_sha256,
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "sourceManifestSha256": request.source_manifest_sha256,
        "status": status,
    }


def _terminal_payload(status: str, safe_code: str) -> JsonObject:
    return {
        "diagnostics": [
            {
                "code": safe_code,
                "message": "Semantic fitting did not publish proposal geometry.",
                "observationIds": [],
                "severity": "warning" if status == "cancelled" else "error",
                "sourceIds": [],
            }
        ],
        "safeCode": safe_code,
        "status": status,
    }


def _bounded_result(request: FittingRequest, result: JsonObject) -> JsonObject:
    if len(canonical_json_bytes(result)) <= request.limits.maximum_output_bytes:
        return result
    fallback = _result(request, _terminal_payload("abstained", "OUTPUT_RESOURCE_LIMIT"))
    if len(canonical_json_bytes(fallback)) > request.limits.maximum_output_bytes:
        raise RuntimeError("bounded scan-to-model abstention exceeds the declared output limit")
    return fallback


def execute_protocol(
    value: object,
    *,
    cancelled: Callable[[], bool] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> JsonObject:
    """Validate and execute one in-memory request without paths, URLs or commands."""

    request = parse_request(value)
    external_cancelled = cancelled or (lambda: False)
    if request.cancellation_requested or external_cancelled():
        return _bounded_result(
            request, _result(request, _terminal_payload("cancelled", "CANCELLED"))
        )
    guard = WorkGuard.create(
        request.limits.timeout_milliseconds,
        request.limits.maximum_work_units,
        cancelled=external_cancelled,
        clock=clock,
    )
    try:
        payload = fit_proposal(request, guard)
    except FittingAbstention as error:
        payload = _terminal_payload("abstained", error.safe_code)
    except WorkCancelled:
        payload = _terminal_payload("cancelled", "CANCELLED")
    except WorkLimitExceeded:
        payload = _terminal_payload("abstained", "WORK_RESOURCE_LIMIT")
    except WorkDeadlineExceeded:
        payload = _terminal_payload("abstained", "FITTING_TIMEOUT")
    return _bounded_result(request, _result(request, payload))


def result_bytes(result: JsonValue) -> bytes:
    """Canonical encoding helper for the subprocess boundary and integration tests."""

    return canonical_json_bytes(result)
