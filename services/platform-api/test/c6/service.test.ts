import {
  planCalibrationSchema,
  planProposalSchema,
  type ModelOperationRequest,
} from "@interior-design/contracts";
import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";
import { describe, expect, it } from "vitest";

import { validateOperationDraft } from "../../src/modules/plan-processing/mapping.js";
import { PlanProcessingService } from "../../src/modules/plan-processing/service.js";
import { alphaProjectId, canonicalSnapshotFixture, ownerUserId } from "../c4/fixtures.js";
import {
  MemoryPlanProcessingRepository,
  actors,
  c6Now,
  eligibleSource,
  fixtureBranch,
  planAssetId,
  planSourceSha256,
} from "./support.js";

const correlation = {
  requestId: "c6-service-request",
  spanId: "2".repeat(16),
  traceId: "1".repeat(32),
  traceParent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
};
const ownerActor = actors["fixture|owner-alpha"];
if (ownerActor === undefined) throw new Error("The C6 owner fixture is missing.");

function sourceAttribution(claimId: string) {
  return {
    claimId,
    evidenceIds: [planAssetId],
    method: { kind: "plan-import" as const, name: "C6 fixture parser", version: "1.0.0" },
    state: "source-derived" as const,
    verification: { status: "not-reviewed" as const },
  };
}

function unknownAttribution(claimId: string) {
  return {
    claimId,
    evidenceIds: [planAssetId],
    method: { kind: "plan-import" as const, name: "C6 fixture parser", version: "1.0.0" },
    reason: "not-provided" as const,
    state: "unknown" as const,
    verification: { status: "not-reviewed" as const },
  };
}

