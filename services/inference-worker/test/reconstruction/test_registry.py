"""Deterministic evidence for the official C8 adapter discovery registry."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from pathlib import Path

import inference_worker.reconstruction.registry as registry_module
from inference_worker.reconstruction.colmap import ColmapAdapter
from inference_worker.reconstruction.common.execution import BinaryId, BinaryRegistry
from inference_worker.reconstruction.gsplat import (
    GsplatAppearanceAdapter,
    unavailable_gsplat_adapter,
)
from inference_worker.reconstruction.nerfstudio import (
    NeuralAppearanceAdapter,
    unavailable_nerfstudio_adapter,
)
from inference_worker.reconstruction.nerfstudio.runtime import (
    CommandExecutor,
    CommandResult,
    fixture_runtime,
)
from inference_worker.reconstruction.open3d import Open3dTsdfAdapter


class _UnusedExecutor(CommandExecutor):
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
        cancelled: Callable[[], bool],
    ) -> CommandResult:
        del argv, cwd, timeout_seconds, cancelled
        raise AssertionError("adapter execution is not part of registration")


def _patch_discovery(
    monkeypatch: object,
    *,
    binary_registry: BinaryRegistry,
    open3d_available: bool,
    neural: NeuralAppearanceAdapter,
    gsplat: GsplatAppearanceAdapter,
) -> dict[str, int]:
    calls = {"binary": 0, "neural": 0, "gsplat": 0}

    def production() -> BinaryRegistry:
        calls["binary"] += 1
        return binary_registry

    def discover_neural() -> NeuralAppearanceAdapter:
        calls["neural"] += 1
        return neural

    def discover_gsplat() -> GsplatAppearanceAdapter:
        calls["gsplat"] += 1
        return gsplat

    # pytest's MonkeyPatch type is intentionally avoided here so the production
    # source remains the only dependency imported by this focused test module.
    patch = monkeypatch.setattr  # type: ignore[attr-defined]
    patch(BinaryRegistry, "production", production)
    patch(registry_module, "_open3d_import_available", lambda: open3d_available)
    patch(NeuralAppearanceAdapter, "discover", discover_neural)
    patch(GsplatAppearanceAdapter, "discover", discover_gsplat)
    return calls


def _fixture_executable(path: Path) -> Path:
    path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    path.chmod(0o700)
    return path


def test_unavailable_host_still_registers_all_adapters_with_safe_bounded_state(
    monkeypatch: object,
) -> None:
    calls = _patch_discovery(
        monkeypatch,
        binary_registry=BinaryRegistry({}),
        open3d_available=False,
        neural=unavailable_nerfstudio_adapter("APPEARANCE_TOOL_UNAVAILABLE"),
        gsplat=unavailable_gsplat_adapter("APPEARANCE_CUDA_UNAVAILABLE"),
    )

    registry = registry_module.discover_reconstruction_adapters()

    assert calls == {"binary": 1, "neural": 1, "gsplat": 1}
    assert isinstance(registry.colmap, ColmapAdapter)
    assert isinstance(registry.open3d, Open3dTsdfAdapter)
    assert isinstance(registry.nerfstudio, NeuralAppearanceAdapter)
    assert isinstance(registry.gsplat, GsplatAppearanceAdapter)
    assert [item["adapterId"] for item in registry.public_state()] == [
        "c8.geometry.colmap",
        "c8.geometry.open3d",
        "c8.appearance.nerfstudio",
        "c8.appearance.gsplat",
    ]
    assert [item["status"] for item in registry.public_state()] == [
        "unavailable",
        "unavailable",
        "unavailable",
        "unavailable",
    ]
    assert [item["safeCode"] for item in registry.public_state()] == [
        "COLMAP_NOT_INSTALLED",
        "OPEN3D_NOT_INSTALLED",
        "APPEARANCE_TOOL_UNAVAILABLE",
        "APPEARANCE_CUDA_UNAVAILABLE",
    ]
    assert registry.public_state()[-1]["hardwareStatus"] == "unavailable"


def test_available_registration_is_deterministic_and_never_exposes_runtime_paths(
    monkeypatch: object, tmp_path: Path
) -> None:
    colmap = _fixture_executable(tmp_path / "private-colmap")
    python = _fixture_executable(tmp_path / "private-open3d-python")
    binary_registry = BinaryRegistry.fixture(
        {BinaryId.COLMAP: colmap, BinaryId.OPEN3D_PYTHON: python}
    )
    executor = _UnusedExecutor()
    neural = NeuralAppearanceAdapter.with_runtime(fixture_runtime(tmp_path), executor=executor)
    gsplat = GsplatAppearanceAdapter.with_runtime(fixture_runtime(tmp_path), executor=executor)
    _patch_discovery(
        monkeypatch,
        binary_registry=binary_registry,
        open3d_available=True,
        neural=neural,
        gsplat=gsplat,
    )

    registry = registry_module.discover_reconstruction_adapters()
    first = registry.public_state()
    second = registry.public_state()

    assert first == second
    assert all(item["status"] == "available" for item in first)
    assert all(item["hardwareStatus"] == "available" for item in first)
    assert [item["outputAuthority"] for item in first] == [
        "proposal-only-geometry",
        "proposal-only-geometry",
        "non-dimensional-appearance",
        "non-dimensional-appearance",
    ]
    serialized = json.dumps(first, separators=(",", ":"), sort_keys=True)
    assert str(tmp_path) not in serialized
    assert "private-colmap" not in serialized
    assert "private-open3d-python" not in serialized
    assert "credential" not in serialized.lower()
    assert "token" not in serialized.lower()
    assert "path" not in serialized.lower()
    assert str(tmp_path) not in repr(registry)


def test_unknown_appearance_code_and_inconsistent_ready_state_fail_closed(
    monkeypatch: object,
) -> None:
    neural = unavailable_nerfstudio_adapter("provider leaked /private/path")
    gsplat = unavailable_gsplat_adapter("APPEARANCE_READY")
    _patch_discovery(
        monkeypatch,
        binary_registry=BinaryRegistry({}),
        open3d_available=False,
        neural=neural,
        gsplat=gsplat,
    )

    public = registry_module.discover_reconstruction_adapters().public_state()

    assert public[2]["safeCode"] == "APPEARANCE_PROBE_FAILED"
    assert public[3]["safeCode"] == "APPEARANCE_PROBE_FAILED"
    assert public[2]["status"] == "unavailable"
    assert public[3]["status"] == "unavailable"
    assert "/private/path" not in json.dumps(public)
