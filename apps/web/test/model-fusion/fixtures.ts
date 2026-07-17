import {
  createFusionJobRequestSchema,
  fusionDiscrepancyDecisionSchema,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  type Project,
  type Session,
} from "@interior-design/contracts";

import { branch, snapshot, snapshotRecord, uuid } from "../editor-2d/fixtures";
import { job as planJobFixture, proposal as planProposalFixture } from "../plan-import/fixtures";
import {
  job as reconstructionJobFixture,
  partialResult as reconstructionResultFixture,
} from "../reconstruction/fixtures";

export const project: Project = {
  createdAt: "2026-07-17T12:00:00.000Z",
  id: snapshot.projectId,
  name: "Synthetic model fusion project",
  status: "draft",
  tenantId: uuid(2),
  updatedAt: "2026-07-17T12:00:00.000Z",
  version: 1,
};

export const session: Session = {
  actor: {
    displayName: "Synthetic C9 owner",
    role: "owner",
    subject: "fixture:c9-owner",
    tenantId: project.tenantId,
    userId: uuid(1),
  },
  authMode: "local-fixture",
  expiresAt: "2099-07-18T12:00:00.000Z",
};

export const planJob = {
  ...planJobFixture,
  id: uuid(70),
  projectId: project.id,
  resultId: uuid(71),
};

export const planProposal = {
  ...planProposalFixture,
  jobId: planJob.id,
  projectId: project.id,
  proposalId: planJob.resultId,
};

export const reconstructionJob = {
  ...reconstructionJobFixture,
  id: uuid(72),
  projectId: project.id,
  resultId: uuid(73),
  state: "completed" as const,
  version: 2,
};

export const reconstructionResult = {
  ...reconstructionResultFixture,
  jobId: reconstructionJob.id,
  projectId: project.id,
  resultId: reconstructionJob.resultId,
};

if (reconstructionResult.status !== "completed") {
  throw new Error("Synthetic reconstruction result must be completed.");
}

export const fusionSources = [
  {
    coordinateFrame: "source-local-arbitrary" as const,
    elementCount: planProposal.candidates.length,
    evidenceState: "source-derived" as const,
    id: planProposal.proposalId,
    kind: "plan-proposal" as const,
    referenceId: planProposal.proposalId,
    rights: { serviceProcessingConsent: true as const, trainingUseConsent: "denied" as const },
    scaleStatus: "unknown" as const,
    schemaVersion: "c6-plan-proposal-v1",
    sha256: "6".repeat(64),
  },
  {
    coordinateFrame: "source-local-arbitrary" as const,
    elementCount: reconstructionResult.geometry.registeredFrameCount,
    evidenceState: "source-derived" as const,
    id: reconstructionResult.resultId,
    kind: "reconstruction-result" as const,
    referenceId: reconstructionResult.resultId,
    rights: { serviceProcessingConsent: true as const, trainingUseConsent: "denied" as const },
    scaleStatus: "unknown" as const,
    schemaVersion: "c8-reconstruction-result-v1",
    sha256: "7".repeat(64),
  },
];

export const fusionRequest = createFusionJobRequestSchema.parse({
  anchorGroups: [],
  baseSnapshot: {
    modelId: snapshotRecord.modelId,
    profile: "existing",
    snapshotId: snapshotRecord.id,
    snapshotSha256: snapshotRecord.snapshotSha256,
  },
  inferencePolicy: "label-and-expose",
  label: "Synthetic full-house fusion",
  sources: fusionSources,
});

export const job = fusionJobSchema.parse({
  attempt: 1,
  createdAt: "2026-07-17T12:10:00.000Z",
  createdBy: session.actor.userId,
  id: uuid(80),
  projectId: project.id,
  request: fusionRequest,
  state: "queued",
  updatedAt: "2026-07-17T12:10:00.000Z",
  version: 1,
});

const discrepancyId = uuid(81);

