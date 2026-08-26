import type {
  RenderEligibleSourcesResponse,
  RenderHostCapabilities,
} from "@interior-design/contracts";

import { renderCapabilitiesSchema } from "./contracts";
import type { RenderCapabilities } from "./contracts";

const profileLabels: Readonly<
  Record<RenderHostCapabilities["profiles"][number]["profileId"], string>
> = {
  "cycles-cpu-geometry-safe-v1": "Cycles CPU · geometry safe",
  "cycles-cuda-high-resolution-v1": "Cycles CUDA · high resolution",
  "cycles-metal-geometry-safe-v1": "Cycles Metal · geometry safe",
  "cycles-optix-high-resolution-v1": "Cycles OptiX · high resolution",
  "eevee-local-preview-v1": "Eevee local preview",
};

export function composeRenderCapabilities(
  host: RenderHostCapabilities,
  eligible: RenderEligibleSourcesResponse,
): RenderCapabilities {
  const accepting = host.acceptingNewJobs && host.profiles.some(({ available }) => available);
  return renderCapabilitiesSchema.parse({
    enhancementProvider: {
      reason:
        host.enhancementProvider === "enabled"
          ? "The configured optional enhancement provider is available."
          : "External image enhancement is disabled by the C14 provider policy.",
      state: host.enhancementProvider === "enabled" ? "available" : "disabled",
    },
    lightingPresets: [
      {
        label: "Canonical lights · neutral world",
        lightingPresetId: "canonical-lights-neutral-world-v1",
      },
    ],
    profiles: host.profiles.map((profile) => ({
      label: profileLabels[profile.profileId],
      profileId: profile.profileId,
      ...(profile.reason ? { reason: profile.reason } : {}),
      state: host.acceptingNewJobs && profile.available ? "available" : "deferred",
    })),
    renderer: {
      hardwareGate: host.hardwareEvidence === "verified-authorised-host" ? "satisfied" : "deferred",
      reason: accepting
        ? "The platform currently accepts new work for at least one frozen render profile."
        : "No authorised render host currently accepts new work for a frozen profile.",
      state: accepting ? "available" : "deferred",
    },
    sources: eligible.sources.map(({ cameras, label, source }) => ({
      cameras,
      label,
      sourceSceneJobId: source.sceneJobId,
      specifications:
        source.specification === undefined
          ? []
          : [
              {
                label: `Specification revision ${String(source.specification.specificationRevision)}`,
                specificationId: source.specification.specificationId,
                specificationRevision: source.specification.specificationRevision,
              },
            ],
    })),
  });
}
