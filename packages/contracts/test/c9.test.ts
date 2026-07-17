import { describe, expect, it } from "vitest";

import {
  c9FusionPolicy,
  c9RouteContract,
  createFusionJobRequestSchema,
  createFusionOperationDraftRequestSchema,
  fusionDiscrepancySchema,
  fusionJobSchema,
  fusionProposalSchema,
  fusionSimilarityTransformSchema,
  reviewFusionDiscrepanciesRequestSchema,
} from "../src/index.js";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  baseSnapshot: "10000000-0000-4000-8000-000000000002",
  discrepancy: "10000000-0000-4000-8000-000000000003",
  job: "10000000-0000-4000-8000-000000000004",
  level: "10000000-0000-4000-8000-000000000005",
  model: "10000000-0000-4000-8000-000000000006",
  project: "10000000-0000-4000-8000-000000000007",
  proposal: "10000000-0000-4000-8000-000000000008",
  sourceA: "10000000-0000-4000-8000-000000000009",
  sourceB: "10000000-0000-4000-8000-000000000010",
  sourceReferenceA: "10000000-0000-4000-8000-000000000011",
  sourceReferenceB: "10000000-0000-4000-8000-000000000012",
};
const now = "2026-07-17T12:00:00.000Z";
const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const rights = {
  serviceProcessingConsent: true,
  trainingUseConsent: "denied",
} as const;
const baseSnapshot = {
  modelId: ids.model,
  profile: "existing",
  snapshotId: ids.baseSnapshot,
  snapshotSha256: shaA,
} as const;
const sources = [
  {
    coordinateFrame: "project-local",
    elementCount: 12,
    evidenceState: "source-derived",
    id: ids.sourceA,
    kind: "plan-proposal",
    referenceId: ids.sourceReferenceA,
    rights,
    scaleStatus: "metric-validated",
    schemaVersion: "c6-plan-proposal-v1",
    sha256: shaA,
  },
  {
    coordinateFrame: "source-local-metric",
    elementCount: 24,
    evidenceState: "source-derived",
    id: ids.sourceB,
    kind: "reconstruction-result",
    referenceId: ids.sourceReferenceB,
    rights,
    scaleStatus: "metric-estimated",
    schemaVersion: "c8-reconstruction-result-v1",
    sha256: shaB,
  },
] as const;
const request = {
  anchorGroups: [],
  baseSnapshot,
  inferencePolicy: "label-and-expose",
  label: "Synthetic two-source full-house fusion",
  sources,
} as const;

