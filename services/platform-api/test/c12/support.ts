import {
  createOptionJobRequestSchema,
  designBriefSchema,
  designConstraintSchema,
  designOptionSchema,
  designOptionSetSchema,
  interiorAssetRefSchema,
  modelSnapshotRecordSchema,
  optionOperationBundleSchema,
  type Actor,
  type DesignOption,
  type DesignOptionSet,
  type InteriorAssetRef,
  type ModelSnapshotRecord,
  type OptionJob,
} from "@interior-design/contracts";
import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";
import { canonicalBriefSnapshot } from "@interior-design/design-brief";
import { reduceModelOperations } from "@interior-design/model-operations";
import { randomUUID } from "node:crypto";

import { bundleSha256, setSha256 } from "../../src/modules/design-options/hashes.js";
import { InMemoryDesignOptionRepository } from "../../src/modules/design-options/memory.js";
import { DesignOptionService } from "../../src/modules/design-options/service.js";
import { InMemoryDesignOptionSourceVerifier } from "../../src/modules/design-options/sources.js";
import type {
  CreateOptionJobRequest,
  DesignAssetVerificationPort,
  DesignConstraintDerivationPort,
  DesignOptionClock,
  VerifiedOptionInputs,
} from "../../src/modules/design-options/types.js";
import {
  alphaProjectId,
  alphaTenantId,
  canonicalSnapshotFixture,
  levelId,
  ownerUserId,
  spaceId,
} from "../c4/fixtures.js";

export const tenantId = alphaTenantId;
export const projectId = alphaProjectId;
export const userId = ownerUserId;
export const briefId = "c1200000-0000-4000-8000-000000000004";
export const sourceSnapshotId = "c1200000-0000-4000-8000-000000000005";
export const modelId = "c1200000-0000-4000-8000-000000000006";
export const designElementId = "c1200000-0000-4000-8000-000000000007";
export const constraintId = "c1200000-0000-4000-8000-000000000008";
export const nowIso = "2026-07-18T12:00:00.000Z";
export const assetManifestSha256 = "b".repeat(64);

export const actor: Actor = {
  displayName: "Synthetic C12 owner",
  role: "owner",
  subject: "fixture|c12-owner",
  tenantId,
  userId,
};

export const correlation = {
  requestId: "c12-request-0001",
  spanId: "1".repeat(16),
  traceId: "1".repeat(32),
  traceParent: `00-${"1".repeat(32)}-${"1".repeat(16)}-00`,
};

export class MutableClock implements DesignOptionClock {
  value = new Date(nowIso);

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.value);
  }
}

const sourceCanonical = canonicalizeHomeSnapshot(canonicalSnapshotFixture({ modelId, projectId }));

export const sourceRecord: ModelSnapshotRecord = modelSnapshotRecordSchema.parse({
  canonicalByteLength: sourceCanonical.canonicalByteLength,
  createdAt: nowIso,
  createdBy: userId,
  id: sourceSnapshotId,
  modelId,
  profile: "existing",
  projectId,
  schemaVersion: "c4-canonical-home-v1",
  snapshot: sourceCanonical.snapshot,
  snapshotSha256: sourceCanonical.snapshotSha256,
  version: 1,
});

export const brief = designBriefSchema.parse({
  acceptedAt: nowIso,
  acceptedBy: userId,
  createdAt: nowIso,
  entries: [],
  id: briefId,
  projectId,
  referenceBoard: [],
  revision: 3,
  schemaVersion: "c11-design-brief-v1",
  status: "accepted",
  updatedAt: nowIso,
  updatedBy: userId,
});
export const briefContentSha256 = canonicalBriefSnapshot(brief).contentSha256;

export const request: CreateOptionJobRequest = createOptionJobRequestSchema.parse({
  baseBrief: { briefId, contentSha256: briefContentSha256, revision: 3 },
  requestedDirections: ["circulation-first", "conversation-first"],
  requestedOptionCount: 2,
  sourceModel: {
    modelId,
    profile: "existing",
    snapshotId: sourceSnapshotId,
    snapshotSha256: sourceCanonical.snapshotSha256,
    snapshotVersion: 1,
  },
});

export const constraint = designConstraintSchema.parse({
  assetElementIds: [designElementId],
  id: constraintId,
  kind: "space-containment",
  label: "Keep the synthetic furnishing inside the room boundary",
  schemaVersion: "c12-design-constraint-v1",
  source: {
    briefEntryIds: [],
    kind: "system-geometry-policy",
    modelElementIds: [spaceId],
  },
  spaceId,
  strength: "hard",
});

