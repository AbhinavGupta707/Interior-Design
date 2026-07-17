import type {
  ReconstructionJob,
  ReconstructionJobState,
  ReconstructionResult,
} from "@interior-design/contracts";

import type { ReconstructionWorkspace } from "./contracts";

export interface ReconstructionStageView {
  readonly detail: string;
  readonly label: string;
  readonly state: "attention" | "complete" | "current" | "skipped" | "upcoming";
}

const activeStates = new Set<ReconstructionJobState>([
  "created",
  "preparing",
  "ready-for-reconstruction",
  "reconstructing-geometry",
  "reconstructing-appearance",
  "cancel-requested",
]);

export function isActiveReconstructionState(state: ReconstructionJobState): boolean {
  return activeStates.has(state);
}

export function diagnosticMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    DISCONNECTED_COMPONENTS:
      "The registered frames formed separate components. They were not silently merged.",
    EXCESSIVE_ALIGNMENT_RESIDUAL:
      "Alignment residuals exceeded the accepted bound, so metric validation was withheld.",
    INSUFFICIENT_OVERLAP:
      "The sources did not share enough visual overlap for a dependable reconstruction.",
    PARTIAL_REGISTRATION:
      "Only part of the prepared frame set registered. Missing coverage remains explicit.",
    PRIVACY_REVIEW_REQUIRED:
      "One or more prepared frames need privacy review before geometry processing.",
    RECONSTRUCTION_GPU_UNAVAILABLE:
      "The requested GPU stage is unavailable in this runtime. No GPU output was fabricated.",
    RECONSTRUCTION_PROVIDER_UNAVAILABLE:
      "No eligible reconstruction provider is configured for this stage.",
    SCALE_UNKNOWN:
      "No validated scale anchors were available. Geometry remains in arbitrary units.",
    SYNTHETIC_FIXTURE_ONLY:
      "This deterministic result came from a visibly synthetic test fixture, not live media.",
  };
  return (
    messages[code] ??
    `The worker reported ${code.toLowerCase().replaceAll("_", " ")}. Review is required.`
  );
}

function reachedGeometry(state: ReconstructionJobState): boolean {
  return ["completed", "reconstructing-appearance", "reconstructing-geometry"].includes(state);
}

export function reconstructionStages(
  job: ReconstructionJob,
  capabilities: ReconstructionWorkspace["capabilities"],
  result?: ReconstructionResult,
): readonly ReconstructionStageView[] {
  const terminalProblem = ["abstained", "cancelled", "failed"].includes(job.state);
  const preparationComplete = !["created", "preparing"].includes(job.state);
  const geometryComplete = job.state === "completed" || job.state === "reconstructing-appearance";
  const appearanceRequested = job.request.appearanceMode === "optional";
  return [
    {
      detail:
        job.state === "created" && capabilities.geometryWorker === "unavailable"
          ? "Durably queued. No geometry worker is advertised in this local runtime."
          : "Validate, sample, strip metadata and complete privacy review.",
      label: "1 · Preparation",
      state: terminalProblem ? "attention" : preparationComplete ? "complete" : "current",
    },
    {
      detail: "Calibrate cameras and publish proposal-only sparse or dense geometry.",
      label: "2 · Geometry",
      state: terminalProblem
        ? "attention"
        : geometryComplete
          ? "complete"
          : reachedGeometry(job.state) || job.state === "ready-for-reconstruction"
            ? "current"
            : "upcoming",
    },
    {
      detail: !appearanceRequested
        ? "Not requested. Geometry remains independently usable."
        : capabilities.appearanceProvider === "unavailable"
          ? "Requested optionally, but no appearance provider or GPU is advertised."
          : "Optional non-dimensional appearance; never dimensional truth.",
      label: "3 · Appearance",
      state: !appearanceRequested
        ? "skipped"
        : result?.status === "completed" && result.appearance
          ? "complete"
          : job.state === "reconstructing-appearance"
            ? "current"
            : job.state === "completed"
              ? "skipped"
              : terminalProblem
                ? "attention"
                : "upcoming",
    },
  ];
}
