import {
  consultationPromptId,
  consultationToolId,
  deterministicLocalAdapterId,
  externalDisabledAdapterId,
  type ModelCapabilityManifest,
  type PromptRegistryEntry,
  type ToolRegistryEntry,
} from "./types.js";

export const promptRegistryVersion = "c11-brief-consultation-prompts-v1" as const;
export const toolRegistryVersion = "c11-brief-tools-v1" as const;

export const promptRegistry: Readonly<Record<typeof consultationPromptId, PromptRegistryEntry>> =
  Object.freeze({
    [consultationPromptId]: Object.freeze({
      id: consultationPromptId,
      purpose: "extract-c11-brief-patch-proposal",
      treatsUntrustedTextAsData: true,
      version: promptRegistryVersion,
    }),
  });

export const toolRegistry: Readonly<Record<typeof consultationToolId, ToolRegistryEntry>> =
  Object.freeze({
    [consultationToolId]: Object.freeze({
      allowedOperationKinds: Object.freeze(["entry.add"] as const),
      id: consultationToolId,
      sideEffects: false,
      version: toolRegistryVersion,
    }),
  });

const deniedCapabilities = Object.freeze([
  "generic-network",
  "generic-filesystem",
  "generic-database",
  "object-storage",
  "canonical-model-mutation",
  "brief-mutation",
] as const);

export const modelCapabilityManifests = Object.freeze({
  [deterministicLocalAdapterId]: Object.freeze({
    adapterId: deterministicLocalAdapterId,
    available: true,
    deniedCapabilities,
    externalNetworkUsed: false,
    inputLogged: false,
    promptIds: Object.freeze([consultationPromptId]),
    toolIds: Object.freeze([consultationToolId]),
    trainingUsed: false,
  } satisfies ModelCapabilityManifest),
  [externalDisabledAdapterId]: Object.freeze({
    adapterId: externalDisabledAdapterId,
    available: false,
    deniedCapabilities,
    externalNetworkUsed: false,
    inputLogged: false,
    promptIds: Object.freeze([consultationPromptId]),
    toolIds: Object.freeze([consultationToolId]),
    trainingUsed: false,
  } satisfies ModelCapabilityManifest),
});
