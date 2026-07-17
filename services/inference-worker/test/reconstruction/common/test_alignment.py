"""Deterministic and adversarial similarity-alignment fixtures."""

import math

import pytest
from inference_worker.reconstruction.common.alignment import (
    AlignmentAnchor,
    Vec3,
    align_similarity,
)
from inference_worker.reconstruction.common.errors import ReconstructionError


def _target(point: Vec3) -> Vec3:
    # Scale 2, rotate +90 degrees around Z, then translate.
    return Vec3(-2.0 * point.y + 10.0, 2.0 * point.x - 5.0, 2.0 * point.z + 3.0)


def _anchors() -> tuple[AlignmentAnchor, ...]:
    points = (
        Vec3(0.0, 0.0, 0.0),
        Vec3(1.0, 0.0, 0.0),
        Vec3(0.0, 1.0, 0.0),
        Vec3(0.25, 0.5, 1.0),
    )
    return tuple(
        AlignmentAnchor(f"anchor-{index}", point, _target(point))
        for index, point in enumerate(points)
    )


def test_three_dimensional_similarity_is_exact_and_deterministic() -> None:
    first = align_similarity(_anchors(), threshold=1e-6)
    second = align_similarity(tuple(reversed(_anchors())), threshold=1e-6)

    assert first == second
    assert first.scale_status == "metric-validated"
    assert first.authority == "proposal-only-no-survey-claim"
    assert first.transform.scale == pytest.approx(2.0, abs=1e-10)
    assert first.transform.translation == Vec3(10.0, -5.0, 3.0)
    assert first.residual_p90 < 1e-9
    assert first.outlier_anchor_ids == ()
    assert first.transform.apply(Vec3(0.5, 0.25, 2.0)) == pytest.approx(
        _target(Vec3(0.5, 0.25, 2.0)), abs=1e-9
    )


def test_triplet_consensus_reports_a_large_outlier() -> None:
    anchors = _anchors() + (
        AlignmentAnchor("outlier", Vec3(2.0, 2.0, 2.0), Vec3(50.0, 50.0, 50.0)),
    )

    result = align_similarity(anchors, threshold=0.01)

    assert result.inlier_anchor_ids == ("anchor-0", "anchor-1", "anchor-2", "anchor-3")
    assert result.outlier_anchor_ids == ("outlier",)
    assert result.threshold == 0.01
    assert dict(result.residuals)["outlier"] > 10


@pytest.mark.parametrize(
    "anchors,code",
    [
        (
            (
                AlignmentAnchor("a", Vec3(0, 0, 0), Vec3(0, 0, 0)),
                AlignmentAnchor("b", Vec3(1, 0, 0), Vec3(1, 0, 0)),
            ),
            "ALIGNMENT_ANCHOR_COUNT",
        ),
        (
            (
                AlignmentAnchor("a", Vec3(0, 0, 0), Vec3(0, 0, 0)),
                AlignmentAnchor("b", Vec3(1, 0, 0), Vec3(2, 0, 0)),
                AlignmentAnchor("c", Vec3(2, 0, 0), Vec3(4, 0, 0)),
            ),
            "ALIGNMENT_DEGENERATE",
        ),
    ],
)
def test_fewer_than_three_or_collinear_anchors_are_rejected(
    anchors: tuple[AlignmentAnchor, ...], code: str
) -> None:
    with pytest.raises(ReconstructionError) as raised:
        align_similarity(anchors, threshold=1.0)
    assert raised.value.safe_code == code


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, 1.1e15])
def test_nan_infinity_and_coordinate_overflow_fail_closed(value: float) -> None:
    with pytest.raises(ReconstructionError) as raised:
        Vec3(value, 0.0, 0.0)
    assert raised.value.safe_code in {"NON_FINITE_GEOMETRY", "GEOMETRY_OVERFLOW"}


def test_invalid_threshold_and_duplicate_anchor_id_fail_closed() -> None:
    duplicate = (
        AlignmentAnchor("same", Vec3(0, 0, 0), Vec3(0, 0, 0)),
        AlignmentAnchor("same", Vec3(1, 0, 0), Vec3(1, 0, 0)),
        AlignmentAnchor("third", Vec3(0, 1, 0), Vec3(0, 1, 0)),
    )
    with pytest.raises(ReconstructionError, match="INVALID_ALIGNMENT"):
        align_similarity(duplicate, threshold=1.0)
    with pytest.raises(ReconstructionError, match="INVALID_ALIGNMENT"):
        align_similarity(_anchors(), threshold=math.nan)
