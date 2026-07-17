import type { KnownAttribution } from "@interior-design/contracts";

import { canonicalFixtureIds, fixtureClaimId } from "./ids.js";

const fixtureMethod = Object.freeze({
  kind: "fixture" as const,
  name: "C4 deterministic synthetic fixture",
  version: "c4-fixtures-v1",
});

const manualMethod = Object.freeze({
  kind: "manual" as const,
  name: "C4 synthetic profile amendment",
  version: "c4-fixtures-v1",
});

const notReviewed = Object.freeze({ status: "not-reviewed" as const });

export const sourceAttribution = (
  claimSequence: number,
  evidenceIds: readonly string[] = [canonicalFixtureIds.evidence.authoredPlan],
): KnownAttribution => ({
  claimId: fixtureClaimId(claimSequence),
  evidenceIds: [...evidenceIds],
  method: fixtureMethod,
  state: "source-derived",
  verification: notReviewed,
});

export const userAttribution = (claimSequence: number): KnownAttribution => ({
  actorUserId: canonicalFixtureIds.actor,
  claimId: fixtureClaimId(claimSequence),
  evidenceIds: [],
  method: manualMethod,
  state: "user-asserted",
  verification: notReviewed,
});

export const knownFixtureValue = <T>(value: T, claimSequence: number) => ({
  attribution: sourceAttribution(claimSequence),
  knowledge: "known" as const,
  value,
});

export const assertedFixtureValue = <T>(value: T, claimSequence: number) => ({
  attribution: userAttribution(claimSequence),
  knowledge: "known" as const,
  value,
});

export const unknownFixtureValue = (
  claimSequence: number,
  reason:
    | "conflicting-evidence"
    | "not-observed"
    | "not-provided"
    | "outside-scope"
    | "unsupported" = "not-observed",
) => ({
  attribution: {
    claimId: fixtureClaimId(claimSequence),
    evidenceIds: [],
    method: fixtureMethod,
    reason,
    state: "unknown" as const,
    verification: notReviewed,
  },
  knowledge: "unknown" as const,
});
