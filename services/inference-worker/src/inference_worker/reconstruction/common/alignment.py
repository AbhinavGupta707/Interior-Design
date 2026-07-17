"""Robust, deterministic 3D similarity alignment without optional dependencies."""

import itertools
import math
from dataclasses import dataclass
from typing import Literal

from .errors import ReconstructionError

ScaleStatus = Literal["metric-validated", "metric-estimated", "unknown"]
MAXIMUM_COORDINATE_MAGNITUDE = 1_000_000_000_000_000.0
MAXIMUM_ANCHORS = 32


@dataclass(frozen=True, slots=True)
class Vec3:
    x: float
    y: float
    z: float

    def __post_init__(self) -> None:
        if not all(math.isfinite(value) for value in (self.x, self.y, self.z)):
            raise ReconstructionError("NON_FINITE_GEOMETRY", "3D coordinate is non-finite")
        if any(abs(value) > MAXIMUM_COORDINATE_MAGNITUDE for value in (self.x, self.y, self.z)):
            raise ReconstructionError("GEOMETRY_OVERFLOW", "3D coordinate exceeds its bound")

    def __add__(self, other: "Vec3") -> "Vec3":
        return Vec3(self.x + other.x, self.y + other.y, self.z + other.z)

    def __sub__(self, other: "Vec3") -> "Vec3":
        return Vec3(self.x - other.x, self.y - other.y, self.z - other.z)

    def __mul__(self, scalar: float) -> "Vec3":
        return Vec3(self.x * scalar, self.y * scalar, self.z * scalar)

    def dot(self, other: "Vec3") -> float:
        return self.x * other.x + self.y * other.y + self.z * other.z

    def cross(self, other: "Vec3") -> "Vec3":
        return Vec3(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )

    def norm(self) -> float:
        return math.sqrt(self.dot(self))


@dataclass(frozen=True, slots=True)
class AlignmentAnchor:
    anchor_id: str
    source: Vec3
    target: Vec3

    def __post_init__(self) -> None:
        if not self.anchor_id or len(self.anchor_id) > 120:
            raise ReconstructionError("INVALID_ALIGNMENT", "anchor identifier is invalid")


Matrix3 = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


@dataclass(frozen=True, slots=True)
class SimilarityTransform:
    scale: float
    rotation: Matrix3
    translation: Vec3

    def apply(self, point: Vec3) -> Vec3:
        rotated = Vec3(
            self.rotation[0][0] * point.x
            + self.rotation[0][1] * point.y
            + self.rotation[0][2] * point.z,
            self.rotation[1][0] * point.x
            + self.rotation[1][1] * point.y
            + self.rotation[1][2] * point.z,
            self.rotation[2][0] * point.x
            + self.rotation[2][1] * point.y
            + self.rotation[2][2] * point.z,
        )
        return rotated * self.scale + self.translation


@dataclass(frozen=True, slots=True)
class AlignmentReport:
    transform: SimilarityTransform
    threshold: float
    residuals: tuple[tuple[str, float], ...]
    inlier_anchor_ids: tuple[str, ...]
    outlier_anchor_ids: tuple[str, ...]
    residual_p50: float
    residual_p90: float
    residual_maximum: float
    scale_status: ScaleStatus = "metric-validated"
    authority: str = "proposal-only-no-survey-claim"

    def __post_init__(self) -> None:
        if len(self.inlier_anchor_ids) < 3:
            raise ReconstructionError(
                "ALIGNMENT_DEGENERATE", "alignment has fewer than three inliers"
            )


def _centroid(points: tuple[Vec3, ...]) -> Vec3:
    inverse = 1.0 / len(points)
    return Vec3(
        sum(point.x for point in points) * inverse,
        sum(point.y for point in points) * inverse,
        sum(point.z for point in points) * inverse,
    )


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ReconstructionError("INVALID_ALIGNMENT", "residual collection is empty")
    index = max(0, math.ceil(fraction * len(ordered)) - 1)
    return ordered[index]


