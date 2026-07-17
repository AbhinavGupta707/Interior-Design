import { describe, expect, it } from "vitest";

import {
  c6PlanPolicy,
  c6RouteContract,
  createPlanCalibrationRequestSchema,
  createPlanOperationDraftRequestSchema,
  planParserRequestSchema,
  planParserResultSchema,
  planProcessingJobSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const proposalId = "40000000-0000-4000-8000-000000000001";
const candidateId = "50000000-0000-4000-8000-000000000001";
const calibrationId = "60000000-0000-4000-8000-000000000001";
const sha256 = "a".repeat(64);
const now = "2026-07-17T08:00:00.000Z";

function source() {
  return {
    assetId,
    byteSize: 1_024,
    coordinateSpace: "fixture-microunits",
    detectedMimeType: "image/svg+xml",
    heightSourceUnits: 10_000,
    pageIndex: 0,
    projectId,
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    sha256,
    widthSourceUnits: 10_000,
  } as const;
}

function parser() {
  return {
    adapterId: "fixture-plan-parser",
    adapterVersion: "1.0.0",
    manifestSha256: "b".repeat(64),
    mode: "deterministic-fixture",
    normalizers: [{ name: "fixture-normalizer", version: "1.0.0" }],
  } as const;
}

describe("C6 plan processing contracts", () => {
  it("freezes the supported box, no-key parser limits and route inventory", () => {
    expect(c6PlanPolicy).toMatchObject({
      maximumAssetBytes: 26_214_400,
      maximumOperationDraftSize: 50,
      maximumPageCount: 20,
      maximumRasterPixels: 20_000_000,
      parserTimeoutMilliseconds: 30_000,
    });
    expect(c6RouteContract).toEqual({
      calibrateProposal:
        "/v1/projects/:projectId/plan-processing-jobs/:jobId/proposal/calibrations",
      cancelJob: "/v1/projects/:projectId/plan-processing-jobs/:jobId/cancel",
      createJob: "/v1/projects/:projectId/plan-processing-jobs",
      createOperationDraft:
        "/v1/projects/:projectId/plan-processing-jobs/:jobId/proposal/operation-drafts",
      getJob: "/v1/projects/:projectId/plan-processing-jobs/:jobId",
      getProposal: "/v1/projects/:projectId/plan-processing-jobs/:jobId/proposal",
      listJobs: "/v1/projects/:projectId/plan-processing-jobs",
      retryJob: "/v1/projects/:projectId/plan-processing-jobs/:jobId/retry",
    });
    expect(Object.isFrozen(c6RouteContract)).toBe(true);
  });

  it("accepts a bounded source-pinned parser request and rejects unknown fields", () => {
    const request = {
      jobId,
      limits: {
        maximumCandidates: 200,
        maximumOutputBytes: 5_242_880,
        timeoutMilliseconds: 30_000,
      },
      normalizedInputSha256: "c".repeat(64),
      parserMode: "deterministic-vector",
      schemaVersion: "c6-plan-parser-input-v1",
      source: source(),
    };
    expect(planParserRequestSchema.parse(request)).toEqual(request);
    expect(
      planParserRequestSchema.safeParse({ ...request, signedUrl: "https://invalid.test" }).success,
    ).toBe(false);
  });

  it("publishes only proposals above the confidence floor", () => {
    const proposal = {
      candidates: [
        {
          candidateId,
          confidence: 90,
          elevationMillimetres: 0,
          kind: "level",
          sourceRegion: { maximum: { x: 9_000, y: 9_000 }, minimum: { x: 1_000, y: 1_000 } },
          suggestedName: "Ground floor",
        },
      ],
      createdAt: now,
      findings: [],
      jobId,
      normalizedInputSha256: "c".repeat(64),
      overallConfidence: 90,
      parser: parser(),
      projectId,
      proposalId,
      schemaVersion: "c6-plan-proposal-v1",
      source: source(),
      status: "proposal",
      unresolvedRegions: [],
    };
    expect(planParserResultSchema.parse(proposal)).toEqual(proposal);
    expect(planParserResultSchema.safeParse({ ...proposal, overallConfidence: 74 }).success).toBe(
      false,
    );
  });

  it("represents low confidence as an explicit abstention with recovery", () => {
    expect(
      planParserResultSchema.parse({
        code: "low-confidence",
        createdAt: now,
        detail: "The bounded parser could not produce a safe plan proposal.",
        findings: [],
        jobId,
        nextActions: ["add-known-dimension", "use-manual-editor"],
        normalizedInputSha256: "c".repeat(64),
        parser: parser(),
        projectId,
        proposalId,
        retryable: false,
        schemaVersion: "c6-plan-proposal-v1",
        source: source(),
        status: "abstained",
      }),
    ).toMatchObject({ code: "low-confidence", status: "abstained" });
  });

  it("enforces terminal job/result invariants", () => {
    const job = {
      assetId,
      attempt: 1,
      createdAt: now,
      id: jobId,
      pageIndex: 0,
      parserPreference: "auto",
      projectId,
      resultId: proposalId,
      retryable: false,
      schemaVersion: "c6-plan-job-v1",
      sourceSha256: sha256,
      state: "proposed",
      updatedAt: now,
      version: 3,
    };
    expect(planProcessingJobSchema.parse(job)).toEqual(job);
    expect(planProcessingJobSchema.safeParse({ ...job, resultId: undefined }).success).toBe(false);
    expect(
      planProcessingJobSchema.safeParse({
        ...job,
        safeCode: undefined,
        state: "abstained",
      }).success,
    ).toBe(false);
  });

  it("requires non-degenerate exact rational calibration evidence", () => {
    const request = {
      evidence: {
        knownLengthMillimetres: 4_000,
        method: "known-length",
        sourceEnd: { x: 5_000, y: 1_000 },
        sourceStart: { x: 1_000, y: 1_000 },
      },
      sourceToModel: {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        denominator: 1,
        rounding: "half-away-from-zero",
        translateXMillimetres: 0,
        translateYMillimetres: 0,
      },
    };
    expect(createPlanCalibrationRequestSchema.parse(request)).toEqual(request);
    expect(
      createPlanCalibrationRequestSchema.safeParse({
        ...request,
        sourceToModel: { ...request.sourceToModel, d: 0 },
      }).success,
    ).toBe(false);
  });

  it("maps reviewed candidates to unique public C5 operations without committing", () => {
    const operation = {
      clientOperationId: "70000000-0000-4000-8000-000000000001",
      name: {
        attribution: {
          claimId: "80000000-0000-4000-8000-000000000001",
          confidenceBasisPoints: 9_000,
          evidenceIds: ["90000000-0000-4000-8000-000000000001"],
          method: { kind: "plan-import", name: "C6 correction review", version: "1.0.0" },
          state: "inferred",
          verification: { status: "not-reviewed" },
        },
        knowledge: "known",
        value: "Kitchen",
      },
      reason: "Accept the reviewed plan label.",
      schemaVersion: "c5-model-operation-v1",
      spaceId: "a0000000-0000-4000-8000-000000000001",
      type: "space.rename.v1",
    } as const;
    const request = {
      acknowledgedFindingCodes: [],
      calibrationId,
      decisions: [
        {
          candidateId,
          decision: "corrected",
          resultingClientOperationIds: [operation.clientOperationId],
        },
      ],
      operations: [operation],
      reviewDurationMilliseconds: 120_000,
      target: {
        branchId: "b0000000-0000-4000-8000-000000000001",
        expectedHeadSnapshotSha256: sha256,
        expectedRevision: 1,
        profile: "existing",
      },
    };
    expect(createPlanOperationDraftRequestSchema.parse(request)).toEqual(request);
    expect(
      createPlanOperationDraftRequestSchema.safeParse({
        ...request,
        decisions: [...request.decisions, { ...request.decisions[0], decision: "accepted" }],
      }).success,
    ).toBe(false);
  });
});
