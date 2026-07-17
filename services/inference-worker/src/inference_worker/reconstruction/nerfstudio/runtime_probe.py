"""Emit bounded, non-identifying runtime facts for C8 adapter registration."""

from __future__ import annotations

import importlib
import importlib.metadata
import json
import platform
from typing import Protocol, cast


class _CudaProbe(Protocol):
    def is_available(self) -> bool: ...

    def device_count(self) -> int: ...


class _VersionProbe(Protocol):
    cuda: str | None


class _TorchProbe(Protocol):
    __version__: str
    cuda: _CudaProbe
    version: _VersionProbe


def main() -> int:
    """Probe installed package/CUDA state without reading any job or customer data."""

    try:
        torch = cast("_TorchProbe", importlib.import_module("torch"))
    except ImportError:
        print(json.dumps({"available": False, "safeCode": "APPEARANCE_TORCH_UNAVAILABLE"}))
        return 2
    packages: dict[str, str] = {}
    for name in ("nerfstudio", "gsplat"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            print(json.dumps({"available": False, "safeCode": "APPEARANCE_TOOL_UNAVAILABLE"}))
            return 2
    result = {
        "available": bool(torch.cuda.is_available() and torch.cuda.device_count() > 0),
        "cuda": str(torch.version.cuda or "none"),
        "deviceCount": int(torch.cuda.device_count()),
        "gsplat": packages["gsplat"],
        "nerfstudio": packages["nerfstudio"],
        "python": platform.python_version(),
        "safeCode": (
            "APPEARANCE_READY"
            if torch.cuda.is_available() and torch.cuda.device_count() > 0
            else "APPEARANCE_CUDA_UNAVAILABLE"
        ),
        "torch": str(torch.__version__),
    }
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0 if result["available"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
