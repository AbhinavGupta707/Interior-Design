"""Deterministic integer geometry primitives for semantic fitting."""

from __future__ import annotations

from math import isqrt

from .errors import FittingAbstention
from .schema import MAXIMUM_COORDINATE_MM, MAXIMUM_DIMENSION_MM
from .types import JsonObject, Point3, Transform

E9 = 1_000_000_000
E18 = E9 * E9
PPM = 1_000_000
MINIMUM_EDGE_MM = 10

Point2 = tuple[int, int]


def round_div(numerator: int, denominator: int) -> int:
    """Round an integer ratio to nearest, with exact halves away from zero."""

    if denominator <= 0:
        raise ValueError("denominator must be positive")
    sign = -1 if numerator < 0 else 1
    magnitude = abs(numerator)
    quotient, remainder = divmod(magnitude, denominator)
    if remainder * 2 >= denominator:
        quotient += 1
    return sign * quotient


def scaled_dimension(value: int, transform: Transform) -> int:
    result = round_div(value * transform.scale_parts_per_million, PPM)
    if not 1 <= result <= MAXIMUM_DIMENSION_MM:
        raise FittingAbstention("GEOMETRY_OVERFLOW", "scaled dimension is outside the model bound")
    return result


def _rotated_numerators(point: Point3, rotation: tuple[int, int, int, int]) -> Point3:
    w, x, y, z = rotation
    xx = w * w + x * x - y * y - z * z
    xy = 2 * (x * y - w * z)
    xz = 2 * (x * z + w * y)
    yx = 2 * (x * y + w * z)
    yy = w * w - x * x + y * y - z * z
    yz = 2 * (y * z - w * x)
    zx = 2 * (x * z - w * y)
    zy = 2 * (y * z + w * x)
    zz = w * w - x * x - y * y + z * z
    return Point3(
        xx * point.x + xy * point.y + xz * point.z,
        yx * point.x + yy * point.y + yz * point.z,
        zx * point.x + zy * point.y + zz * point.z,
    )


def transform_point(point: Point3, transform: Transform) -> Point3:
    rotated = _rotated_numerators(point, transform.rotation)
    denominator = E18 * PPM
    result = Point3(
        round_div(rotated.x * transform.scale_parts_per_million, denominator)
        + transform.translation.x,
        round_div(rotated.y * transform.scale_parts_per_million, denominator)
        + transform.translation.y,
        round_div(rotated.z * transform.scale_parts_per_million, denominator)
        + transform.translation.z,
    )
    if any(
        coordinate < -MAXIMUM_COORDINATE_MM or coordinate > MAXIMUM_COORDINATE_MM
        for coordinate in (result.x, result.y, result.z)
    ):
        raise FittingAbstention("GEOMETRY_OVERFLOW", "transformed point exceeds model bounds")
    return result


def rotate_e9(vector: Point3, transform: Transform) -> Point3:
    rotated = _rotated_numerators(vector, transform.rotation)
    return Point3(
        round_div(rotated.x, E18),
        round_div(rotated.y, E18),
        round_div(rotated.z, E18),
    )


def transform_preserves_up(transform: Transform) -> bool:
    up = rotate_e9(Point3(0, 0, E9), transform)
    return abs(up.x) <= 2_000_000 and abs(up.y) <= 2_000_000 and up.z >= 998_000_000


def canonical_cycle(points: tuple[Point3, ...]) -> tuple[Point3, ...]:
    variants: list[tuple[Point3, ...]] = []
    for sequence in (points, tuple(reversed(points))):
        for index in range(len(sequence)):
            variants.append(sequence[index:] + sequence[:index])
    return min(variants)


def canonical_polygon2(points: tuple[Point2, ...]) -> tuple[Point2, ...]:
    variants: list[tuple[Point2, ...]] = []
    for sequence in (points, tuple(reversed(points))):
        for index in range(len(sequence)):
            variants.append(sequence[index:] + sequence[:index])
    return min(variants)


def cross(a: Point2, b: Point2, c: Point2) -> int:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a: Point2, b: Point2, point: Point2) -> bool:
    return (
        cross(a, b, point) == 0
        and min(a[0], b[0]) <= point[0] <= max(a[0], b[0])
        and min(a[1], b[1]) <= point[1] <= max(a[1], b[1])
    )


def segments_intersect(a: Point2, b: Point2, c: Point2, d: Point2) -> bool:
    first = cross(a, b, c)
    second = cross(a, b, d)
    third = cross(c, d, a)
    fourth = cross(c, d, b)
    if ((first > 0 > second) or (second > 0 > first)) and (
        (third > 0 > fourth) or (fourth > 0 > third)
    ):
        return True
    return (
        (first == 0 and on_segment(a, b, c))
        or (second == 0 and on_segment(a, b, d))
        or (third == 0 and on_segment(c, d, a))
        or (fourth == 0 and on_segment(c, d, b))
    )


def proper_segments_intersect(a: Point2, b: Point2, c: Point2, d: Point2) -> bool:
    first = cross(a, b, c)
    second = cross(a, b, d)
    third = cross(c, d, a)
    fourth = cross(c, d, b)
    return ((first > 0 > second) or (second > 0 > first)) and (
        (third > 0 > fourth) or (fourth > 0 > third)
    )


def segment_length_mm(a: Point2, b: Point2) -> int:
    squared = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
    root = isqrt(squared)
    if (root + 1) ** 2 - squared <= squared - root**2:
        root += 1
    return root


