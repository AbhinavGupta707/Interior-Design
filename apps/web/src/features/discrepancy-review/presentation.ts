import type {
  FusionJob,
  FusionProposal,
  FusionRegistrationResult,
} from "@interior-design/contracts";
import type { fusionDiscrepancyDecisionSchema } from "@interior-design/contracts";
import type { z } from "zod";

type FusionDiscrepancyDecision = z.infer<typeof fusionDiscrepancyDecisionSchema>;

const activeStates = new Set<FusionJob["state"]>([
  "queued",
  "registering",
  "fitting",
  "comparing",
  "cancel-requested",
]);

export function isActiveFusionState(state: FusionJob["state"]): boolean {
  return activeStates.has(state);
}

export function canCancelFusion(job: FusionJob): boolean {
  return ["queued", "registering", "fitting", "comparing"].includes(job.state);
}

export function canRetryFusion(job: FusionJob): boolean {
  return ["abstained", "cancelled", "failed"].includes(job.state) && job.attempt < 3;
}

export function proposalStatusLabel(status: FusionProposal["status"]): string {
  if (status === "full-house-proposal") return "Full-house proposal";
  if (status === "partial-proposal") return "Partial proposal";
  return "Fusion abstained";
}

export function registrationLabel(registration: FusionRegistrationResult): string {
  if (registration.status === "unregistered") return "Not registered";
  return registration.status === "partial" ? "Partially registered" : "Registered";
}

export function connectedComponentCount(proposal: FusionProposal): number {
  return new Set(
    proposal.registrations.flatMap((registration) =>
      registration.status === "unregistered" ? [] : [registration.connectedComponentId],
    ),
  ).size;
}

export function materialDecisionIds(
  decisions: readonly FusionDiscrepancyDecision[],
  proposal?: FusionProposal,
): readonly string[] {
  return decisions
    .filter((decision) => {
      if (!["accept-candidate", "correct", "mark-unknown"].includes(decision.choice)) {
        return false;
      }
      if (proposal === undefined) return true;
      const discrepancy = proposal.discrepancies.find(({ id }) => id === decision.discrepancyId);
      if (discrepancy === undefined) return false;
      if (decision.choice === "mark-unknown") {
        return discrepancy.suggestedOperations.some(
          (operation) =>
            operation.type === "element.provenance.correct.v1" &&
            operation.attribution.state === "unknown",
        );
      }
      return discrepancy.suggestedOperations.length > 0;
    })
    .map(({ id }) => id);
}
