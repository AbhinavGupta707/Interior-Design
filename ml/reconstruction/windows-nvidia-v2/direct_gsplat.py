"""Bounded direct-gsplat trainer for calibrated, rights-cleared RGB frames."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import re
import resource
import time
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import numpy as np  # type: ignore[import-not-found]
import torch  # type: ignore[import-not-found]
from gsplat import rasterization  # type: ignore[import-not-found]
from PIL import Image  # type: ignore[import-not-found]

INPUT_ROOT = Path("/c8/input")
OUTPUT_ROOT = Path("/c8/output")
MANIFEST_PATH = INPUT_ROOT / "appearance-input.json"
IMAGE_ROOT = INPUT_ROOT / "images"
MAXIMUM_MANIFEST_BYTES = 4 * 1024 * 1024
MAXIMUM_IMAGE_BYTES = 64 * 1024 * 1024
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SAFE_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}\.(?:png|jpe?g)$")


@dataclass(frozen=True, slots=True)
class Frame:
    frame_id: str
    image_name: str
    image_sha256: str
    width: int
    height: int
    intrinsics: tuple[float, ...]
    world_to_camera: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class Gaussian:
    xyz: tuple[float, float, float]
    rgb: tuple[float, float, float]
    scale: float
    opacity: float


@dataclass(frozen=True, slots=True)
class TrainingInput:
    seed: int
    steps: int
    learning_rate: float
    frames: tuple[Frame, ...]
    gaussians: tuple[Gaussian, ...]
    raw_sha256: str


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()


def _object(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object")
    return cast("dict[str, object]", value)


def _array(value: object, name: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array")
    return cast("list[object]", value)


def _number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _numbers(value: object, count: int, name: str) -> tuple[float, ...]:
    values = tuple(_number(item, name) for item in _array(value, name))
    if len(values) != count:
        raise ValueError(f"{name} has the wrong length")
    return values


def _exact_keys(value: dict[str, object], keys: set[str], name: str) -> None:
    if set(value) != keys:
        raise ValueError(f"{name} fields are invalid")


def _parse_frame(value: object) -> Frame:
    raw = _object(value, "frame")
    _exact_keys(
        raw,
        {
            "frameId",
            "height",
            "imageName",
            "imageSha256",
            "intrinsics",
            "width",
            "worldToCamera",
        },
        "frame",
    )
    frame_id = raw["frameId"]
    image_name = raw["imageName"]
    image_sha256 = raw["imageSha256"]
    if not isinstance(frame_id, str) or not frame_id or len(frame_id) > 120:
        raise ValueError("frame identifier is invalid")
    if not isinstance(image_name, str) or SAFE_NAME_PATTERN.fullmatch(image_name) is None:
        raise ValueError("image name is invalid")
    if not isinstance(image_sha256, str) or SHA256_PATTERN.fullmatch(image_sha256) is None:
        raise ValueError("image hash is invalid")
    width = raw["width"]
    height = raw["height"]
    if (
        isinstance(width, bool)
        or isinstance(height, bool)
        or not isinstance(width, int)
        or not isinstance(height, int)
        or not 32 <= width <= 2048
        or not 32 <= height <= 2048
    ):
        raise ValueError("frame dimensions are invalid")
    intrinsics = _numbers(raw["intrinsics"], 9, "intrinsics")
    world_to_camera = _numbers(raw["worldToCamera"], 16, "worldToCamera")
    if intrinsics[0] <= 0 or intrinsics[4] <= 0 or world_to_camera[15] != 1:
        raise ValueError("camera calibration is invalid")
    return Frame(
        frame_id,
        image_name,
        image_sha256,
        width,
        height,
        intrinsics,
        world_to_camera,
    )


def _parse_gaussian(value: object) -> Gaussian:
    raw = _object(value, "gaussian")
    _exact_keys(raw, {"opacity", "rgb", "scale", "xyz"}, "gaussian")
    xyz = _numbers(raw["xyz"], 3, "xyz")
    rgb = _numbers(raw["rgb"], 3, "rgb")
    scale = _number(raw["scale"], "scale")
    opacity = _number(raw["opacity"], "opacity")
    if (
        any(value < 0 or value > 1 for value in rgb)
        or not 0.001 <= scale <= 1
        or not 0.01 <= opacity <= 0.99
    ):
        raise ValueError("initial Gaussian is invalid")
    return Gaussian(
        cast("tuple[float, float, float]", xyz),
        cast("tuple[float, float, float]", rgb),
        scale,
        opacity,
    )


def load_input() -> TrainingInput:
    if (
        MANIFEST_PATH.is_symlink()
        or not MANIFEST_PATH.is_file()
        or MANIFEST_PATH.stat().st_size > MAXIMUM_MANIFEST_BYTES
    ):
        raise ValueError("input manifest is invalid")
    raw_bytes = MANIFEST_PATH.read_bytes()
    raw = _object(json.loads(raw_bytes), "manifest")
    _exact_keys(
        raw,
        {
            "coordinateSystem",
            "frames",
            "initialGaussians",
            "learningRate",
            "rights",
            "schemaVersion",
            "seed",
            "steps",
            "translationUnit",
        },
        "manifest",
    )
    rights = _object(raw["rights"], "rights")
    _exact_keys(rights, {"basis", "serviceProcessingAllowed", "trainingAllowed"}, "rights")
    if (
        raw["schemaVersion"] != "c8-direct-gsplat-input-v2"
        or raw["coordinateSystem"] != "right-handed-local"
        or raw["translationUnit"] != "arbitrary-units"
        or rights["basis"] not in {"creator-owned-synthetic", "user-authorised"}
        or rights["serviceProcessingAllowed"] is not True
        or rights["trainingAllowed"] is not False
    ):
        raise ValueError("manifest authority or rights are invalid")
    seed = raw["seed"]
    steps = raw["steps"]
    if (
        isinstance(seed, bool)
        or isinstance(steps, bool)
        or not isinstance(seed, int)
        or not isinstance(steps, int)
        or not 0 <= seed <= 2**31 - 1
        or not 3 <= steps <= 10_000
    ):
        raise ValueError("training bounds are invalid")
    learning_rate = _number(raw["learningRate"], "learningRate")
    if not 1e-6 <= learning_rate <= 0.1:
        raise ValueError("learning rate is invalid")
    frames = tuple(_parse_frame(item) for item in _array(raw["frames"], "frames"))
    gaussians = tuple(
        _parse_gaussian(item) for item in _array(raw["initialGaussians"], "initialGaussians")
    )
    if not 2 <= len(frames) <= 500 or not 3 <= len(gaussians) <= 100_000:
        raise ValueError("input collection bounds are invalid")
    if len({frame.frame_id for frame in frames}) != len(frames):
        raise ValueError("frame identifiers must be unique")
    dimensions = {(frame.width, frame.height) for frame in frames}
    if len(dimensions) != 1:
        raise ValueError("all frames must have identical bounded dimensions")
    return TrainingInput(
        seed,
        steps,
        learning_rate,
        frames,
        gaussians,
        hashlib.sha256(raw_bytes).hexdigest(),
    )


def _load_image(frame: Frame) -> torch.Tensor:
    path = IMAGE_ROOT / frame.image_name
    if (
        path.is_symlink()
        or not path.is_file()
        or path.stat().st_size > MAXIMUM_IMAGE_BYTES
        or _sha256(path) != frame.image_sha256
    ):
        raise ValueError("source image validation failed")
    with Image.open(path) as source:
        source.verify()
    with Image.open(path) as source:
        rgb = source.convert("RGB")
        if rgb.size != (frame.width, frame.height):
            raise ValueError("source image dimensions disagree")
        array = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(array.copy()).to(device="cuda")


def _camera(frame: Frame) -> tuple[torch.Tensor, torch.Tensor]:
    view = torch.tensor(frame.world_to_camera, dtype=torch.float32, device="cuda").reshape(1, 4, 4)
    intrinsics = torch.tensor(frame.intrinsics, dtype=torch.float32, device="cuda").reshape(1, 3, 3)
    return view, intrinsics


def _safe_write(path: Path, payload: bytes) -> None:
    temporary = path.with_name(f".{path.name}.pending")
    with temporary.open("xb") as target:
        target.write(payload)
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)


def _ply_bytes(
    means: np.ndarray,
    colors: np.ndarray,
    scales: np.ndarray,
    opacities: np.ndarray,
    quaternions: np.ndarray,
) -> bytes:
    lines = [
        "ply",
        "format ascii 1.0",
        "comment c8-v2 non-dimensional-appearance proposal-only",
        f"element vertex {len(means)}",
        "property float x",
        "property float y",
        "property float z",
        "property uchar red",
        "property uchar green",
        "property uchar blue",
        "property float opacity",
        "property float scale_x",
        "property float scale_y",
        "property float scale_z",
        "property float quat_w",
        "property float quat_x",
        "property float quat_y",
        "property float quat_z",
        "end_header",
    ]
    rgb = np.rint(np.clip(colors, 0, 1) * 255).astype(np.uint8)
    for index in range(len(means)):
        values = [
            *(f"{value:.9g}" for value in means[index]),
            *(str(int(value)) for value in rgb[index]),
            f"{opacities[index]:.9g}",
            *(f"{value:.9g}" for value in scales[index]),
            *(f"{value:.9g}" for value in quaternions[index]),
        ]
        lines.append(" ".join(values))
    return ("\n".join(lines) + "\n").encode()


def main() -> None:
    started = time.perf_counter()
    training = load_input()
    if OUTPUT_ROOT.is_symlink() or not OUTPUT_ROOT.is_dir() or any(OUTPUT_ROOT.iterdir()):
        raise ValueError("output directory must be empty")
    if torch.cuda.get_device_capability(0) != (12, 0) or "sm_120" not in torch.cuda.get_arch_list():
        raise RuntimeError("SM120_RUNTIME_UNAVAILABLE")
    torch.manual_seed(training.seed)
    torch.cuda.manual_seed_all(training.seed)
    torch.cuda.reset_peak_memory_stats(0)

    images = tuple(_load_image(frame) for frame in training.frames)
    cameras = tuple(_camera(frame) for frame in training.frames)
    initial_means = [gaussian.xyz for gaussian in training.gaussians]
    initial_colors = [gaussian.rgb for gaussian in training.gaussians]
    initial_scales = [[gaussian.scale] * 3 for gaussian in training.gaussians]
    initial_opacities = [gaussian.opacity for gaussian in training.gaussians]
    count = len(training.gaussians)
    means = torch.nn.Parameter(torch.tensor(initial_means, dtype=torch.float32, device="cuda"))
    quaternions = torch.nn.Parameter(
        torch.tensor([[1.0, 0.0, 0.0, 0.0]] * count, dtype=torch.float32, device="cuda")
    )
    log_scales = torch.nn.Parameter(
        torch.tensor(initial_scales, dtype=torch.float32, device="cuda").log()
    )
    opacity_logits = torch.nn.Parameter(
        torch.logit(torch.tensor(initial_opacities, dtype=torch.float32, device="cuda"))
    )
    color_logits = torch.nn.Parameter(
        torch.logit(
            torch.tensor(initial_colors, dtype=torch.float32, device="cuda").clamp(0.001, 0.999)
        )
    )
    parameters = [means, quaternions, log_scales, opacity_logits, color_logits]
    optimizer = torch.optim.Adam(parameters, lr=training.learning_rate)
    losses: list[float] = []
    training_count = len(training.frames) - 1
    for step in range(training.steps):
        frame_index = step % training_count
        frame = training.frames[frame_index]
        view, intrinsics = cameras[frame_index]
        optimizer.zero_grad(set_to_none=True)
        rendered, _alpha, _metadata = rasterization(
            means,
            torch.nn.functional.normalize(quaternions, dim=-1),
            log_scales.exp(),
            opacity_logits.sigmoid(),
            color_logits.sigmoid(),
            view,
            intrinsics,
            width=frame.width,
            height=frame.height,
            render_mode="RGB",
        )
        loss = torch.nn.functional.mse_loss(rendered[0], images[frame_index])
        if not torch.isfinite(loss):
            raise RuntimeError("GSPLAT_NONFINITE_LOSS")
        loss.backward()
        if means.grad is None or not torch.isfinite(means.grad).all():
            raise RuntimeError("GSPLAT_NONFINITE_GRADIENT")
        optimizer.step()
        losses.append(float(loss.detach().item()))

    held_out = training.frames[-1]
    view, intrinsics = cameras[-1]
    with torch.no_grad():
        rendered, _alpha, _metadata = rasterization(
            means,
            torch.nn.functional.normalize(quaternions, dim=-1),
            log_scales.exp(),
            opacity_logits.sigmoid(),
            color_logits.sigmoid(),
            view,
            intrinsics,
            width=held_out.width,
            height=held_out.height,
            render_mode="RGB",
        )
        held_out_mse = float(torch.nn.functional.mse_loss(rendered[0], images[-1]).detach().item())
    torch.cuda.synchronize()
    held_out_psnr = -10.0 * math.log10(max(held_out_mse, 1e-12))
    final_means = means.detach().cpu().numpy()
    final_colors = color_logits.sigmoid().detach().cpu().numpy()
    final_scales = log_scales.exp().detach().cpu().numpy()
    final_opacities = opacity_logits.sigmoid().detach().cpu().numpy()
    final_quaternions = torch.nn.functional.normalize(quaternions, dim=-1).detach().cpu().numpy()
    ply_path = OUTPUT_ROOT / "appearance.ply"
    checkpoint_path = OUTPUT_ROOT / "appearance-checkpoint.json"
    _safe_write(
        ply_path,
        _ply_bytes(
            final_means,
            final_colors,
            final_scales,
            final_opacities,
            final_quaternions,
        ),
    )
    checkpoint = {
        "authority": "non-dimensional-appearance",
        "colors": final_colors.tolist(),
        "means": final_means.tolist(),
        "opacities": final_opacities.tolist(),
        "quaternions": final_quaternions.tolist(),
        "scales": final_scales.tolist(),
        "schemaVersion": "c8-direct-gsplat-checkpoint-v2",
        "sourceManifestSha256": training.raw_sha256,
    }
    _safe_write(checkpoint_path, _canonical_bytes(checkpoint))
    usage = resource.getrusage(resource.RUSAGE_SELF)
    result = {
        "algorithmVerdict": "passed",
        "authority": "non-dimensional-appearance",
        "deviceCapability": list(torch.cuda.get_device_capability(0)),
        "deviceName": torch.cuda.get_device_name(0),
        "durationMilliseconds": round((time.perf_counter() - started) * 1000),
        "gsplat": importlib.metadata.version("gsplat"),
        "heldOutFrameId": held_out.frame_id,
        "heldOutMse": held_out_mse,
        "heldOutPsnrDb": held_out_psnr,
        "losses": losses,
        "optimizerSteps": training.steps,
        "outputs": {
            "appearance-checkpoint.json": _sha256(checkpoint_path),
            "appearance.ply": _sha256(ply_path),
        },
        "peakGpuMemoryBytes": torch.cuda.max_memory_allocated(0),
        "peakHostMemoryBytes": int(usage.ru_maxrss) * 1024,
        "schemaVersion": "c8-direct-gsplat-result-v2",
        "sourceManifestSha256": training.raw_sha256,
        "torch": torch.__version__,
        "torchArchitectures": torch.cuda.get_arch_list(),
    }
    _safe_write(OUTPUT_ROOT / "appearance-result.json", _canonical_bytes(result))
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
