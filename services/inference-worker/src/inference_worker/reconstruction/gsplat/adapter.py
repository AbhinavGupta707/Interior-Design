"""Production gsplat/Splatfacto adapter for non-dimensional C8 appearance."""

from __future__ import annotations

from typing import Literal

from ..nerfstudio.adapter import (
    AdapterDefinition,
    NeuralAppearanceAdapter,
)
from ..nerfstudio.runtime import (
    CommandExecutor,
    RegisteredRuntime,
    RuntimeRegistration,
    register_runtime,
)

GSPLAT_DEFINITION = AdapterDefinition(
    adapter_id="c8.gsplat",
    adapter_version="1.0.0",
    artifact_kind="gaussian-splat",
    artifact_media_type="application/vnd.interior-design.gaussian-splat+ply",
    method="gsplat",
    model="splatfacto",
)


class GsplatAppearanceAdapter(NeuralAppearanceAdapter):
    """Fixed Splatfacto command backed by the pinned gsplat CUDA package."""

    def __init__(
        self,
        *,
        registration: RuntimeRegistration,
        executor: CommandExecutor | None = None,
        runtime_evidence: Literal["live-runtime", "synthetic-fixture"] = "live-runtime",
    ) -> None:
        super().__init__(
            definition=GSPLAT_DEFINITION,
            registration=registration,
            executor=executor,
            runtime_evidence=runtime_evidence,
        )

    @classmethod
    def discover(cls) -> GsplatAppearanceAdapter:
        """Register gsplat only after exact tool, version, and CUDA discovery."""

        return cls(registration=register_runtime())

    @classmethod
    def with_runtime(
        cls,
        runtime: RegisteredRuntime,
        *,
        executor: CommandExecutor,
        runtime_evidence: Literal["live-runtime", "synthetic-fixture"] = "synthetic-fixture",
    ) -> GsplatAppearanceAdapter:
        """Inject a visibly synthetic command fixture for adapter conformance tests."""

        return cls(
            registration=RuntimeRegistration(
                status="available", safe_code="APPEARANCE_READY", runtime=runtime
            ),
            executor=executor,
            runtime_evidence=runtime_evidence,
        )


def unavailable_gsplat_adapter(safe_code: str) -> GsplatAppearanceAdapter:
    """Construct an explicitly disabled gsplat registration."""

    return GsplatAppearanceAdapter(
        registration=RuntimeRegistration(status="unavailable", safe_code=safe_code)
    )
