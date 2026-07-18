"""Deterministic hostile-output validation for C14 image enhancement."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from .contracts import (
    PROTECTED_EDGE_THRESHOLD_BASIS_POINTS,
    SEGMENTATION_THRESHOLD_BASIS_POINTS,
    EnhancementCandidate,
    EnhancementRequest,
    GeometryGuardReport,
    ProviderProvenance,
)
from .errors import EnhancementError, EnhancementSafeCode
from .png import DecodedPng, decode_png


@dataclass(frozen=True, slots=True)
class PreparedEnhancementInput:
    request: EnhancementRequest = field(repr=False)
    base: DecodedPng = field(repr=False)
    segmentation: DecodedPng = field(repr=False)
    allowed_edit_mask: DecodedPng = field(repr=False)


def _check_dimensions(image: DecodedPng, request: EnhancementRequest, *, name: str) -> None:
    if (image.width_px, image.height_px) != (request.base.width_px, request.base.height_px):
        raise EnhancementError(
            EnhancementSafeCode.CONDITIONING_MISMATCH, f"{name} dimensions differ"
        )


def prepare_request(request: EnhancementRequest) -> PreparedEnhancementInput:
    """Validate all parseable request media before any provider can observe it."""

    if type(request) is not EnhancementRequest:
        raise EnhancementError(EnhancementSafeCode.INPUT_INVALID, "request type mismatch")
    base = decode_png(request.base.content, allowed_colour_types=frozenset({2, 6}))
    segmentation = decode_png(request.segmentation.content, allowed_colour_types=frozenset({2, 6}))
    mask = decode_png(request.allowed_edit_mask.content, allowed_colour_types=frozenset({0}))
    for image, name in ((base, "base"), (segmentation, "segmentation"), (mask, "mask")):
        _check_dimensions(image, request, name=name)
    if (base.width_px, base.height_px) != (request.base.width_px, request.base.height_px):
        raise EnhancementError(EnhancementSafeCode.BASE_ARTIFACT_MISMATCH, "base dimensions")
    if any(segmentation.rgba8[index] != 255 for index in range(3, len(segmentation.rgba8), 4)):
        raise EnhancementError(EnhancementSafeCode.CONDITIONING_MISMATCH, "transparent segment")
    mask_values = mask.rgba8[0::4]
    if any(value not in {0, 255} for value in mask_values):
        raise EnhancementError(EnhancementSafeCode.ALLOWED_MASK_INVALID, "mask is not binary")
    return PreparedEnhancementInput(
        request=request,
        base=base,
        segmentation=segmentation,
        allowed_edit_mask=mask,
    )


def _segmentation_labels(image: DecodedPng) -> tuple[tuple[int, int, int], ...]:
    return tuple(
        (image.rgba8[index], image.rgba8[index + 1], image.rgba8[index + 2])
        for index in range(0, len(image.rgba8), 4)
    )


def _protected_edges(
    labels: tuple[tuple[int, int, int], ...], width: int, height: int
) -> frozenset[int]:
    edges: set[int] = set()
    background = (0, 0, 0)
    for y in range(height):
        for x in range(width):
            index = y * width + x
            label = labels[index]
            if label == background:
                continue
            neighbours = (
                labels[index - 1] if x > 0 else background,
                labels[index + 1] if x + 1 < width else background,
                labels[index - width] if y > 0 else background,
                labels[index + width] if y + 1 < height else background,
            )
            if any(neighbour != label for neighbour in neighbours):
                edges.add(index)
    return frozenset(edges)


def _basis_points(numerator: int, denominator: int) -> int:
    if denominator == 0:
        return 10_000
    return max(0, min(10_000, (numerator * 10_000) // denominator))


def _safe_code(
    *,
    camera_locked: bool,
    changed_outside: int,
    changed_protected_edges: int,
    edge_agreement: int,
    segmentation_iou: int,
) -> EnhancementSafeCode | None:
    if not camera_locked:
        return EnhancementSafeCode.CAMERA_MISMATCH
    if changed_outside:
        return EnhancementSafeCode.OUTSIDE_ALLOWED_MASK_CHANGED
    if changed_protected_edges:
        return EnhancementSafeCode.PROTECTED_GEOMETRY_CHANGED
    if edge_agreement < PROTECTED_EDGE_THRESHOLD_BASIS_POINTS:
        return EnhancementSafeCode.PROTECTED_GEOMETRY_CHANGED
    if segmentation_iou < SEGMENTATION_THRESHOLD_BASIS_POINTS:
        return EnhancementSafeCode.SEGMENTATION_THRESHOLD_FAILED
    return None


def evaluate_candidate(
    prepared: PreparedEnhancementInput,
    candidate: EnhancementCandidate,
    expected_provenance: ProviderProvenance,
    *,
    checkpoint: Callable[[], None] | None = None,
) -> GeometryGuardReport:
    """Evaluate exact binding, mask containment, edges, and segmentation support.

    ``segmentation_iou_basis_points`` is a conservative, deterministic
    protected-footprint score: changed protected-boundary pixels are removed
    from the trusted conditioning footprint before IoU is calculated. It is
    not semantic re-segmentation and never becomes a millimetre depth metric.
    """

    if type(candidate) is not EnhancementCandidate:
        raise EnhancementError(EnhancementSafeCode.PROVIDER_OUTPUT_INVALID, "candidate type")
    request = prepared.request
    if candidate.provenance != expected_provenance:
        raise EnhancementError(
            EnhancementSafeCode.PROVIDER_PROVENANCE_MISMATCH, "provider manifest differs"
        )
    if candidate.base_artifact_sha256 != request.base.sha256:
        raise EnhancementError(EnhancementSafeCode.BASE_ARTIFACT_MISMATCH, "base pin differs")
    if candidate.conditioning != request.conditioning_hashes:
        raise EnhancementError(
            EnhancementSafeCode.CONDITIONING_MISMATCH, "conditioning pins differ"
        )
    if candidate.allowed_mask_sha256 != request.allowed_edit_mask.sha256:
        raise EnhancementError(EnhancementSafeCode.ALLOWED_MASK_INVALID, "mask pin differs")
    if (candidate.output.width_px, candidate.output.height_px) != (
        request.base.width_px,
        request.base.height_px,
    ):
        raise EnhancementError(EnhancementSafeCode.OUTPUT_INVALID, "output dimensions differ")

    enhanced = decode_png(candidate.output.content, allowed_colour_types=frozenset({2, 6}))
    _check_dimensions(enhanced, request, name="enhanced")
    labels = _segmentation_labels(prepared.segmentation)
    protected_edges = _protected_edges(labels, enhanced.width_px, enhanced.height_px)
    protected_pixels = sum(label != (0, 0, 0) for label in labels)
    mask = prepared.allowed_edit_mask.rgba8[0::4]
    changed = 0
    changed_outside = 0
    changed_protected_edges = 0
    pixel_count = enhanced.width_px * enhanced.height_px
    for index in range(pixel_count):
        if checkpoint is not None and index % 4_096 == 0:
            checkpoint()
        start = index * 4
        differs = prepared.base.rgba8[start : start + 4] != enhanced.rgba8[start : start + 4]
        if not differs:
            continue
        changed += 1
        if mask[index] != 255:
            changed_outside += 1
        if index in protected_edges:
            changed_protected_edges += 1
    if checkpoint is not None:
        checkpoint()

    unchanged_edges = len(protected_edges) - changed_protected_edges
    edge_agreement = _basis_points(unchanged_edges, len(protected_edges))
    # The candidate footprint conservatively loses every changed protected
    # boundary pixel. Its union with the trusted footprint is unchanged.
    segmentation_iou = _basis_points(protected_pixels - changed_protected_edges, protected_pixels)
    camera_locked = candidate.camera_sha256 == request.camera_sha256
    safe_code = _safe_code(
        camera_locked=camera_locked,
        changed_outside=changed_outside,
        changed_protected_edges=changed_protected_edges,
        edge_agreement=edge_agreement,
        segmentation_iou=segmentation_iou,
    )
    return GeometryGuardReport(
        accepted=safe_code is None,
        allowed_mask_sha256=request.allowed_edit_mask.sha256,
        base_artifact_sha256=request.base.sha256,
        camera_locked=camera_locked,
        changed_outside_allowed_mask_pixels=changed_outside,
        changed_pixel_count=changed,
        enhanced_artifact_sha256=candidate.output.sha256,
        protected_edge_agreement_basis_points=edge_agreement,
        protected_geometry_moved=changed_protected_edges > 0,
        segmentation_iou_basis_points=segmentation_iou,
        safe_code=safe_code,
    )


def rejected_candidate_report(
    prepared: PreparedEnhancementInput,
    candidate: EnhancementCandidate,
    safe_code: EnhancementSafeCode,
) -> GeometryGuardReport:
    """Create a fail-closed guard when an attempted candidate cannot be evaluated."""

    return GeometryGuardReport(
        accepted=False,
        allowed_mask_sha256=prepared.request.allowed_edit_mask.sha256,
        base_artifact_sha256=prepared.request.base.sha256,
        camera_locked=False,
        changed_outside_allowed_mask_pixels=0,
        changed_pixel_count=0,
        enhanced_artifact_sha256=candidate.output.sha256,
        protected_edge_agreement_basis_points=0,
        protected_geometry_moved=True,
        segmentation_iou_basis_points=0,
        safe_code=safe_code,
    )