def polygon_area2(points: tuple[Point2, ...]) -> int:
    return sum(
        point[0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * point[1]
        for index, point in enumerate(points)
    )


def validate_simple_polygon(points: tuple[Point2, ...], code: str) -> None:
    if len(set(points)) != len(points):
        raise FittingAbstention(code, "polygon has repeated vertices")
    if abs(polygon_area2(points)) < 2 * MINIMUM_EDGE_MM * MINIMUM_EDGE_MM:
        raise FittingAbstention(code, "polygon area is degenerate")
    count = len(points)
    for index in range(count):
        a = points[index]
        b = points[(index + 1) % count]
        if segment_length_mm(a, b) < MINIMUM_EDGE_MM:
            raise FittingAbstention(code, "polygon edge is degenerate")
        for other in range(index + 1, count):
            if other in {index, (index + 1) % count} or index in {
                other,
                (other + 1) % count,
            }:
                continue
            if index == 0 and other == count - 1:
                continue
            c = points[other]
            d = points[(other + 1) % count]
            if segments_intersect(a, b, c, d):
                raise FittingAbstention(code, "polygon self-intersects")


def point_in_polygon_strict(point: Point2, polygon: tuple[Point2, ...]) -> bool:
    """Integer winding test; boundary points are not strictly inside."""

    winding = 0
    for index, start in enumerate(polygon):
        end = polygon[(index + 1) % len(polygon)]
        if on_segment(start, end, point):
            return False
        if start[1] <= point[1] < end[1] and cross(start, end, point) > 0:
            winding += 1
        elif end[1] <= point[1] < start[1] and cross(start, end, point) < 0:
            winding -= 1
    return winding != 0


def polygons_overlap(first: tuple[Point2, ...], second: tuple[Point2, ...]) -> bool:
    for index, a in enumerate(first):
        b = first[(index + 1) % len(first)]
        for other, c in enumerate(second):
            d = second[(other + 1) % len(second)]
            if proper_segments_intersect(a, b, c, d):
                return True
    return any(point_in_polygon_strict(point, second) for point in first) or any(
        point_in_polygon_strict(point, first) for point in second
    )


def segment_contains(host: tuple[Point2, Point2], child: tuple[Point2, Point2]) -> bool:
    return cross(host[0], host[1], child[0]) == 0 and all(
        on_segment(host[0], host[1], point) for point in child
    )


def collinear_overlap_length(first: tuple[Point2, Point2], second: tuple[Point2, Point2]) -> int:
    if cross(first[0], first[1], second[0]) != 0 or cross(first[0], first[1], second[1]) != 0:
        return 0
    axis = 0 if abs(first[1][0] - first[0][0]) >= abs(first[1][1] - first[0][1]) else 1
    low = max(min(first[0][axis], first[1][axis]), min(second[0][axis], second[1][axis]))
    high = min(max(first[0][axis], first[1][axis]), max(second[0][axis], second[1][axis]))
    return max(0, high - low)


def validate_wall_network(segments: tuple[tuple[Point2, Point2], ...]) -> None:
    for index, first in enumerate(segments):
        for second in segments[index + 1 :]:
            overlap = collinear_overlap_length(first, second)
            if overlap > 0:
                raise FittingAbstention("OVERLAPPING_WALL_TOPOLOGY", "non-identical walls overlap")
            if segments_intersect(*first, *second):
                endpoint_hosts = (
                    on_segment(*first, second[0])
                    or on_segment(*first, second[1])
                    or on_segment(*second, first[0])
                    or on_segment(*second, first[1])
                )
                if not endpoint_hosts:
                    raise FittingAbstention(
                        "INTERSECTING_WALL_TOPOLOGY", "walls cross away from endpoints"
                    )


def rectangle_from_vertical_boundary(
    points: tuple[Point3, ...], code: str
) -> tuple[tuple[Point2, Point2], int, int]:
    if len(points) != 4:
        raise FittingAbstention(code, "vertical parametric rectangle requires four vertices")
    minimum_z = min(point.z for point in points)
    maximum_z = max(point.z for point in points)
    if maximum_z - minimum_z < MINIMUM_EDGE_MM:
        raise FittingAbstention(code, "vertical rectangle height is degenerate")
    bottom = {(point.x, point.y) for point in points if point.z == minimum_z}
    top = {(point.x, point.y) for point in points if point.z == maximum_z}
    if (
        len(bottom) != 2
        or bottom != top
        or any(point.z not in {minimum_z, maximum_z} for point in points)
    ):
        raise FittingAbstention(code, "boundary is not an upright rectangle")
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        same_plan_position = (point.x, point.y) == (following.x, following.y)
        same_height = point.z == following.z
        if same_plan_position == same_height:
            raise FittingAbstention(code, "rectangle boundary order is self-intersecting")
    path = tuple(sorted(bottom))
    if segment_length_mm(path[0], path[1]) < MINIMUM_EDGE_MM:
        raise FittingAbstention(code, "vertical rectangle width is degenerate")
    return (path[0], path[1]), minimum_z, maximum_z


def point3_json(point: Point3) -> JsonObject:
    return {"xMm": point.x, "yMm": point.y, "zMm": point.z}


def point2_json(point: Point2) -> JsonObject:
    return {"xMm": point[0], "yMm": point[1]}
