export const evidenceStatusValues = [
  "observed",
  "source-derived",
  "fused",
  "inferred",
  "user-asserted",
  "unknown",
] as const;

export type EvidenceStatus = (typeof evidenceStatusValues)[number];