export const proposal = fusionProposalSchema.parse({
  authority: "proposal-only",
  baseSnapshot: fusionRequest.baseSnapshot,
  candidateSnapshot: snapshot,
  candidateSnapshotSha256: "8".repeat(64),
  coverage: {
    inputSourceCount: 2,
    levelsCovered: 1,
    registeredSourceCount: 1,
    unknownRegionCount: 1,
  },
  createdAt: "2026-07-17T12:12:00.000Z",
  discrepancies: [
    {
      affectedElementIds: [snapshot.elements.walls[0]?.id],
      code: "FUSION_WALL_POSITION_CONFLICT",
      id: discrepancyId,
      kind: "position",
      magnitudeMm: 85,
      message: "Plan and reconstruction claims differ by 85 mm at the synthetic wall.",
      requiresHumanDecision: true,
      schemaVersion: "c9-discrepancy-v1",
      severity: "warning",
      sourceClaims: [
        {
          confidenceBasisPoints: 8_400,
          elementId: snapshot.elements.walls[0]?.id,
          sourceId: fusionSources[0]?.id,
          state: "source-derived",
          valueSha256: "9".repeat(64),
        },
        {
          elementId: snapshot.elements.walls[0]?.id,
          sourceId: fusionSources[1]?.id,
          state: "inferred",
          valueSha256: "a".repeat(64),
        },
      ],
      suggestedOperations: [],
    },
  ],
  id: uuid(82),
  projectId: project.id,
  registrations: [
    {
      confidenceBasisPoints: 8_400,
      connectedComponentId: uuid(83),
      findings: [],
      method: "semantic-overlap",
      residuals: { inlierCount: 8, maximumMm: 120, medianMm: 28, p90Mm: 85, sampleCount: 10 },
      scaleStatus: "unknown",
      schemaVersion: "c9-registration-result-v1",
      sourceId: fusionSources[0]?.id,
      status: "partial",
      transform: {
        rotationQuaternionE9: { w: 1_000_000_000, x: 0, y: 0, z: 0 },
        scalePartsPerMillion: 1_000_000,
        translationMm: { xMm: 0, yMm: 0, zMm: 0 },
      },
    },
    {
      findings: [
        {
          code: "FUSION_SOURCE_DISCONNECTED",
          detail: "No defensible shared transform was available.",
          severity: "warning",
        },
      ],
      schemaVersion: "c9-registration-result-v1",
      sourceId: fusionSources[1]?.id,
      status: "unregistered",
    },
  ],
  schemaVersion: "c9-full-house-proposal-v1",
  sourceManifestSha256: "b".repeat(64),
  status: "partial-proposal",
  version: 1,
});

export const decision = fusionDiscrepancyDecisionSchema.parse({
  choice: "mark-unknown",
  decidedAt: "2026-07-17T12:14:00.000Z",
  decidedBy: session.actor.userId,
  discrepancyId,
  id: uuid(84),
  proposalId: proposal.id,
  reason: "The source claims remain too far apart for dimensional authority.",
  version: 2,
});

const wall = snapshot.elements.walls[0];
if (!wall || wall.path.knowledge !== "known") throw new Error("Synthetic wall path is missing.");

export const draft = fusionOperationDraftSchema.parse({
  baseSnapshot: proposal.baseSnapshot,
  branchId: branch.id,
  decisionIds: [decision.id],
  expectedBranchRevision: branch.revision,
  expectedHeadSnapshotSha256: branch.headSnapshotSha256,
  operations: [
    {
      clientOperationId: uuid(85),
      pathAttribution: wall.path.attribution,
      reason: "Apply the reviewed synthetic positional correction.",
      schemaVersion: "c5-model-operation-v1",
      translation: { xMm: 85, yMm: 0 },
      type: "wall.translate.v1",
      wallId: wall.id,
    },
  ],
  projectId: project.id,
  proposalId: proposal.id,
  schemaVersion: "c9-operation-draft-v1",
});

export const workspace = {
  baseSnapshot: snapshotRecord,
  branches: [branch],
  capabilities: {
    geometryProducer: "unavailable" as const,
    semanticProducer: "unavailable" as const,
  },
  jobs: [job],
  project,
  session,
  sources: fusionSources.map((source, index) => ({
    label: index === 0 ? "Plan proposal" : "Reconstruction result",
    source,
    sourceStatus: "eligible" as const,
  })),
};

export { branch, discrepancyId, snapshotRecord };
