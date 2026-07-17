import { describe, expect, it } from "vitest";

import {
  isKnownAttribution,
  isReviewedForPurpose,
  isUnknownAttribution,
  normalizeAttributionReferences,
  parseAttribution,
  ProvenanceInvariantError,
  requireReviewForPurpose,
  selectAttributionByClaimId,
  transitionAttribution,
} from "../src/index.js";

const ids = Object.freeze({
  actor: "20000000-0000-4000-8000-000000000001",
  claimA: "91000000-0000-4000-8000-000000000001",
  claimB: "91000000-0000-4000-8000-000000000002",
  evidenceA: "81000000-0000-4000-8000-000000000001",
  evidenceB: "81000000-0000-4000-8000-000000000002",
});

const method = Object.freeze({
  kind: "fixture" as const,
  name: "Synthetic provenance fixture",
  version: "c4-v1",
});
const notReviewed = Object.freeze({ status: "not-reviewed" as const });

function knownAttribution(
  state: "fused" | "inferred" | "observed" | "source-derived" | "user-asserted",
  claimId: string = ids.claimA,
) {
  return {
    ...(state === "user-asserted" ? { actorUserId: ids.actor } : {}),
    claimId,
    ...(state === "fused" || state === "inferred" ? { confidenceBasisPoints: 7_500 } : {}),
    evidenceIds: state === "user-asserted" ? [] : [ids.evidenceB, ids.evidenceA],
    method,
    state,
    verification: notReviewed,
  };
}

function unknownAttribution(claimId: string = ids.claimA) {
  return {
    claimId,
    evidenceIds: [],
    method,
    reason: "not-observed" as const,
    state: "unknown" as const,
    verification: notReviewed,
  };
}

describe("C4 provenance invariants", () => {
  it.each(["observed", "source-derived", "fused", "inferred", "user-asserted"] as const)(
    "accepts a contract-complete %s attribution",
    (state) => {
      const parsed = parseAttribution(knownAttribution(state));
      expect(isKnownAttribution(parsed)).toBe(true);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.evidenceIds)).toBe(true);
    },
  );

  it("keeps unknown separate and rejects missing evidence, confidence, or actor requirements", () => {
    const unknown = parseAttribution(unknownAttribution());
    expect(isUnknownAttribution(unknown)).toBe(true);

    expect(() => parseAttribution({ ...knownAttribution("observed"), evidenceIds: [] })).toThrow(
      ProvenanceInvariantError,
    );
    const inferred = knownAttribution("inferred");
    expect(() => parseAttribution({ ...inferred, confidenceBasisPoints: undefined })).toThrow(
      ProvenanceInvariantError,
    );
    const asserted = knownAttribution("user-asserted");
    expect(() => parseAttribution({ ...asserted, actorUserId: undefined })).toThrow(
      ProvenanceInvariantError,
    );
  });

  it("rejects duplicate evidence references and canonicalizes reference order without mutation", () => {
    expect(() =>
      parseAttribution({
        ...knownAttribution("observed"),
        evidenceIds: [ids.evidenceA, ids.evidenceA],
      }),
    ).toThrow(/duplicate IDs/u);

    const input = knownAttribution("observed");
    const normalized = normalizeAttributionReferences(input);
    expect(normalized.evidenceIds).toEqual([ids.evidenceA, ids.evidenceB]);
    expect(input.evidenceIds).toEqual([ids.evidenceB, ids.evidenceA]);
  });

  it("makes review purpose-specific and rejects a generic verified flag", () => {
    const reviewed = {
      ...knownAttribution("user-asserted"),
      verification: {
        limitations: ["Not suitable for setting out."],
        purpose: "concept" as const,
        reviewedAt: "2026-07-17T10:00:00.000Z",
        reviewedBy: ids.actor,
        status: "reviewed-with-limitations" as const,
      },
    };
    expect(isReviewedForPurpose(reviewed, "concept")).toBe(true);
    expect(isReviewedForPurpose(reviewed, "construction")).toBe(false);
    expect(requireReviewForPurpose(reviewed, "concept").reviewedBy).toBe(ids.actor);
    expect(() => requireReviewForPurpose(reviewed, "technical")).toThrow(ProvenanceInvariantError);
    expect(() =>
      parseAttribution({
        ...reviewed,
        verification: { ...reviewed.verification, verified: true },
      }),
    ).toThrow(ProvenanceInvariantError);
  });

  it("requires a new immutable claim ID for meaningful transitions", () => {
    const current = knownAttribution("observed");
    expect(transitionAttribution(current, structuredClone(current)).evidenceIds).toEqual([
      ids.evidenceA,
      ids.evidenceB,
    ]);
    expect(
      transitionAttribution(current, {
        ...current,
        evidenceIds: current.evidenceIds.toReversed(),
      }).claimId,
    ).toBe(current.claimId);
    expect(() =>
      transitionAttribution(current, {
        ...current,
        method: { ...method, version: "c4-v2" },
      }),
    ).toThrow(/new immutable claim ID/u);
    expect(transitionAttribution(current, knownAttribution("inferred", ids.claimB)).claimId).toBe(
      ids.claimB,
    );
    expect(transitionAttribution(current, unknownAttribution(ids.claimB)).state).toBe("unknown");
  });

  it("selects only an explicit unique claim and never a confidence winner", () => {
    const lowerConfidence = {
      ...knownAttribution("inferred", ids.claimA),
      confidenceBasisPoints: 1_000,
    };
    const higherConfidence = {
      ...knownAttribution("inferred", ids.claimB),
      confidenceBasisPoints: 9_900,
    };
    expect(
      selectAttributionByClaimId([higherConfidence, lowerConfidence], ids.claimA).claimId,
    ).toBe(ids.claimA);
    expect(() => selectAttributionByClaimId([higherConfidence], ids.claimA)).toThrow(
      /not present/u,
    );
    expect(() =>
      selectAttributionByClaimId([lowerConfidence, lowerConfidence], ids.claimA),
    ).toThrow(/not unique/u);
  });
});
