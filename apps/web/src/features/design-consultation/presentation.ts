import type {
  BriefEntry,
  BriefEntryClassification,
  BriefPatchOperation,
  BriefPatchProposal,
  DesignBrief,
} from "@interior-design/contracts";

export interface ClassificationPresentation {
  readonly description: string;
  readonly label: string;
  readonly tone:
    "assertion" | "conflict" | "constraint" | "evidence" | "inference" | "preference" | "unknown";
}

const classificationPresentation: Readonly<
  Record<BriefEntryClassification, ClassificationPresentation>
> = Object.freeze({
  "hard-constraint": {
    description: "A requirement that a design option must satisfy.",
    label: "Constraint",
    tone: "constraint",
  },
  "household-assertion": {
    description: "Information stated by an accountable household member.",
    label: "Assertion",
    tone: "assertion",
  },
  "inferred-suggestion": {
    description: "A system suggestion to inspect, not an established fact.",
    label: "Inference",
    tone: "inference",
  },
  "observed-evidence": {
    description: "A claim linked to immutable project evidence or a pinned model snapshot.",
    label: "Evidence",
    tone: "evidence",
  },
  preference: {
    description: "A desired quality that may be balanced against other priorities.",
    label: "Preference",
    tone: "preference",
  },
  "unresolved-conflict": {
    description: "Two or more inputs disagree and need an accountable decision.",
    label: "Conflict",
    tone: "conflict",
  },
  unknown: {
    description: "The available evidence does not establish an answer.",
    label: "Unknown",
    tone: "unknown",
  },
});

export function classificationFor(
  classification: BriefEntryClassification,
): ClassificationPresentation {
  return classificationPresentation[classification];
}

export function categoryLabel(value: BriefEntry["category"]): string {
  return value.replaceAll("-", " ");
}

export function entryCounts(
  brief: DesignBrief,
): Readonly<Record<BriefEntryClassification, number>> {
  const counts: Record<BriefEntryClassification, number> = {
    "hard-constraint": 0,
    "household-assertion": 0,
    "inferred-suggestion": 0,
    "observed-evidence": 0,
    preference: 0,
    "unresolved-conflict": 0,
    unknown: 0,
  };
  for (const entry of brief.entries) counts[entry.classification] += 1;
  return counts;
}

export function operationLabel(operation: BriefPatchOperation): string {
  switch (operation.kind) {
    case "entry.add":
      return "Add brief entry";
    case "entry.remove":
      return "Remove brief entry";
    case "entry.replace":
      return "Replace brief entry";
    case "reference.add":
      return "Add reference";
    case "reference.remove":
      return "Remove reference";
  }
}

export function proposalHasExpired(proposal: BriefPatchProposal, now = Date.now()): boolean {
  return proposal.status === "expired" || Date.parse(proposal.expiresAt) <= now;
}

type ReviewReason = BriefPatchProposal["professionalReview"][number]["reason"];

export function reviewReasonLabel(reason: ReviewReason): string {
  const labels: Record<ReviewReason, string> = {
    "accessibility-clinical": "Clinical accessibility review",
    "cost-certainty": "Cost review",
    "insufficient-evidence": "Evidence review",
    "product-availability": "Product availability check",
    "professional-judgement": "Professional judgement",
    regulatory: "Regulatory review",
    structural: "Structural engineer review",
  };
  return labels[reason];
}

export function canAcceptBrief(brief: DesignBrief): boolean {
  return brief.status === "draft" && brief.entries.length > 0;
}
