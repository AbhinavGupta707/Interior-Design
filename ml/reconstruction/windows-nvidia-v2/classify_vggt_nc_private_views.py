#!/usr/bin/env python3
"""Classify private point-cloud renders locally with a frozen offline SigLIP 2 snapshot."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
from typing import Any, cast

MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
MODEL_FILES = {
    "config.json": "fe8b5fe6d5734360678fd71c11c21e1ea3364bd8598d34295d9206335973ffd7",
    "model.safetensors": "612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b",
    "preprocessor_config.json": (
        "9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc"
    ),
    "tokenizer.json": "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322",
    "tokenizer.model": "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2",
    "tokenizer_config.json": ("14afe629fe4959b9e0d51e1852b8d9f7ad074f90a1a7125a4fcdd17f06e78fc8"),
}
VIEWS = ("principal-a", "principal-b", "elevated")
QUALITY_PROMPTS = (
    "a coherent recognizable indoor room point cloud with furniture and walls",
    "a partly coherent but incomplete indoor room point cloud",
    "an unusable noisy point cloud with no recognizable room geometry",
)
CONTENT_PROMPTS = (
    "a kitchen interior point cloud",
    "a bedroom interior point cloud",
    "a home office or study interior point cloud",
    "a point cloud with no recognizable indoor room",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def private_existing(path: Path, label: str) -> Path:
    if not path.is_absolute() or path.is_symlink() or not path.exists():
        raise ValueError(f"{label} must exist on private WSL ext4")
    resolved = path.resolve()
    if resolved == Path("/home") or not resolved.is_relative_to(Path("/home")):
        raise ValueError(f"{label} resolves outside private WSL ext4")
    return resolved


def model_root(path: Path) -> Path:
    root = private_existing(path, "model")
    if root.name != MODEL_REVISION:
        raise ValueError("classifier model revision differs")
    for name, expected in MODEL_FILES.items():
        candidate = root / name
        if candidate.is_symlink() or not candidate.is_file() or sha256_file(candidate) != expected:
            raise ValueError(f"classifier model file differs: {name}")
        if not candidate.resolve().is_relative_to(Path("/home")):
            raise ValueError("classifier model file resolves outside private WSL ext4")
    return root


def inspection(path: Path) -> tuple[dict[str, Any], dict[str, Path]]:
    root = private_existing(path, "inspection")
    manifest_path = root / "inspection.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("inspection manifest is missing or unsafe")
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("schemaVersion") != "c14-10-private-ply-inspection-v1":
        raise ValueError("inspection schema differs")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("inspection artifact map is invalid")
    images: dict[str, Path] = {}
    for view in VIEWS:
        name = f"{view}.png"
        image = root / name
        if (
            image.is_symlink()
            or not image.is_file()
            or not isinstance(artifacts.get(name), str)
            or sha256_file(image) != artifacts[name]
        ):
            raise ValueError("inspection image identity differs")
        images[view] = image
    return manifest, images


def lanes(values: list[str]) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for value in values:
        label, separator, raw_path = value.partition("=")
        if not separator or not label or label in result or "/" in label:
            raise ValueError("each input must be a unique safe label=absolute-path")
        result[label] = Path(raw_path)
    if not result:
        raise ValueError("at least one inspection is required")
    return result


def prompt_scores(model: Any, processor: Any, image: Any, prompts: tuple[str, ...]) -> list[float]:
    import torch  # type: ignore[import-not-found]

    inputs = processor(
        text=list(prompts), images=[image], padding="max_length", return_tensors="pt"
    ).to("cuda:0")
    with torch.no_grad():
        logits = model(**inputs).logits_per_image[0].float()
    return cast("list[float]", torch.softmax(logits, dim=0).cpu().tolist())


def execute(args: argparse.Namespace) -> None:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    import transformers  # type: ignore[import-not-found]
    from PIL import Image  # type: ignore[import-not-found]
    from transformers import AutoModel, AutoProcessor

    model_path = model_root(Path(args.model))
    output = Path(args.output)
    parent = private_existing(output.parent, "output parent")
    if output.parent.resolve() != parent or output.exists() or output.is_symlink():
        raise ValueError("output must be a fresh private file")
    processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
    model = (
        AutoModel.from_pretrained(model_path, local_files_only=True, torch_dtype=torch.float16)
        .to("cuda:0")
        .eval()
    )
    records: dict[str, Any] = {}
    for label, path in lanes(args.input).items():
        manifest, images = inspection(path)
        views: dict[str, Any] = {}
        for view, image_path in images.items():
            with Image.open(image_path) as opened:
                image = opened.convert("RGB")
                views[view] = {
                    "contentHeuristicSoftmax": prompt_scores(
                        model, processor, image, CONTENT_PROMPTS
                    ),
                    "imageSha256": sha256_file(image_path),
                    "qualityHeuristicSoftmax": prompt_scores(
                        model, processor, image, QUALITY_PROMPTS
                    ),
                }
        records[label] = {
            "inputSha256": manifest["inputSha256"],
            "views": views,
        }
    payload = {
        "authority": "private-local-heuristic-not-representative-accuracy",
        "contentPrompts": list(CONTENT_PROMPTS),
        "model": {
            "files": MODEL_FILES,
            "licence": "Apache-2.0",
            "repository": "google/siglip2-base-patch16-224",
            "revision": MODEL_REVISION,
        },
        "network": "offline",
        "qualityPrompts": list(QUALITY_PROMPTS),
        "records": records,
        "runtime": {
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "tokenizers": importlib.metadata.version("tokenizers"),
        },
        "schemaVersion": "c14-10-vggt-nc-private-siglip-heuristic-v1",
    }
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode() + b"\n")
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps({"recordCount": len(records), "resultSha256": sha256_file(output)}))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--model", required=True)
    value.add_argument("--input", action="append", required=True)
    value.add_argument("--output", required=True)
    value.set_defaults(function=execute)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
