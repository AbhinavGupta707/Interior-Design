from __future__ import annotations

import importlib.util
import stat
import sys
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
RUNNER_PATH = REPOSITORY_ROOT / "ml/reconstruction/windows-nvidia-v2/run_acceptance.py"
SPEC = importlib.util.spec_from_file_location("c8_acceptance_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RUNNER
SPEC.loader.exec_module(RUNNER)
RUNNER = cast(ModuleType, RUNNER)


def test_container_writable_directory_overrides_host_umask(tmp_path: Path) -> None:
    target = tmp_path / "sparse"

    RUNNER._prepare_directory(target, writable_by_container=True)

    assert stat.S_IMODE(target.stat().st_mode) == 0o777


def test_each_container_command_has_a_bounded_timeout() -> None:
    timeout = RUNNER.COMMAND_TIMEOUT_SECONDS

    assert isinstance(timeout, int)
    assert 60 <= timeout <= 60 * 60


def test_canonical_output_is_materialized_once(tmp_path: Path) -> None:
    target = tmp_path / "open3d-result.json"

    RUNNER._materialize_json_output(target, {"z": 1, "a": 2})

    assert target.read_bytes() == b'{"a":2,"z":1}\n'
    with pytest.raises(ValueError, match="unsafe JSON output target"):
        RUNNER._materialize_json_output(target, {"a": 2, "z": 1})

    dangling = tmp_path / "dangling.json"
    dangling.symlink_to(tmp_path / "missing.json")


def _repeatability_input(second_registered_images: int = 10) -> dict[str, object]:
    def colmap(registered_images: int) -> dict[str, object]:
        return {
            "algorithms": {
                "dense": {
                    "depthPositiveValues": 100,
                    "ply": {
                        "coordinateBounds": {"maximum": [1, 1, 1], "minimum": [0, 0, 0]},
                        "payloadValidated": True,
                        "vertexCount": 1_000,
                    },
                },
                "sparse": {
                    "observations": 20_000,
                    "registeredImages": registered_images,
                    "sparsePoints": 3_000,
                },
            }
        }

    open3d = {
        "workload": {
            "cpuTsdf": {"triangleCount": 20, "vertexCount": 10},
            "cudaTensorProbe": {"checksum": 123.0},
        }
    }
    appearance = {
        "plyValidation": {"vertexCount": 6},
        "workload": {"heldOutPsnrDb": 35.0, "optimizerSteps": 24},
    }
    return {
        "appearanceRun1": appearance,
        "appearanceRun2": appearance,
        "colmap411Run1": colmap(10),
        "colmap411Run2": colmap(second_registered_images),
        "open3dRun1": open3d,
        "open3dRun2": open3d,
    }


def test_repeatability_gate_rejects_sparse_registration_collapse() -> None:
    passed = RUNNER._evaluate_repeatability(_repeatability_input())
    failed = RUNNER._evaluate_repeatability(_repeatability_input(7))

    assert passed["verdict"] == "passed"
    assert failed["verdict"] == "failed"
    checks = failed["checks"]
    assert isinstance(checks, dict)
    assert checks["colmapSparse"]["passed"] is False
