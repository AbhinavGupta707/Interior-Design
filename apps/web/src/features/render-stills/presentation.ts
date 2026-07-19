import type { RenderArtifact, RenderJob, RenderJobState } from "@interior-design/contracts";

export const renderStages = [
  { label: "Queued", states: ["queued"] },
  { label: "Preparing exact inputs", states: ["preparing"] },
  { label: "Rendering safe result", states: ["rendering-safe"] },
  { label: "Validating passes", states: ["validating-safe"] },
  { label: "Publishing immutable result", states: ["publishing-safe"] },
  { label: "Safe result ready", states: ["succeeded"] },
] as const;

export function stageIndex(state: RenderJobState): number {
  if (state === "cancel-requested") return 2;
  if (state === "cancelled" || state === "failed") return -1;
  return renderStages.findIndex(({ states }) => (states as readonly string[]).includes(state));
}

export function jobStateLabel(state: RenderJobState): string {
  const labels: Readonly<Record<RenderJobState, string>> = {
    cancelled: "Cancelled · no result published",
    "cancel-requested": "Cancellation requested",
    failed: "Failed safely",
    preparing: "Preparing exact inputs",
    "publishing-safe": "Publishing safe result",
    queued: "Queued durably",
    "rendering-safe": "Rendering geometry-locked result",
    succeeded: "Safe result published",
    "validating-safe": "Validating safe passes",
  };
  return labels[state];
}

export function canCancel(job: RenderJob): boolean {
  return ["queued", "preparing", "rendering-safe", "validating-safe", "publishing-safe"].includes(
    job.state,
  );
}

export function canRetry(job: RenderJob): boolean {
  return job.state === "failed" || job.state === "cancelled";
}

export function artifactLabel(role: RenderArtifact["role"]): string {
  const labels: Readonly<Record<RenderArtifact["role"], string>> = {
    "depth-exr": "Depth · EXR container metadata",
    "geometry-safe-png": "Geometry-locked deterministic render",
    "illustrative-enhancement-png": "Illustrative optional enhancement",
    "multilayer-exr": "Multilayer diagnostics · EXR container metadata",
    "normal-exr": "Normals · EXR container metadata",
    "segmentation-png": "Canonical element segmentation",
  };
  return labels[role];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