describe("C9 multi-source fusion contracts", () => {
  it("freezes bounded policy and exact public routes", () => {
    expect(c9FusionPolicy).toMatchObject({
      maximumAttempts: 3,
      maximumSources: 32,
      minimumDistinctSourceKinds: 2,
      minimumSources: 2,
    });
    expect(c9RouteContract).toEqual({
      cancelJob: "/v1/projects/:projectId/fusion-jobs/:fusionJobId/cancel",
      createJob: "/v1/projects/:projectId/fusion-jobs",
      createOperationDraft:
        "/v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal/operation-drafts",
      getJob: "/v1/projects/:projectId/fusion-jobs/:fusionJobId",
      getProposal: "/v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal",
      listJobs: "/v1/projects/:projectId/fusion-jobs",
      retryJob: "/v1/projects/:projectId/fusion-jobs/:fusionJobId/retry",
      reviewDiscrepancies:
        "/v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal/discrepancy-decisions",
    });
  });

  it("requires at least two distinct rights-cleared immutable source kinds", () => {
    expect(createFusionJobRequestSchema.parse(request)).toEqual(request);
    expect(
      createFusionJobRequestSchema.safeParse({
        ...request,
        sources: [sources[0], { ...sources[1], kind: "plan-proposal" }],
      }).success,
    ).toBe(false);
    expect(
      createFusionJobRequestSchema.safeParse({
        ...request,
        sources: [
          sources[0],
          { ...sources[1], rights: { ...rights, trainingUseConsent: "granted" } },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps terminal job state, proposal and safe-code references consistent", () => {
    const job = {
      attempt: 1,
      createdAt: now,
      createdBy: ids.actor,
      id: ids.job,
      projectId: ids.project,
      request,
      state: "queued",
      updatedAt: now,
      version: 1,
    } as const;
    expect(fusionJobSchema.parse(job)).toEqual(job);
    expect(
      fusionJobSchema.safeParse({ ...job, proposalId: ids.proposal, state: "proposed" }).success,
    ).toBe(true);
    expect(fusionJobSchema.safeParse({ ...job, state: "failed" }).success).toBe(false);
  });

  it("rejects non-unit fixed-point transforms instead of normalising hidden input", () => {
    const transform = {
      rotationQuaternionE9: { w: 1_000_000_000, x: 0, y: 0, z: 0 },
      scalePartsPerMillion: 1_000_000,
      translationMm: { xMm: 0, yMm: 0, zMm: 0 },
    } as const;
    expect(fusionSimilarityTransformSchema.parse(transform)).toEqual(transform);
    expect(
      fusionSimilarityTransformSchema.safeParse({
        ...transform,
        rotationQuaternionE9: { w: 1, x: 1, y: 1, z: 1 },
      }).success,
    ).toBe(false);
  });

  it("requires explicit conflicting source claims for dimensional discrepancies", () => {
    const discrepancy = {
      affectedElementIds: [],
      code: "DIMENSION_CONFLICT",
      id: ids.discrepancy,
      kind: "dimension",
      magnitudeMm: 85,
      message: "Two sources disagree about the wall length.",
      requiresHumanDecision: true,
      schemaVersion: "c9-discrepancy-v1",
      severity: "warning",
      sourceClaims: [
        { sourceId: ids.sourceA, state: "source-derived", valueSha256: shaA },
        { sourceId: ids.sourceB, state: "source-derived", valueSha256: shaB },
      ],
      suggestedOperations: [],
    } as const;
    expect(fusionDiscrepancySchema.parse(discrepancy)).toEqual(discrepancy);
    expect(
      fusionDiscrepancySchema.safeParse({
        ...discrepancy,
        sourceClaims: [discrepancy.sourceClaims[0]],
      }).success,
    ).toBe(false);
  });

  it("supports honest abstention without manufacturing a candidate snapshot", () => {
    const unregistered = (sourceId: string) => ({
      findings: [
        { code: "NO_CONNECTED_COMPONENT", detail: "No reliable overlap.", severity: "error" },
      ],
      schemaVersion: "c9-registration-result-v1",
      sourceId,
      status: "unregistered",
    });
    expect(
      fusionProposalSchema.safeParse({
        authority: "proposal-only",
        baseSnapshot,
        coverage: {
          inputSourceCount: 2,
          levelsCovered: 0,
          registeredSourceCount: 0,
          unknownRegionCount: 1,
        },
        createdAt: now,
        discrepancies: [],
        findings: [
          { code: "INSUFFICIENT_OVERLAP", detail: "Fusion abstained.", severity: "error" },
        ],
        id: ids.proposal,
        projectId: ids.project,
        registrations: [unregistered(ids.sourceA), unregistered(ids.sourceB)],
        safeCode: "INSUFFICIENT_OVERLAP",
        schemaVersion: "c9-full-house-proposal-v1",
        sourceManifestSha256: shaA,
        status: "abstained",
        version: 1,
      }).success,
    ).toBe(true);
  });

  it("cannot turn review into a direct or empty canonical mutation", () => {
    expect(
      reviewFusionDiscrepanciesRequestSchema.safeParse({
        decisions: [
          {
            choice: "correct",
            correctedOperations: [],
            discrepancyId: ids.discrepancy,
            reason: "Correction requires a typed operation.",
          },
        ],
        expectedProposalVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      createFusionOperationDraftRequestSchema.safeParse({
        branchId: ids.model,
        decisionIds: [],
        expectedBranchRevision: 0,
        expectedHeadSnapshotSha256: shaA,
        expectedProposalVersion: 1,
      }).success,
    ).toBe(false);
  });
});
