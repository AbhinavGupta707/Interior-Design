from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "ml/reconstruction/windows-nvidia-v2"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, PACKAGE / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_input(tmp_path: Path) -> Path:
    root = tmp_path / "input"
    images = root / "images"
    images.mkdir(parents=True)
    image = images / "frame.png"
    Image.new("RGB", (4, 3), (10, 20, 30)).save(image)
    manifest = {
        "authority": "proposal-only-learned-input-copy",
        "cohort": "normal",
        "frames": [
            {
                "cameraIntrinsics": [4.0, 4.0, 2.0, 1.5],
                "heightPixels": 3,
                "imageName": image.name,
                "imageSha256": sha256(image),
                "sampleId": "fixture",
                "widthPixels": 4,
                "worldToCamera": np.eye(4).reshape(-1).tolist(),
            }
        ],
        "heldOutPolicy": "last-frame-when-four-or-more",
        "schemaVersion": "c14-10-da3-input-v1",
        "segmentId": "fixture-segment",
        "selectionSha256": "a" * 64,
        "sourceCoordinateSystem": "arkit-segment-converted-to-opencv-world-to-camera",
        "sourceUnit": "metres-from-arkit-not-independently-validated",
    }
    (root / "da3-input.json").write_bytes(
        json.dumps(manifest, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
        + b"\n"
    )
    return root


def test_input_is_hash_bound_and_symlink_rejected(tmp_path: Path) -> None:
    module = load("da3_capture")
    root = make_input(tmp_path)
    manifest, paths = module.load_input(root)
    assert manifest["authority"] == "proposal-only-learned-input-copy"
    assert len(paths) == 1
    paths[0].write_bytes(paths[0].read_bytes() + b"tamper")
    with pytest.raises(ValueError, match="hash mismatch"):
        module.load_input(root)

    root = make_input(tmp_path / "second")
    original = root / "images/frame.png"
    external = tmp_path / "external.png"
    original.rename(external)
    os.symlink(external, original)
    with pytest.raises(ValueError, match="confined regular file"):
        module.load_input(root)


def test_similarity_alignment_recovers_known_transform() -> None:
    module = load("da3_capture")
    source = np.asarray([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 2.0, 0.0]])
    rotation = np.asarray([[0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    translation = np.asarray([4.0, -2.0, 1.0])
    target = 2.5 * (source @ rotation.T) + translation
    recovered_rotation, recovered_translation, scale, residual = module.umeyama(source, target)
    assert recovered_rotation == pytest.approx(rotation)
    assert recovered_translation == pytest.approx(translation)
    assert scale == pytest.approx(2.5)
    assert residual < 1e-12


def test_binary_ply_is_private_and_not_replaced(tmp_path: Path) -> None:
    module = load("da3_capture")
    path = tmp_path / "points.ply"
    module.write_binary_ply(
        path,
        np.asarray([[1.0, 2.0, 3.0]], dtype=np.float32),
        np.asarray([[4, 5, 6]], dtype=np.uint8),
    )
    assert path.read_bytes().startswith(b"ply\nformat binary_little_endian 1.0\n")
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError, match="replace"):
        module.write_binary_ply(
            path,
            np.asarray([[1.0, 2.0, 3.0]], dtype=np.float32),
            np.asarray([[4, 5, 6]], dtype=np.uint8),
        )
