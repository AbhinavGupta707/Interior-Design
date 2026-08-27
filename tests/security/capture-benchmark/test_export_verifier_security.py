from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / "ml/reconstruction/windows-nvidia-v2"


def module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "capture_benchmark_security", PACKAGE / "capture_benchmark.py"
    )
    assert spec is not None and spec.loader is not None
    value = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = value
    spec.loader.exec_module(value)
    return value


def fixture(tmp_path: Path) -> Path:
    root = tmp_path / "fixture"
    subprocess.run(
        [
            sys.executable,
            str(PACKAGE / "generate_capture_benchmark_fixture.py"),
            "--output",
            str(root),
        ],
        check=True,
    )
    return root


def test_extra_file_and_symlink_are_rejected(tmp_path: Path) -> None:
    verifier = module()
    root = fixture(tmp_path)
    (root / "unlisted.txt").write_text("secret")
    with pytest.raises(ValueError, match="unlisted"):
        verifier.verify_export(root)
    (root / "unlisted.txt").unlink()
    os.symlink(root / "envelope.json", root / "leak")
    with pytest.raises(ValueError, match="links"):
        verifier.verify_export(root)


def test_traversal_and_secret_keys_are_rejected(tmp_path: Path) -> None:
    verifier = module()
    root = fixture(tmp_path)
    path = root / "export-manifest.json"
    manifest = json.loads(path.read_bytes())
    manifest["signedUrl"] = "https://storage.invalid/?credential=secret"
    path.write_bytes(verifier.canonical_bytes(manifest) + b"\n")
    with pytest.raises(ValueError, match="forbidden"):
        verifier.verify_export(root)
    assert "storage.invalid" not in str(pytest.raises)
