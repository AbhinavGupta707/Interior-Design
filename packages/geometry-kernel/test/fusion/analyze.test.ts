import { describe, expect, it } from "vitest";

import {
  analyzeFusionProposalObservations,
  computeFusionCoverage,
  detectFusionConflicts,
  recommendFusionDisposition,
  type FusionClaim,
  type FusionCoverageObservation,
  type FusionExpectedRegion,
} from "../../src/index.js";

const sha = (character: string): string => character.repeat(64);
const sourceIds = ["plan-source", "roomplan-source", "photo-source"] as const;

const claims: readonly FusionClaim[] = [
  {
    claimId: "plan-wall-length",
    confidenceBasisPoints: 9_000,
    kind: "dimension",
    numericValueMm: 4_000,
    semanticKey: "wall:w-1:length",
    sourceId: sourceIds[0],
    state: "source-derived",
    valueSha256: sha("a"),
  },
  {
    claimId: "room-wall-length",
    confidenceBasisPoints: 8_500,
    kind: "dimension",
    numericValueMm: 4_080,
    semanticKey: "wall:w-1:length",
    sourceId: sourceIds[1],
    state: "observed",
    valueSha256: sha("b"),
  },
  {
    claimId: "plan-room-class",
    kind: "classification",
    semanticKey: "space:s-1:classification",
    sourceId: sourceIds[0],
    state: "source-derived",
    valueSha256: sha("c"),
  },
  {
    claimId: "photo-room-class",
    kind: "classification",
    semanticKey: "space:s-1:classification",
    sourceId: sourceIds[2],
    state: "inferred",
    valueSha256: sha("d"),
  },
  {
    claimId: "unknown-opening-width",
    kind: "dimension",
    semanticKey: "opening:o-1:width",
    sourceId: sourceIds[2],
    state: "unknown",
  },
] as const;

const expectedRegions: readonly FusionExpectedRegion[] = [
  { levelId: "ground", regionId: "kitchen" },
  { levelId: "ground", regionId: "hall" },
  { levelId: "first", regionId: "bedroom" },
] as const;

const coverageObservations: readonly FusionCoverageObservation[] = [
  {
    evidenceSha256: sha("1"),
    levelId: "ground",
    regionId: "kitchen",
    sourceId: sourceIds[0],
    state: "supported",
  },
  {
    evidenceSha256: sha("2"),
    levelId: "ground",
    regionId: "kitchen",
    sourceId: sourceIds[1],
    state: "supported",
  },
  {
    levelId: "ground",
    regionId: "hall",
    sourceId: sourceIds[1],
    state: "inferred",
  },
  {
    levelId: "first",
    regionId: "bedroom",
    sourceId: sourceIds[2],
    state: "unknown",
  },
] as const;

function valueOf<TValue>(result: { ok: false } | { ok: true; value: TValue }): TValue {
  if (!result.ok) throw new Error("Expected successful fusion observation analysis.");
  return result.value;
}

