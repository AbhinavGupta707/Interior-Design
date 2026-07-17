"""Official, registration-first discovery for C8 reconstruction adapters.

Discovery is a worker-startup concern. No job field can select an executable,
alter a probe, or inject an adapter. The public projection intentionally carries
only bounded provider and hardware state; executable paths and runtime details
remain inside the registered adapters.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass, field
from typing import Literal, cast

from .colmap import ColmapAdapter
from .common.errors import ReconstructionError
from .common.execution import BinaryId, BinaryRegistry
from .gsplat import GsplatAppearanceAdapter
from .nerfstudio import NeuralAppearanceAdapter
from .open3d import Open3dTsdfAdapter

type AdapterId = Literal[
    "c8.geometry.colmap",
    "c8.geometry.open3d",
    "c8.appearance.nerfstudio",
    "c8.appearance.gsplat",
]
type Capability = Literal["geometry", "appearance"]
type Provider = Literal["colmap", "open3d", "nerfstudio", "gsplat"]
type RegistrationStatus = Literal["available", "unavailable"]
type HardwareRequirement = Literal["cpu", "cpu-rgbd", "nvidia-cuda"]
type HardwareStatus = Literal["available", "unavailable", "unknown"]
type OutputAuthority = Literal["proposal-only-geometry", "non-dimensional-appearance"]
type SafeCode = Literal[
    "COLMAP_READY",
    "COLMAP_NOT_INSTALLED",
    "OPEN3D_READY",
    "OPEN3D_NOT_INSTALLED",
    "APPEARANCE_READY",
    "APPEARANCE_TOOL_UNAVAILABLE",
    "APPEARANCE_TORCH_UNAVAILABLE",
    "APPEARANCE_CUDA_UNAVAILABLE",
    "APPEARANCE_VERSION_MISMATCH",
    "APPEARANCE_PROBE_FAILED",
]

_APPEARANCE_SAFE_CODES = frozenset(
    {
        "APPEARANCE_READY",
        "APPEARANCE_TOOL_UNAVAILABLE",
        "APPEARANCE_TORCH_UNAVAILABLE",
        "APPEARANCE_CUDA_UNAVAILABLE",
        "APPEARANCE_VERSION_MISMATCH",
        "APPEARANCE_PROBE_FAILED",
    }
)
_REGISTRATION_ORDER: tuple[AdapterId, ...] = (
    "c8.geometry.colmap",
    "c8.geometry.open3d",
    "c8.appearance.nerfstudio",
    "c8.appearance.gsplat",
)


@dataclass(frozen=True, slots=True)
class PublicAdapterRegistration:
    """Redacted adapter state safe for status APIs and telemetry attributes."""

    adapter_id: AdapterId
    capability: Capability
    provider: Provider
    status: RegistrationStatus
    hardware_requirement: HardwareRequirement
    hardware_status: HardwareStatus
    output_authority: OutputAuthority
    safe_code: SafeCode

    def to_public_dict(self) -> dict[str, str]:
        """Return the exact bounded wire projection without runtime internals."""

        return {
            "adapterId": self.adapter_id,
            "capability": self.capability,
            "provider": self.provider,
            "status": self.status,
            "hardwareRequirement": self.hardware_requirement,
            "hardwareStatus": self.hardware_status,
            "outputAuthority": self.output_authority,
            "safeCode": self.safe_code,
        }


@dataclass(frozen=True, slots=True)
class ReconstructionAdapterRegistry:
    """Four code-owned adapters and their deterministic public registration state."""

    colmap: ColmapAdapter = field(repr=False)
    open3d: Open3dTsdfAdapter = field(repr=False)
    nerfstudio: NeuralAppearanceAdapter = field(repr=False)
    gsplat: GsplatAppearanceAdapter = field(repr=False)
    registrations: tuple[PublicAdapterRegistration, ...]

    def __post_init__(self) -> None:
        if tuple(item.adapter_id for item in self.registrations) != _REGISTRATION_ORDER:
            raise ValueError("RECONSTRUCTION_REGISTRY_INCOMPLETE")

    def public_state(self) -> tuple[dict[str, str], ...]:
        """Project a fresh immutable-order status payload for external consumers."""

        return tuple(item.to_public_dict() for item in self.registrations)


def _open3d_import_available() -> bool:
    """Check package registration without importing provider code or running a job."""

    try:
        return importlib.util.find_spec("open3d") is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def _geometry_registration(
    *,
    adapter_id: AdapterId,
    provider: Provider,
    binary_registry: BinaryRegistry,
) -> PublicAdapterRegistration:
    if provider == "colmap":
        try:
            binary_registry.resolve(BinaryId.COLMAP)
        except ReconstructionError:
            status: RegistrationStatus = "unavailable"
            hardware_status: HardwareStatus = "unknown"
            safe_code: SafeCode = "COLMAP_NOT_INSTALLED"
        else:
            status = "available"
            hardware_status = "available"
            safe_code = "COLMAP_READY"
        requirement: HardwareRequirement = "cpu"
    else:
        if _open3d_import_available():
            status = "available"
            hardware_status = "available"
            safe_code = "OPEN3D_READY"
        else:
            status = "unavailable"
            hardware_status = "unknown"
            safe_code = "OPEN3D_NOT_INSTALLED"
        requirement = "cpu-rgbd"
    return PublicAdapterRegistration(
        adapter_id=adapter_id,
        capability="geometry",
        provider=provider,
        status=status,
        hardware_requirement=requirement,
        hardware_status=hardware_status,
        output_authority="proposal-only-geometry",
        safe_code=safe_code,
    )


def _appearance_registration(
    *,
    adapter_id: AdapterId,
    provider: Provider,
    adapter: NeuralAppearanceAdapter,
) -> PublicAdapterRegistration:
    # The adapters deliberately keep executable paths and version details private.
    # This same-package registry reads only the typed result of their official
    # activation probe and projects a closed set of non-identifying fields.
    runtime_registration = adapter._registration
    raw_code = runtime_registration.safe_code
    safe_code = cast(
        "SafeCode",
        raw_code if raw_code in _APPEARANCE_SAFE_CODES else "APPEARANCE_PROBE_FAILED",
    )
    consistent_available = (
        runtime_registration.status == "available"
        and runtime_registration.runtime is not None
        and safe_code == "APPEARANCE_READY"
    )
    if not consistent_available and safe_code == "APPEARANCE_READY":
        safe_code = "APPEARANCE_PROBE_FAILED"
    status: RegistrationStatus = "available" if consistent_available else "unavailable"
    if consistent_available:
        hardware_status: HardwareStatus = "available"
    elif safe_code == "APPEARANCE_CUDA_UNAVAILABLE":
        hardware_status = "unavailable"
    else:
        hardware_status = "unknown"
    return PublicAdapterRegistration(
        adapter_id=adapter_id,
        capability="appearance",
        provider=provider,
        status=status,
        hardware_requirement="nvidia-cuda",
        hardware_status=hardware_status,
        output_authority="non-dimensional-appearance",
        safe_code=safe_code,
    )


def discover_reconstruction_adapters() -> ReconstructionAdapterRegistry:
    """Register every C8 adapter through code-owned discovery at worker startup."""

    binary_registry = BinaryRegistry.production()
    colmap = ColmapAdapter(binary_registry)
    open3d = Open3dTsdfAdapter(binary_registry)
    nerfstudio = NeuralAppearanceAdapter.discover()
    gsplat = GsplatAppearanceAdapter.discover()
    registrations = (
        _geometry_registration(
            adapter_id="c8.geometry.colmap",
            provider="colmap",
            binary_registry=binary_registry,
        ),
        _geometry_registration(
            adapter_id="c8.geometry.open3d",
            provider="open3d",
            binary_registry=binary_registry,
        ),
        _appearance_registration(
            adapter_id="c8.appearance.nerfstudio",
            provider="nerfstudio",
            adapter=nerfstudio,
        ),
        _appearance_registration(
            adapter_id="c8.appearance.gsplat",
            provider="gsplat",
            adapter=gsplat,
        ),
    )
    return ReconstructionAdapterRegistry(
        colmap=colmap,
        open3d=open3d,
        nerfstudio=nerfstudio,
        gsplat=gsplat,
        registrations=registrations,
    )