export const constraintDeriver: DesignConstraintDerivationPort = {
  derive: () => Promise.resolve({ assetManifestSha256, constraints: [constraint] }),
};

export function verifiedInputs(): VerifiedOptionInputs {
  return {
    brief,
    briefReference: request.baseBrief,
    source: sourceRecord,
    sourceReference: request.sourceModel,
  };
}

export function testRuntime(
  clock = new MutableClock(),
  assetVerifier?: DesignAssetVerificationPort,
  derivationPort: DesignConstraintDerivationPort = constraintDeriver,
) {
  const repository = new InMemoryDesignOptionRepository({
    ...(assetVerifier === undefined ? {} : { assetVerifier }),
    clock,
  });
  const sources = new InMemoryDesignOptionSourceVerifier();
  sources.records.set(
    InMemoryDesignOptionSourceVerifier.key(tenantId, projectId, request),
    verifiedInputs(),
  );
  const service = new DesignOptionService({
    constraintDeriver: derivationPort,
    repository,
    sourceVerifier: sources,
  });
  return { clock, repository, service, sources };
}

export async function createJob(runtime = testRuntime(), idempotencyKey = randomUUID()) {
  const result = await runtime.service.createJob({
    actor,
    correlation,
    idempotencyKey,
    projectId,
    request,
  });
  return { ...runtime, createResult: result, idempotencyKey, job: result.job };
}

function attribution(claimId: string) {
  return {
    actorUserId: userId,
    claimId,
    evidenceIds: [],
    method: { kind: "fixture" as const, name: "Synthetic C12 fixture", version: "1" },
    state: "user-asserted" as const,
    verification: { status: "not-reviewed" as const },
  };
}

function known<T>(claimId: string, value: T) {
  return { attribution: attribution(claimId), knowledge: "known" as const, value };
}

function asset(index: number): InteriorAssetRef {
  return interiorAssetRefSchema.parse({
    category: index === 0 ? "synthetic-chair" : "synthetic-sofa",
    contentSha256: index === 0 ? "c".repeat(64) : "d".repeat(64),
    geometryEnvelopeMm: {
      depthMm: index === 0 ? 700 : 850,
      heightMm: 800,
      widthMm: index === 0 ? 700 : 1_700,
    },
    id:
      index === 0 ? "c1200000-0000-4000-8000-000000000011" : "c1200000-0000-4000-8000-000000000012",
    kind: "furnishing",
    materialLabel: index === 0 ? "synthetic blue textile" : "synthetic ochre textile",
    metadataSha256: index === 0 ? "e".repeat(64) : "f".repeat(64),
    placementPolicy: {
      allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
      clearanceMm: { back: 50, front: 600, left: 50, right: 50 },
      forwardAxis: "positive-y",
      origin: "bounding-box-centre-floor",
      policySha256: index === 0 ? "1".repeat(64) : "2".repeat(64),
    },
    representationStatus: "bounded-proxy",
    rights: {
      attributionRequired: false,
      derivativesAllowed: true,
      licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      redistributionAllowed: false,
      rightsRecordSha256: index === 0 ? "3".repeat(64) : "4".repeat(64),
      serviceProcessingAllowed: true,
      sourceKind: "creator-owned-synthetic",
      trainingAllowed: false,
      usage: "service-and-derived-designs",
    },
    schemaVersion: "c12-interior-asset-ref-v1",
    version: "1.0.0",
    versionId:
      index === 0 ? "c1200000-0000-4000-8000-000000000013" : "c1200000-0000-4000-8000-000000000014",
  });
}

