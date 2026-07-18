export const designBriefFailureCodes = Object.freeze([
  "BRIEF_ALREADY_ACCEPTED",
  "BRIEF_ACCEPTANCE_EMPTY",
  "BRIEF_ENTRY_EXISTS",
  "BRIEF_ENTRY_NOT_FOUND",
  "BRIEF_INVALID_CLASSIFICATION_PROVENANCE",
  "BRIEF_INVALID_PATCH",
  "BRIEF_INVALID_TIMESTAMP",
  "BRIEF_REFERENCE_EXISTS",
  "BRIEF_REFERENCE_NOT_FOUND",
  "BRIEF_RESOURCE_LIMIT",
] as const);

export type DesignBriefFailureCode = (typeof designBriefFailureCodes)[number];

const safeMessages: Readonly<Record<DesignBriefFailureCode, string>> = Object.freeze({
  BRIEF_ACCEPTANCE_EMPTY: "Acceptance requires at least one active attributable brief entry.",
  BRIEF_ALREADY_ACCEPTED: "An accepted brief must be reopened by a subsequent edit.",
  BRIEF_ENTRY_EXISTS: "The patch would create a duplicate brief entry ID.",
  BRIEF_ENTRY_NOT_FOUND: "The patch refers to a brief entry that does not exist.",
  BRIEF_INVALID_CLASSIFICATION_PROVENANCE:
    "The entry classification and attributable provenance are inconsistent.",
  BRIEF_INVALID_PATCH: "The brief patch is invalid.",
  BRIEF_INVALID_TIMESTAMP: "The brief mutation timestamp is invalid.",
  BRIEF_REFERENCE_EXISTS: "The patch would create a duplicate reference-board item ID.",
  BRIEF_REFERENCE_NOT_FOUND: "The patch refers to a reference-board item that does not exist.",
  BRIEF_RESOURCE_LIMIT: "The brief exceeds a bounded resource limit.",
});

export class DesignBriefDomainError extends Error {
  readonly code: DesignBriefFailureCode;

  constructor(code: DesignBriefFailureCode) {
    super(safeMessages[code]);
    this.name = "DesignBriefDomainError";
    this.code = code;
  }
}