def _validate_independence(points: tuple[Vec3, ...]) -> None:
    if len(set((point.x, point.y, point.z) for point in points)) != len(points):
        raise ReconstructionError("ALIGNMENT_DEGENERATE", "alignment points are not distinct")
    maximum_distance = 0.0
    maximum_area = 0.0
    for first, second in itertools.combinations(points, 2):
        maximum_distance = max(maximum_distance, (second - first).norm())
    for first, second, third in itertools.combinations(points, 3):
        maximum_area = max(maximum_area, (second - first).cross(third - first).norm())
    if maximum_distance <= 1e-12 or maximum_area <= maximum_distance * maximum_distance * 1e-10:
        raise ReconstructionError("ALIGNMENT_DEGENERATE", "alignment points are collinear")


def _jacobi_largest_eigenvector(matrix: list[list[float]]) -> tuple[float, float, float, float]:
    values = [row[:] for row in matrix]
    vectors = [[1.0 if row == column else 0.0 for column in range(4)] for row in range(4)]
    for _ in range(80):
        row, column = max(
            ((i, j) for i in range(4) for j in range(i + 1, 4)),
            key=lambda item: abs(values[item[0]][item[1]]),
        )
        if abs(values[row][column]) <= 1e-15:
            break
        tau = (values[column][column] - values[row][row]) / (2.0 * values[row][column])
        tangent = math.copysign(1.0 / (abs(tau) + math.sqrt(1.0 + tau * tau)), tau)
        cosine = 1.0 / math.sqrt(1.0 + tangent * tangent)
        sine = tangent * cosine
        original_row = values[row][row]
        original_column = values[column][column]
        off_diagonal = values[row][column]
        values[row][row] = (
            cosine * cosine * original_row
            - 2.0 * sine * cosine * off_diagonal
            + sine * sine * original_column
        )
        values[column][column] = (
            sine * sine * original_row
            + 2.0 * sine * cosine * off_diagonal
            + cosine * cosine * original_column
        )
        values[row][column] = values[column][row] = 0.0
        for index in range(4):
            if index in {row, column}:
                continue
            first = values[index][row]
            second = values[index][column]
            values[index][row] = values[row][index] = cosine * first - sine * second
            values[index][column] = values[column][index] = sine * first + cosine * second
        for index in range(4):
            first = vectors[index][row]
            second = vectors[index][column]
            vectors[index][row] = cosine * first - sine * second
            vectors[index][column] = sine * first + cosine * second
    largest = max(range(4), key=lambda index: values[index][index])
    result = tuple(vectors[row][largest] for row in range(4))
    norm = math.sqrt(sum(value * value for value in result))
    if norm <= 1e-15:
        raise ReconstructionError("ALIGNMENT_DEGENERATE", "rotation eigenvector is degenerate")
    normalized = tuple(value / norm for value in result)
    if normalized[0] < 0:
        normalized = tuple(-value for value in normalized)
    return normalized  # type: ignore[return-value]


def _quaternion_rotation(quaternion: tuple[float, float, float, float]) -> Matrix3:
    w, x, y, z = quaternion
    return (
        (1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)),
        (2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)),
        (2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)),
    )


def _rotate(rotation: Matrix3, point: Vec3) -> Vec3:
    return Vec3(
        rotation[0][0] * point.x + rotation[0][1] * point.y + rotation[0][2] * point.z,
        rotation[1][0] * point.x + rotation[1][1] * point.y + rotation[1][2] * point.z,
        rotation[2][0] * point.x + rotation[2][1] * point.y + rotation[2][2] * point.z,
    )


