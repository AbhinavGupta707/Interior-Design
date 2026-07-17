import type {
  ActorScope,
  ExpectedReferenceBundle,
  FusionResource,
  LeaseClaim,
} from "./reference-boundary.js";

export const ids = Object.freeze({
  baseSnapshotId: "c9000000-0000-4000-8000-000000000101",
  branchId: "c9000000-0000-4000-8000-000000000102",
  decisionId: "c9000000-0000-4000-8000-000000000103",
  jobId: "c9000000-0000-4000-8000-000000000104",
  modelId: "c9000000-0000-4000-8000-000000000105",
  operationId: "c9000000-0000-4000-8000-000000000106",
  projectId: "c9000000-0000-4000-8000-000000000107",
  proposalId: "c9000000-0000-4000-8000-000000000108",
  referenceA: "c9000000-0000-4000-8000-000000000109",
  referenceB: "c9000000-0000-4000-8000-000000000110",
  sourceA: "c9000000-0000-4000-8000-000000000111",
  sourceB: "c9000000-0000-4000-8000-000000000112",
  tenantId: "c9000000-0000-4000-8000-000000000113",
});

export const owner = Object.freeze({
  projectId: ids.projectId,
  role: "owner",
  tenantId: ids.tenantId,
} satisfies ActorScope);

export const resource = Object.freeze({
  attempt: 1,
  cancelled: false,
  jobId: ids.jobId,
  projectId: ids.projectId,
  proposalVersion: 0,
  rightsActive: true,
  state: "registering",
  tenantId: ids.tenantId,
  version: 4,
} satisfies FusionResource);

export const references = Object.freeze({
  baseSnapshotId: ids.baseSnapshotId,
  baseSnapshotSha256: "a".repeat(64),
  modelId: ids.modelId,
  projectId: ids.projectId,
  sources: [
    {
      modelId: ids.modelId,
      projectId: ids.projectId,
      referenceId: ids.referenceA,
      referenceSha256: "b".repeat(64),
      sourceId: ids.sourceA,
    },
    {
      modelId: ids.modelId,
      projectId: ids.projectId,
      referenceId: ids.referenceB,
      referenceSha256: "c".repeat(64),
      sourceId: ids.sourceB,
    },
  ],
  tenantId: ids.tenantId,
} satisfies ExpectedReferenceBundle);

export const validReferenceEnvelope = Object.freeze(structuredClone(references));

export const validFusionRequest = Object.freeze({
  anchorGroups: [
    {
      anchors: [
        {
          projectPoint: { xMm: 0, yMm: 0, zMm: 0 },
          sourcePoint: { xMm: 100, yMm: 200, zMm: 0 },
        },
        {
          projectPoint: { xMm: 1_000, yMm: 0, zMm: 0 },
          sourcePoint: { xMm: 1_100, yMm: 200, zMm: 0 },
        },
        {
          projectPoint: { xMm: 0, yMm: 1_000, zMm: 0 },
          sourcePoint: { xMm: 100, yMm: 1_200, zMm: 0 },
        },
      ],
      sourceId: ids.sourceA,
    },
  ],
  inferencePolicy: "label-and-expose",
  sources: [
    {
      elementCount: 20,
      id: ids.sourceA,
      kind: "plan-proposal",
      referenceId: ids.referenceA,
      rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
      sha256: "b".repeat(64),
    },
    {
      elementCount: 40,
      id: ids.sourceB,
      kind: "roomplan-proposal",
      referenceId: ids.referenceB,
      rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
      sha256: "c".repeat(64),
    },
  ],
});

export const validDraft = Object.freeze({
  baseSnapshot: {
    modelId: ids.modelId,
    profile: "existing",
    snapshotId: ids.baseSnapshotId,
    snapshotSha256: "a".repeat(64),
  },
  branchId: ids.branchId,
  decisionIds: [ids.decisionId],
  expectedBranchRevision: 7,
  expectedHeadSnapshotSha256: "d".repeat(64),
  operations: [
    {
      kind: "move-wall-v1",
      operationId: ids.operationId,
      parameters: { deltaMillimetres: 25, wallId: "synthetic-wall-1" },
    },
  ],
  projectId: ids.projectId,
  proposalId: ids.proposalId,
  schemaVersion: "c9-operation-draft-v1",
});

export function leaseClaim(
  leased: FusionResource,
  leaseToken = "synthetic-lease-token",
): LeaseClaim {
  const lease = leased.lease;
  if (lease === undefined) throw new Error("Synthetic resource has no lease.");
  return {
    attempt: leased.attempt,
    epoch: lease.epoch,
    jobId: leased.jobId,
    leaseToken,
    projectId: leased.projectId,
    tenantId: leased.tenantId,
    version: leased.version,
  };
}
