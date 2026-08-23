"""Generate a deterministic creator-owned calibrated-camera gsplat fixture."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np  # type: ignore[import-not-found]
import torch  # type: ignore[import-not-found]
from gsplat import rasterization  # type: ignore[import-not-found]
from PIL import Image  # type: ignore[import-not-found]


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("one output root is required")
    root = Path(sys.argv[1]).resolve()
    images_root = root / "images"
    if root.is_symlink() or (root.exists() and any(root.iterdir())):
        raise ValueError("fixture output must be empty")
    images_root.mkdir(parents=True)
    torch.manual_seed(20260819)
    means = torch.tensor(
        [
            [-0.28, -0.18, 2.0],
            [0.00, -0.22, 2.1],
            [0.28, -0.16, 1.95],
            [-0.22, 0.20, 2.08],
            [0.05, 0.22, 1.92],
            [0.30, 0.18, 2.05],
        ],
        dtype=torch.float32,
        device="cuda",
    )
    colors = torch.tensor(
        [
            [0.95, 0.15, 0.10],
            [0.10, 0.85, 0.20],
            [0.10, 0.20, 0.95],
            [0.90, 0.75, 0.10],
            [0.75, 0.10, 0.85],
            [0.10, 0.80, 0.85],
        ],
        dtype=torch.float32,
        device="cuda",
    )
    quaternions = torch.tensor(
        [[1.0, 0.0, 0.0, 0.0]] * len(means), dtype=torch.float32, device="cuda"
    )
    scales = torch.full((len(means), 3), 0.085, dtype=torch.float32, device="cuda")
    opacities = torch.full((len(means),), 0.88, dtype=torch.float32, device="cuda")
    intrinsic_values = [72.0, 0.0, 31.5, 0.0, 72.0, 31.5, 0.0, 0.0, 1.0]
    intrinsics = torch.tensor(intrinsic_values, dtype=torch.float32, device="cuda").reshape(1, 3, 3)
    frames: list[dict[str, object]] = []
    for index, camera_x in enumerate((-0.08, 0.0, 0.08)):
        world_to_camera = np.eye(4, dtype=np.float32)
        world_to_camera[0, 3] = camera_x
        view = torch.tensor(world_to_camera, device="cuda").reshape(1, 4, 4)
        rendered, _alpha, _metadata = rasterization(
            means,
            quaternions,
            scales,
            opacities,
            colors,
            view,
            intrinsics,
            width=64,
            height=64,
            render_mode="RGB",
        )
        pixels = rendered[0].detach().clamp(0, 1).mul(255).round().to(torch.uint8).cpu().numpy()
        image_name = f"frame-{index:02d}.png"
        image_path = images_root / image_name
        Image.fromarray(pixels, mode="RGB").save(image_path, format="PNG", compress_level=9)
        frames.append(
            {
                "frameId": f"synthetic-frame-{index:02d}",
                "height": 64,
                "imageName": image_name,
                "imageSha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
                "intrinsics": intrinsic_values,
                "width": 64,
                "worldToCamera": world_to_camera.reshape(-1).tolist(),
            }
        )
    initial_gaussians = []
    initial_colors = colors.detach().cpu().numpy() * 0.82 + 0.07
    for index, xyz in enumerate(means.detach().cpu().numpy()):
        initial_gaussians.append(
            {
                "opacity": 0.70,
                "rgb": initial_colors[index].tolist(),
                "scale": 0.11,
                "xyz": (xyz + np.array([0.012, -0.008, 0.015], dtype=np.float32)).tolist(),
            }
        )
    manifest = {
        "coordinateSystem": "right-handed-local",
        "frames": frames,
        "initialGaussians": initial_gaussians,
        "learningRate": 0.01,
        "rights": {
            "basis": "creator-owned-synthetic",
            "serviceProcessingAllowed": True,
            "trainingAllowed": False,
        },
        "schemaVersion": "c8-direct-gsplat-input-v2",
        "seed": 20260819,
        "steps": 24,
        "translationUnit": "arbitrary-units",
    }
    (root / "appearance-input.json").write_bytes(_canonical_bytes(manifest))
    print(
        json.dumps(
            {
                "frameHashes": {frame["imageName"]: frame["imageSha256"] for frame in frames},
                "manifestSha256": hashlib.sha256(_canonical_bytes(manifest)).hexdigest(),
                "schemaVersion": "c8-direct-gsplat-fixture-v2",
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
