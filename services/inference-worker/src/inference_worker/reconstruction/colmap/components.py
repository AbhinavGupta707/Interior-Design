"""Disconnected-component analysis and safe COLMAP merge eligibility."""

import hashlib
from dataclasses import dataclass
from pathlib import PurePosixPath

from ..common.errors import ReconstructionError
from .models import SparseModel


def image_components(model: SparseModel) -> tuple[tuple[int, ...], ...]:
    """Return observation-connected registered-image IDs without contiguous-ID assumptions."""

    adjacency: dict[int, set[int]] = {image_id: set() for image_id in model.images}
    for point in model.points3d.values():
        image_ids = sorted({element.image_id for element in point.track})
        for image_id in image_ids:
            adjacency[image_id].update(other for other in image_ids if other != image_id)
    remaining = set(adjacency)
    components: list[tuple[int, ...]] = []
    while remaining:
        start = min(remaining)
        stack = [start]
        found: set[int] = set()
        while stack:
            current = stack.pop()
            if current in found:
                continue
            found.add(current)
            stack.extend(sorted(adjacency[current] - found, reverse=True))
        remaining -= found
        components.append(tuple(sorted(found)))
    return tuple(sorted(components, key=lambda component: (-len(component), component)))


def registered_image_key(name: str) -> str:
    return hashlib.sha256(name.encode("utf-8")).hexdigest()


def _safe_relative_model(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or "\x00" in value
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ReconstructionError("UNSAFE_PATH", "merge model path is not workspace-relative")
    return value


@dataclass(frozen=True, slots=True)
class MergePlan:
    left_relative_model: str
    right_relative_model: str
    output_relative_model: str
    shared_image_keys: tuple[str, ...]


def plan_model_merge(
    left: SparseModel,
    right: SparseModel,
    *,
    left_relative_model: str,
    right_relative_model: str,
    output_relative_model: str,
) -> MergePlan:
    """Refuse COLMAP model merge unless registered image names overlap."""

    shared_names = sorted(
        {image.name for image in left.images.values()}
        & {image.name for image in right.images.values()}
    )
    if not shared_names:
        raise ReconstructionError("MODEL_MERGE_NO_OVERLAP", "models share no registered images")
    return MergePlan(
        left_relative_model=_safe_relative_model(left_relative_model),
        right_relative_model=_safe_relative_model(right_relative_model),
        output_relative_model=_safe_relative_model(output_relative_model),
        shared_image_keys=tuple(registered_image_key(name) for name in shared_names),
    )
