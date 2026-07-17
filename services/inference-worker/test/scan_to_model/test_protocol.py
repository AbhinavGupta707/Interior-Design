"""Contract, determinism, resource and CLI tests for C9 semantic fitting."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable, Mapping
from typing import cast

import pytest
from inference_worker.scan_to_model import canonical_json_bytes, execute_protocol
from inference_worker.scan_to_model.canonical import decode_json_bytes, sha256_json
from inference_worker.scan_to_model.cli import MAXIMUM_STDIN_BYTES, run
from inference_worker.scan_to_model.errors import ScanToModelError

from .conftest import (
    cloned_request,
    manifest_from,
    observations_from,
    rehash,
    request_fixture,
    sources_from,
)


def payload(result: Mapping[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", result["payload"])


def geometry(result: Mapping[str, object]) -> dict[str, object]:
    return cast("dict[str, object]", payload(result)["geometry"])


def test_valid_multi_floor_fit_is_proposal_only_and_fully_source_pinned() -> None:
    request = request_fixture()
    before = copy.deepcopy(request)

    result = execute_protocol(request)

    assert request == before
    assert result["authority"] == "proposal-only"
    assert result["profile"] == "existing"
    assert result["status"] == "proposal"
    assert result["schemaVersion"] == "c9-scan-to-model-result-v1"
    assert result["sourceManifestSha256"] == manifest_from(request)["manifestSha256"]
    proposal_geometry = geometry(result)
    assert len(cast("list[object]", proposal_geometry["levels"])) == 2
    assert len(cast("list[object]", proposal_geometry["walls"])) == 8
    assert len(cast("list[object]", proposal_geometry["surfaces"])) == 8
    assert len(cast("list[object]", proposal_geometry["spaces"])) == 2
    assert len(cast("list[object]", proposal_geometry["openings"])) == 1
    assert len(cast("list[object]", proposal_geometry["stairs"])) == 1
    assert len(cast("list[object]", proposal_geometry["fixedObjects"])) == 1
    encoded = canonical_json_bytes(result).decode("utf-8")
    for exact_hash in ("a" * 64, "b" * 64, "2" * 64, "3" * 64, "c" * 64, "d" * 64):
        assert exact_hash in encoded
    assert result["payloadSha256"] == sha256_json(result["payload"])


def test_source_and_observation_order_do_not_change_canonical_result_or_hash() -> None:
    original = request_fixture()
    reordered = cloned_request()
    sources = sources_from(reordered)
    sources.reverse()
    for source in sources:
        observations_from(source).reverse()
    rehash(reordered)

    first = execute_protocol(original)
    second = execute_protocol(reordered)

    assert manifest_from(original)["manifestSha256"] == manifest_from(reordered)["manifestSha256"]
    assert first["requestSha256"] == second["requestSha256"]
    assert first == second
    assert canonical_json_bytes(first) == canonical_json_bytes(second)


def test_polygon_cycle_direction_does_not_change_manifest_or_result() -> None:
    original = request_fixture()
    reordered = cloned_request()
    for source in sources_from(reordered):
        for observation in observations_from(source):
            if "boundary" in observation:
                cast("list[object]", observation["boundary"]).reverse()
            if "polygon" in observation:
                cast("list[object]", observation["polygon"]).reverse()
    rehash(reordered)

    assert manifest_from(original)["manifestSha256"] == manifest_from(reordered)["manifestSha256"]
    assert execute_protocol(original) == execute_protocol(reordered)


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (lambda value: value.__setitem__("unknown", True), "INVALID_REQUEST"),
        (
            lambda value: manifest_from(value).__setitem__("manifestSha256", "f" * 64),
            "MANIFEST_HASH_MISMATCH",
        ),
        (
            lambda value: cast("dict[str, object]", value["limits"]).__setitem__(
                "maximumVertices", 3
            ),
            "RESOURCE_LIMIT",
        ),
    ],
)
def test_strict_request_hash_and_budget_validation(
    mutation: Callable[[dict[str, object]], None], code: str
) -> None:
    request = cloned_request()
    mutation(request)
    with pytest.raises(ScanToModelError, match=code):
        execute_protocol(request)


def test_non_finite_duplicate_key_and_floating_point_json_are_rejected() -> None:
    with pytest.raises(ScanToModelError, match="INVALID_JSON"):
        decode_json_bytes(b'{"a":1,"a":2}')
    with pytest.raises(ScanToModelError, match="INVALID_JSON"):
        decode_json_bytes(b'{"value":NaN}')
    with pytest.raises(ScanToModelError, match="INVALID_NUMBER"):
        decode_json_bytes(b'{"value":1.5}')


def test_declared_cancellation_and_cooperative_cancellation_are_terminal() -> None:
    declared = cloned_request()
    cast("dict[str, object]", declared["cancellation"])["requested"] = True
    declared_result = execute_protocol(declared)
    assert declared_result["status"] == "cancelled"
    assert payload(declared_result)["safeCode"] == "CANCELLED"
    assert "geometry" not in payload(declared_result)

    checks = 0

    def cancelled() -> bool:
        nonlocal checks
        checks += 1
        return checks > 8

    cooperative = execute_protocol(cloned_request(), cancelled=cancelled)
    assert cooperative["status"] == "cancelled"
    assert payload(cooperative)["safeCode"] == "CANCELLED"


def test_work_and_output_limits_return_bounded_abstention() -> None:
    work_limited = cloned_request()
    cast("dict[str, object]", work_limited["limits"])["maximumWorkUnits"] = 100
    result = execute_protocol(work_limited)
    assert result["status"] == "abstained"
    assert payload(result)["safeCode"] == "WORK_RESOURCE_LIMIT"

    output_limited = cloned_request()
    cast("dict[str, object]", output_limited["limits"])["maximumOutputBytes"] = 32_768
    bounded = execute_protocol(output_limited)
    assert len(canonical_json_bytes(bounded)) <= 32_768
    assert bounded["status"] == "abstained"
    assert payload(bounded)["safeCode"] == "OUTPUT_RESOURCE_LIMIT"


def test_deadline_is_checked_cooperatively_and_returns_safe_abstention() -> None:
    clock_values = iter((0.0, 31.0))

    result = execute_protocol(cloned_request(), clock=lambda: next(clock_values))

    assert result["status"] == "abstained"
    assert payload(result)["safeCode"] == "FITTING_TIMEOUT"


def test_fixed_point_metric_scale_and_translation_are_applied_to_every_source() -> None:
    request = cloned_request()
    for source in sources_from(request):
        source["coordinateFrame"] = "source-local-metric"
        transform = cast("dict[str, object]", source["transform"])
        transform["scalePartsPerMillion"] = 2_000_000
        transform["translationMm"] = {"xMm": 1_000, "yMm": -1_000, "zMm": 0}
    rehash(request)

    result = execute_protocol(request)

    assert result["status"] == "proposal"
    levels = cast("list[dict[str, object]]", geometry(result)["levels"])
    assert {item["elevationMm"] for item in levels} == {0, 6_000}
    assert {item["storeyHeightMm"] for item in levels} == {6_000}
    walls = cast("list[dict[str, object]]", geometry(result)["walls"])
    plan_points = [point for wall in walls for point in cast("list[dict[str, int]]", wall["path"])]
    assert min(point["xMm"] for point in plan_points) == 1_000
    assert max(point["xMm"] for point in plan_points) == 9_000
    assert min(point["yMm"] for point in plan_points) == -1_000
    assert max(point["yMm"] for point in plan_points) == 7_000


def test_rights_are_fail_closed_and_training_remains_denied_in_provenance() -> None:
    request = cloned_request()
    source = sources_from(request)[0]
    rights = cast("dict[str, object]", source["rights"])
    rights["trainingUseConsent"] = "granted"
    rehash(request)

    with pytest.raises(ScanToModelError, match="INVALID_SOURCE"):
        execute_protocol(request)

    encoded = canonical_json_bytes(execute_protocol(request_fixture())).decode("utf-8")
    assert '"trainingUseConsent":"denied"' in encoded
    assert '"trainingUseConsent":"granted"' not in encoded


def test_cli_is_canonical_bounded_and_has_no_argument_path_or_url_surface() -> None:
    request = request_fixture()
    exit_code, output, stderr_code = run(canonical_json_bytes(request))
    assert exit_code == 0
    assert stderr_code is None
    assert output == canonical_json_bytes(json.loads(output))

    invalid = cloned_request()
    invalid["inputPath"] = "/private/customer.json"
    exit_code, output, stderr_code = run(canonical_json_bytes(invalid))
    assert (exit_code, output, stderr_code) == (
        64,
        b"",
        "C9_SCAN_TO_MODEL_INPUT_INVALID",
    )
    exit_code, output, stderr_code = run(b" " * (MAXIMUM_STDIN_BYTES + 1))
    assert exit_code == 64
    assert output == b""
    assert stderr_code == "C9_SCAN_TO_MODEL_INPUT_INVALID"