describe("proposal-only fusion conflict, coverage and abstention utilities", () => {
  it("surfaces incompatible claims without choosing or averaging a semantic value", () => {
    const conflicts = valueOf(detectFusionConflicts(claims, sourceIds));

    expect(conflicts).toHaveLength(2);
    expect(conflicts).toEqual([
      expect.objectContaining({
        code: "CLASSIFICATION_CONFLICT",
        semanticKey: "space:s-1:classification",
        severity: "error",
        sourceIds: ["photo-source", "plan-source"],
      }),
      expect.objectContaining({
        code: "DIMENSION_CONFLICT",
        magnitudeMm: 80,
        semanticKey: "wall:w-1:length",
        severity: "warning",
        sourceIds: ["plan-source", "roomplan-source"],
      }),
    ]);
    for (const conflict of conflicts) {
      expect(conflict).not.toHaveProperty("selectedClaimId");
      expect(conflict).not.toHaveProperty("averageValueMm");
      expect(conflict.sourceClaims).toHaveLength(2);
    }
  });

  it("treats sub-tolerance dimensions as compatible without hiding their exact hashes", () => {
    const conflicts = valueOf(
      detectFusionConflicts(claims.slice(0, 2), sourceIds, { dimensionalToleranceMm: 100 }),
    );

    expect(conflicts).toEqual([]);
    expect(claims[0]).toMatchObject({ valueSha256: sha("a"), numericValueMm: 4_000 });
    expect(claims[1]).toMatchObject({ valueSha256: sha("b"), numericValueMm: 4_080 });
  });

  it("counts only immutable support and leaves inferred/unsupported regions explicit", () => {
    const coverage = valueOf(
      computeFusionCoverage(sourceIds, sourceIds, expectedRegions, coverageObservations),
    );

    expect(coverage).toEqual({
      inferredRegionCount: 1,
      registeredSourceCount: 3,
      regions: [
        {
          levelId: "first",
          regionId: "bedroom",
          sourceIds: ["photo-source"],
          state: "unknown",
        },
        {
          levelId: "ground",
          regionId: "hall",
          sourceIds: ["roomplan-source"],
          state: "inferred",
        },
        {
          levelId: "ground",
          regionId: "kitchen",
          sourceIds: ["plan-source", "roomplan-source"],
          state: "supported",
        },
      ],
      supportedCoverageBasisPoints: 3_333,
      supportedRegionCount: 1,
      totalRegionCount: 3,
      unknownRegionCount: 1,
    });
  });

  it("abstains for severe conflicts, no registration, no support and inadequate coverage", () => {
    const coverage = valueOf(
      computeFusionCoverage(sourceIds, sourceIds, expectedRegions, coverageObservations),
    );
    const conflicts = valueOf(detectFusionConflicts(claims, sourceIds));
    expect(valueOf(recommendFusionDisposition(coverage, conflicts))).toEqual({
      reasons: ["CONFLICT_LIMIT_EXCEEDED"],
      status: "abstained",
      version: "c9-fusion-analysis-v1",
    });

    const emptyCoverage = valueOf(computeFusionCoverage(sourceIds, [], expectedRegions, []));
    expect(valueOf(recommendFusionDisposition(emptyCoverage, []))).toEqual({
      reasons: ["INSUFFICIENT_COVERAGE", "NO_REGISTERED_SOURCES", "NO_SUPPORTED_REGIONS"],
      status: "abstained",
      version: "c9-fusion-analysis-v1",
    });
  });

  it("distinguishes full and partial proposals using supported coverage only", () => {
    const full = valueOf(
      computeFusionCoverage(
        sourceIds,
        sourceIds.slice(0, 2),
        expectedRegions.slice(0, 2),
        [
          coverageObservations[0],
          {
            evidenceSha256: sha("3"),
            levelId: "ground",
            regionId: "hall",
            sourceId: sourceIds[1],
            state: "supported",
          },
        ].filter((value): value is FusionCoverageObservation => value !== undefined),
      ),
    );
    expect(valueOf(recommendFusionDisposition(full, []))).toMatchObject({
      status: "full-proposal",
    });

    const partial = valueOf(
      computeFusionCoverage(sourceIds, sourceIds, expectedRegions, coverageObservations),
    );
    expect(
      valueOf(
        recommendFusionDisposition(partial, [], { minimumPartialCoverageBasisPoints: 3_000 }),
      ),
    ).toMatchObject({
      reasons: [],
      status: "partial-proposal",
    });
  });

  it("analyzes frozen proposal observations deterministically without mutating canonical state", () => {
    const input = {
      claims: structuredClone(claims),
      coverageObservations: structuredClone(coverageObservations),
      expectedRegions: structuredClone(expectedRegions),
      registeredSourceIds: [...sourceIds],
      sourceIds: [...sourceIds],
    };
    const original = JSON.stringify(input);

    const first = analyzeFusionProposalObservations(input);
    const reordered = analyzeFusionProposalObservations({
      claims: [...claims].reverse(),
      coverageObservations: [...coverageObservations].reverse(),
      expectedRegions: [...expectedRegions].reverse(),
      registeredSourceIds: [...sourceIds].reverse(),
      sourceIds: [...sourceIds].reverse(),
    });

    expect(reordered).toEqual(first);
    expect(JSON.stringify(input)).toBe(original);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.claims[0])).toBe(false);
    expect(Object.isFrozen(input.coverageObservations[0])).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.ok) {
      expect(first.value.disposition.status).toBe("abstained");
      expect(first.value.conflictConfig.version).toBe("c9-fusion-analysis-v1");
      expect(first.value.dispositionConfig.version).toBe("c9-fusion-analysis-v1");
      expect(Object.isFrozen(first.value.conflicts)).toBe(true);
      expect(Object.isFrozen(first.value.coverage.regions)).toBe(true);
    }
  });

  it("rejects hidden unknown values, duplicate claims, unregistered support and resource abuse", () => {
    expect(
      detectFusionConflicts(
        [
          {
            claimId: "hidden",
            kind: "dimension",
            numericValueMm: 100,
            semanticKey: "opening:o-1:width",
            sourceId: sourceIds[0],
            state: "unknown",
          } as unknown as FusionClaim,
        ],
        sourceIds,
      ),
    ).toMatchObject({ error: { code: "INVALID_CLAIM" }, ok: false });
    expect(
      detectFusionConflicts([claims[0], claims[0]].filter(Boolean) as FusionClaim[], sourceIds),
    ).toMatchObject({
      error: { code: "DUPLICATE_CLAIM" },
      ok: false,
    });
    expect(
      computeFusionCoverage(
        sourceIds,
        sourceIds.slice(0, 2),
        expectedRegions,
        [coverageObservations[3]].filter(
          (value): value is FusionCoverageObservation => value !== undefined,
        ),
      ),
    ).toMatchObject({ error: { code: "INVALID_COVERAGE" }, ok: false });
    expect(detectFusionConflicts(claims, sourceIds, { maximumClaims: 2 })).toMatchObject({
      error: { code: "RESOURCE_LIMIT_EXCEEDED" },
      ok: false,
    });
  });
});