function option(
  job: OptionJob,
  index: number,
  workingSnapshot: typeof sourceRecord.snapshot,
): DesignOption {
  const selectedAsset = asset(index);
  const operation = {
    assetBinding: {
      assetId: selectedAsset.id,
      assetVersionId: selectedAsset.versionId,
      contentSha256: selectedAsset.contentSha256,
      metadataSha256: selectedAsset.metadataSha256,
      placementPolicySha256: selectedAsset.placementPolicy.policySha256,
      rightsRecordSha256: selectedAsset.rights.rightsRecordSha256,
    },
    clientOperationId:
      index === 0 ? "c1200000-0000-4000-8000-000000000021" : "c1200000-0000-4000-8000-000000000022",
    element: {
      category: known("c1200000-0000-4000-8000-000000000031", selectedAsset.category),
      dimensions: known("c1200000-0000-4000-8000-000000000032", selectedAsset.geometryEnvelopeMm),
      elementType: "furnishing" as const,
      id: designElementId,
      levelId,
      name: known(
        "c1200000-0000-4000-8000-000000000033",
        index === 0 ? "Synthetic blue chair" : "Synthetic ochre sofa",
      ),
      origin: attribution("c1200000-0000-4000-8000-000000000034"),
      placement: {
        position: known("c1200000-0000-4000-8000-000000000035", {
          xMm: index === 0 ? 800 : 2_400,
          yMm: 1_200,
          zMm: 0,
        }),
        rotationMilliDegrees: known("c1200000-0000-4000-8000-000000000036", 0),
      },
    },
    reason: "Create one exact creator-owned synthetic furnishing proposal.",
    schemaVersion: "c12-design-element-operation-v1" as const,
    type: "design.element.create.v1" as const,
  };
  const candidate = reduceModelOperations(workingSnapshot, [operation]);
  const body = {
    assetPlacements: [{ asset: selectedAsset, elementId: designElementId, spaceId }],
    baseModel: job.workingModel,
    candidateSnapshotSha256: candidate.snapshotSha256,
    constraintResults: [
      {
        constraintId,
        detail: "The exact synthetic furnishing footprint is retained inside the room.",
        passed: true,
        strength: "hard" as const,
      },
    ],
    id:
      index === 0 ? "c1200000-0000-4000-8000-000000000041" : "c1200000-0000-4000-8000-000000000042",
    operations: [operation],
    projectId: job.projectId,
    schemaVersion: "c12-operation-bundle-v1" as const,
  };
  const bundle = optionOperationBundleSchema.parse({ ...body, bundleSha256: bundleSha256(body) });
  const createdAt = new Date(Date.parse(job.updatedAt) + 1).toISOString();
  return designOptionSchema.parse({
    assumptions: ["Synthetic fixture dimensions are computational inputs, not surveyed truth."],
    baseBrief: job.baseBrief,
    createdAt,
    direction: index === 0 ? "circulation-first" : "conversation-first",
    expiresAt: new Date(Date.parse(createdAt) + 3_600_000).toISOString(),
    id:
      index === 0 ? "c1200000-0000-4000-8000-000000000051" : "c1200000-0000-4000-8000-000000000052",
    jobId: job.id,
    objectives: [
      {
        basisPoints: index === 0 ? 8_500 : 8_200,
        id: index === 0 ? "circulation" : "conversation",
        rationale: "Integer synthetic objective score for deterministic option comparison.",
      },
    ],
    operationBundle: bundle,
    paretoNonDominated: true,
    professionalReview: [],
    projectId: job.projectId,
    providerManifest: {
      adapter: "deterministic-local-design-v1",
      candidateBudget: 100,
      engineVersion: "fixture-1",
      externalNetworkUsed: false,
      seed: index + 1,
    },
    schemaVersion: "c12-design-option-v1",
    status: "pending",
    summary: "A deterministic synthetic option with exact integer placement.",
    title: index === 0 ? "Clear synthetic route" : "Synthetic conversation focus",
    tradeoffs: ["This is a computational option, not professional approval."],
    unknowns: ["Physical comfort and live product availability are not measured."],
  });
}

export function publication(
  job: OptionJob,
  workingSnapshot: typeof sourceRecord.snapshot,
): { readonly optionSet: DesignOptionSet; readonly options: readonly DesignOption[] } {
  const options = [option(job, 0, workingSnapshot), option(job, 1, workingSnapshot)];
  const left = options[0];
  const right = options[1];
  if (left === undefined || right === undefined)
    throw new Error("C12 fixture options are missing.");
  const body = {
    createdAt: left.createdAt,
    jobId: job.id,
    optionIds: options.map(({ id }) => id),
    pairwiseDiversity: [
      {
        assetInventoryDistanceBasisPoints: 10_000,
        assignmentDistanceBasisPoints: 10_000,
        leftOptionId: left.id,
        materialDistanceBasisPoints: 10_000,
        operationSignatureDistanceBasisPoints: 8_000,
        placementDistanceMm: 1_600,
        rightOptionId: right.id,
        spatiallyOrMateriallyDistinct: true as const,
      },
    ],
    projectId: job.projectId,
    schemaVersion: "c12-design-option-set-v1" as const,
  };
  return {
    optionSet: designOptionSetSchema.parse({ ...body, setSha256: setSha256(body) }),
    options,
  };
}
