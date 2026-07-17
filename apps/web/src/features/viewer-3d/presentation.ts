import type { SceneJob, SceneJobState } from "@interior-design/contracts";

const stateLabels: Readonly<Record<SceneJobState, string>> = Object.freeze({
  "cancel-requested": "Cancellation requested",
  cancelled: "Cancelled",
  compiling: "Compiling geometry",
  failed: "Failed safely",
  leased: "Worker reserved",
  publishing: "Publishing immutable scene",
  queued: "Queued",
  succeeded: "Ready to inspect",
});

export function sceneJobStateLabel(state: SceneJobState): string {
  return stateLabels[state];
}

export function isActiveSceneState(state: SceneJobState): boolean {
  return ["queued", "leased", "compiling", "publishing", "cancel-requested"].includes(state);
}

export function canCancelScene(job: SceneJob): boolean {
  return ["queued", "leased", "compiling", "publishing"].includes(job.state);
}

export function canRetryScene(job: SceneJob): boolean {
  return (job.state === "failed" || job.state === "cancelled") && job.attempt < 3;
}

export function formattedSceneBytes(bytes: number): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
    style: "unit",
    unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte",
    unitDisplay: "short",
  }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000));
}