describe("C6 service and strict C5 draft mapping", () => {
  it("fails closed on source readiness, rights, kind, MIME, size and tenant identity", async () => {
    const repository = new MemoryPlanProcessingRepository();
    const service = new PlanProcessingService(repository);
    const command = {
      actor: ownerActor,
      assetId: planAssetId,
      correlation,
      idempotencyKey: "c6-service-create-1",
      pageIndex: 0,
      parserPreference: "auto" as const,
      projectId: alphaProjectId,
    };
    repository.source = eligibleSource({ status: "processing" });
    await expect(service.createJob(command)).rejects.toMatchObject({
      code: "PLAN_SOURCE_NOT_READY",
    });
    repository.source = eligibleSource({ kind: "photo" });
    await expect(service.createJob(command)).rejects.toMatchObject({
      code: "PLAN_SOURCE_KIND_INVALID",
    });
    repository.source = eligibleSource({
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "granted",
      },
    });
    await expect(service.createJob(command)).rejects.toMatchObject({
      code: "PLAN_SOURCE_RIGHTS_NOT_PERMITTED",
    });
    repository.source = eligibleSource({
      rights: {
        basis: "unknown",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
    });
    await expect(service.createJob(command)).rejects.toMatchObject({
      code: "PLAN_SOURCE_RIGHTS_NOT_PERMITTED",
    });
    repository.source = eligibleSource({ detectedMimeType: "text/plain" });
    await expect(service.createJob(command)).rejects.toMatchObject({
      code: "PLAN_SOURCE_UNSUPPORTED",
    });
    repository.source = eligibleSource({ byteSize: 26_214_401 });
    await expect(service.createJob(command)).rejects.toMatchObject({
      code: "PLAN_SOURCE_RESOURCE_LIMIT",
    });
    repository.source = undefined;
    await expect(service.createJob(command)).rejects.toMatchObject({ statusCode: 404 });
    expect(repository.jobs.size).toBe(0);
  });

  it("pins the exact source hash and replays one durable create result", async () => {
    const repository = new MemoryPlanProcessingRepository();
    const service = new PlanProcessingService(repository);
    const command = {
      actor: ownerActor,
      assetId: planAssetId,
      correlation,
      idempotencyKey: "c6-service-create-2",
      pageIndex: 0,
      parserPreference: "auto" as const,
      projectId: alphaProjectId,
    };
    const first = await service.createJob(command);
    const second = await service.createJob(command);
    expect(first.job.sourceSha256).toBe(planSourceSha256);
    expect(second).toEqual({ job: first.job, replayed: true });
    expect(repository.jobs.size).toBe(1);
  });

  it("accepts only exact calibrated source-derived candidate operations and current branch topology", () => {
    const snapshot = canonicalSnapshotFixture();
    const canonical = canonicalizeHomeSnapshot(snapshot);
    const branchTarget = fixtureBranch(canonical.snapshotSha256, canonical.snapshot);
    const candidateId = "88000000-0000-4000-8000-000000000001";
    const proposal = planProposalSchema.parse({
      candidates: [
        {
          candidateId,
          confidence: 95,
          elevationMillimetres: 3000,
          kind: "level",
          sourceRegion: { maximum: { x: 100, y: 100 }, minimum: { x: 0, y: 0 } },
          suggestedName: "Imported upper level",
        },
      ],
      createdAt: c6Now,
      findings: [],
      jobId: "88000000-0000-4000-8000-000000000002",
      normalizedInputSha256: "b".repeat(64),
      overallConfidence: 95,
      parser: {
        adapterId: "fixture-plan-parser",
        adapterVersion: "1.0.0",
        manifestSha256: "c".repeat(64),
        mode: "deterministic-fixture",
        normalizers: [{ name: "fixture-normalizer", version: "1.0.0" }],
      },
      projectId: alphaProjectId,
      proposalId: "88000000-0000-4000-8000-000000000003",
      schemaVersion: "c6-plan-proposal-v1",
      source: {
        assetId: planAssetId,
        byteSize: 1024,
        coordinateSpace: "fixture-microunits",
        detectedMimeType: "image/svg+xml",
        heightSourceUnits: 100,
        pageIndex: 0,
        projectId: alphaProjectId,
        rights: {
          basis: "owned-by-user",
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        sha256: planSourceSha256,
        widthSourceUnits: 100,
      },
      status: "proposal",
      unresolvedRegions: [],
    });
    const calibration = planCalibrationSchema.parse({
      createdAt: c6Now,
      createdBy: ownerUserId,
      evidence: {
        knownLengthMillimetres: 100,
        method: "known-length",
        sourceEnd: { x: 100, y: 0 },
        sourceStart: { x: 0, y: 0 },
      },
      id: "88000000-0000-4000-8000-000000000004",
      jobId: proposal.jobId,
      projectId: alphaProjectId,
      proposalId: proposal.proposalId,
      residualMillimetres: 0,
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
    });
    const clientOperationId = "88000000-0000-4000-8000-000000000005";
    const operation: ModelOperationRequest = {
      clientOperationId,
      level: {
        elementType: "level",
        elevationMm: {
          attribution: sourceAttribution("88000000-0000-4000-8000-000000000006"),
          knowledge: "known",
          value: 3000,
        },
        id: candidateId,
        name: {
          attribution: sourceAttribution("88000000-0000-4000-8000-000000000007"),
          knowledge: "known",
          value: "Imported upper level",
        },
        origin: sourceAttribution("88000000-0000-4000-8000-000000000008"),
        storeyHeightMm: {
          attribution: unknownAttribution("88000000-0000-4000-8000-000000000009"),
          knowledge: "unknown",
        },
      },
      reason: "Accept the calibrated fixture level as an unreviewed source-derived proposal.",
      schemaVersion: "c5-model-operation-v1",
      type: "level.create.v1",
    };
    const request = {
      acknowledgedFindingCodes: [],
      calibrationId: calibration.id,
      decisions: [
        {
          candidateId,
          decision: "accepted" as const,
          resultingClientOperationIds: [clientOperationId],
        },
      ],
      operations: [operation],
      target: {
        branchId: branchTarget.branch.id,
        expectedHeadSnapshotSha256: branchTarget.branch.headSnapshotSha256,
        expectedRevision: branchTarget.branch.revision,
        profile: branchTarget.branch.profile,
      },
    };
    expect(() => {
      validateOperationDraft(proposal, calibration, request, branchTarget, ownerUserId);
    }).not.toThrow();
    const correctedAttribution = {
      actorUserId: ownerUserId,
      claimId: "88000000-0000-4000-8000-000000000011",
      evidenceIds: [planAssetId],
      method: { kind: "manual" as const, name: "C6 corrected fixture", version: "1" },
      state: "user-asserted" as const,
      verification: { status: "not-reviewed" as const },
    };
    const correctedOperation: ModelOperationRequest = {
      ...operation,
      level: {
        ...operation.level,
        elevationMm: { attribution: correctedAttribution, knowledge: "known", value: 3_000 },
        name: {
          attribution: correctedAttribution,
          knowledge: "known",
          value: "Imported upper level",
        },
        origin: correctedAttribution,
      },
      reason: "Correct the calibrated fixture level as a current-user assertion.",
    };
    const correctedRequest = {
      ...request,
      decisions: [
        {
          candidateId,
          decision: "corrected" as const,
          resultingClientOperationIds: [clientOperationId],
        },
      ],
      operations: [correctedOperation],
    };
    expect(() => {
      validateOperationDraft(proposal, calibration, correctedRequest, branchTarget, ownerUserId);
    }).not.toThrow();
    expect(() => {
      validateOperationDraft(
        proposal,
        calibration,
        correctedRequest,
        branchTarget,
        "88000000-0000-4000-8000-000000000099",
      );
    }).toThrow(/current user/u);
    expect(() => {
      validateOperationDraft(
        proposal,
        calibration,
        {
          ...request,
          operations: [
            {
              ...operation,
              level: { ...operation.level, id: "88000000-0000-4000-8000-000000000099" },
            },
          ],
        },
        branchTarget,
        ownerUserId,
      );
    }).toThrow(/retain the candidate UUID/u);
    expect(() => {
      validateOperationDraft(
        {
          ...proposal,
          unresolvedRegions: [
            {
              code: "OCCLUDED",
              detail: "Unknown edge",
              id: "88000000-0000-4000-8000-000000000010",
              nextAction: "correct-manually",
              sourceRegion: { maximum: { x: 10, y: 10 }, minimum: { x: 0, y: 0 } },
            },
          ],
        },
        calibration,
        request,
        branchTarget,
        ownerUserId,
      );
    }).toThrow(/Unresolved regions/u);
  });
});