def _fit(anchors: tuple[AlignmentAnchor, ...]) -> SimilarityTransform:
    source = tuple(anchor.source for anchor in anchors)
    target = tuple(anchor.target for anchor in anchors)
    _validate_independence(source)
    _validate_independence(target)
    source_centroid = _centroid(source)
    target_centroid = _centroid(target)
    centered_source = tuple(point - source_centroid for point in source)
    centered_target = tuple(point - target_centroid for point in target)
    covariance = [[0.0] * 3 for _ in range(3)]
    for left, right in zip(centered_source, centered_target, strict=True):
        left_values = (left.x, left.y, left.z)
        right_values = (right.x, right.y, right.z)
        for row in range(3):
            for column in range(3):
                covariance[row][column] += left_values[row] * right_values[column]
    xx, xy, xz = covariance[0]
    yx, yy, yz = covariance[1]
    zx, zy, zz = covariance[2]
    trace = xx + yy + zz
    horn = [
        [trace, yz - zy, zx - xz, xy - yx],
        [yz - zy, xx - yy - zz, xy + yx, zx + xz],
        [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
        [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
    ]
    rotation = _quaternion_rotation(_jacobi_largest_eigenvector(horn))
    denominator = sum(point.dot(point) for point in centered_source)
    if denominator <= 1e-20:
        raise ReconstructionError("ALIGNMENT_DEGENERATE", "source variance is too small")
    numerator = sum(
        target_point.dot(_rotate(rotation, source_point))
        for source_point, target_point in zip(centered_source, centered_target, strict=True)
    )
    scale = numerator / denominator
    if not math.isfinite(scale) or not 1e-12 < scale < 1e12:
        raise ReconstructionError("ALIGNMENT_DEGENERATE", "similarity scale is invalid")
    translation = target_centroid - _rotate(rotation, source_centroid) * scale
    return SimilarityTransform(scale=scale, rotation=rotation, translation=translation)


def _residual(transform: SimilarityTransform, anchor: AlignmentAnchor) -> float:
    return (transform.apply(anchor.source) - anchor.target).norm()


def align_similarity(anchors: tuple[AlignmentAnchor, ...], *, threshold: float) -> AlignmentReport:
    """Fit a robust free 3D similarity with deterministic triplet consensus."""

    if not 3 <= len(anchors) <= MAXIMUM_ANCHORS:
        raise ReconstructionError("ALIGNMENT_ANCHOR_COUNT", "alignment requires 3 to 32 anchors")
    if len({anchor.anchor_id for anchor in anchors}) != len(anchors):
        raise ReconstructionError("INVALID_ALIGNMENT", "anchor identifiers are not unique")
    if not math.isfinite(threshold) or threshold <= 0 or threshold > 100_000_000:
        raise ReconstructionError("INVALID_ALIGNMENT", "alignment threshold is invalid")
    ordered = tuple(sorted(anchors, key=lambda anchor: anchor.anchor_id))
    best: tuple[int, float, tuple[str, ...], tuple[AlignmentAnchor, ...]] | None = None
    for triplet in itertools.combinations(ordered, 3):
        try:
            candidate = _fit(triplet)
        except ReconstructionError as error:
            if error.safe_code != "ALIGNMENT_DEGENERATE":
                raise
            continue
        residuals = [_residual(candidate, anchor) for anchor in ordered]
        inliers = tuple(
            anchor
            for anchor, residual in zip(ordered, residuals, strict=True)
            if residual <= threshold
        )
        if len(inliers) < 3:
            continue
        score = (
            -len(inliers),
            _percentile([_residual(candidate, item) for item in inliers], 0.9),
            tuple(item.anchor_id for item in triplet),
            inliers,
        )
        if best is None or score[:3] < best[:3]:
            best = score
    if best is None:
        raise ReconstructionError(
            "ALIGNMENT_DEGENERATE", "no independent triplet reached consensus"
        )
    transform = _fit(best[3])
    residual_pairs = tuple((anchor.anchor_id, _residual(transform, anchor)) for anchor in ordered)
    inlier_ids = tuple(anchor_id for anchor_id, residual in residual_pairs if residual <= threshold)
    if len(inlier_ids) < 3:
        raise ReconstructionError(
            "ALIGNMENT_RESIDUAL_EXCESSIVE", "refit lost three-anchor consensus"
        )
    outliers = tuple(anchor_id for anchor_id, residual in residual_pairs if residual > threshold)
    inlier_residuals = [
        residual for anchor_id, residual in residual_pairs if anchor_id in inlier_ids
    ]
    return AlignmentReport(
        transform=transform,
        threshold=threshold,
        residuals=residual_pairs,
        inlier_anchor_ids=inlier_ids,
        outlier_anchor_ids=outliers,
        residual_p50=_percentile(inlier_residuals, 0.5),
        residual_p90=_percentile(inlier_residuals, 0.9),
        residual_maximum=max(inlier_residuals),
    )
