import {
  createFusionJobRequestSchema,
  fusionDiscrepancyDecisionSchema,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  modelBranchSchema,
  modelSnapshotRecordSchema,
  type FusionJob,
  type FusionProposal,
} from "@interior-design/contracts";
import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";
import { randomUUID } from "node:crypto";

import { fusionConflict, fusionInvalid } from "../../src/modules/model-fusion/errors.js";
import type {
  AcknowledgeFusionCancellationCommand,
  AdvanceFusionAttemptCommand,
  ClaimFusionAttemptCommand,
  CreateFusionJobCommand,
  CreateFusionOperationDraftCommand,
  FailFusionAttemptCommand,
  FusionBaseVerifier,
  FusionDiscrepancyDecision,
  FusionRepository,
  FusionSourceVerifier,
  PublishFusionProposalCommand,
  ReviewFusionDiscrepanciesCommand,
  TransitionFusionJobCommand,
  VerifiedFusionSource,
  WithdrawFusionSourceCommand,
} from "../../src/modules/model-fusion/types.js";
import {
  alphaProjectId,
  alphaTenantId,
  canonicalSnapshotFixture,
  existingModelId,
  ownerUserId,
  spaceId,
} from "../c4/fixtures.js";
import { c6Now } from "../c6/support.js";

export const c9SnapshotId = "99000000-0000-4000-8000-000000000001";
export const c9SnapshotSha256 = "1".repeat(64);
export const planSourceId = "99000000-0000-4000-8000-000000000011";
export const roomplanSourceId = "99000000-0000-4000-8000-000000000012";
export const reconstructionSourceId = "99000000-0000-4000-8000-000000000013";
export const branchId = "99000000-0000-4000-8000-000000000021";
export const discrepancyId = "99000000-0000-4000-8000-000000000031";

const snapshot = canonicalSnapshotFixture();

export const baseRecord = modelSnapshotRecordSchema.parse({
  canonicalByteLength: 2_048,
  createdAt: c6Now,
  createdBy: ownerUserId,
  id: c9SnapshotId,
  modelId: existingModelId,
  profile: "existing",
  projectId: alphaProjectId,
  schemaVersion: "c4-canonical-home-v1",
  snapshot,
  snapshotSha256: c9SnapshotSha256,
  version: 1,
});

export const sources = [
  {
    coordinateFrame: "source-local-arbitrary" as const,
    elementCount: 8,
    evidenceState: "source-derived" as const,
    id: planSourceId,
    kind: "plan-proposal" as const,
    referenceId: planSourceId,
    rights: { serviceProcessingConsent: true as const, trainingUseConsent: "denied" as const },
    scaleStatus: "unknown" as const,
    schemaVersion: "c6-plan-proposal-v1",
    sha256: "2".repeat(64),
  },
  {
    coordinateFrame: "source-local-metric" as const,
    elementCount: 12,
    evidenceState: "source-derived" as const,
    id: roomplanSourceId,
    kind: "roomplan-proposal" as const,
    referenceId: roomplanSourceId,
    rights: { serviceProcessingConsent: true as const, trainingUseConsent: "denied" as const },
    scaleStatus: "metric-estimated" as const,
    schemaVersion: "c7-capture-proposal-v1",
    sha256: "3".repeat(64),
  },
];

function requiredPrimarySource(): (typeof sources)[number] {
  const source = sources[0];
  if (!source) throw new Error("Synthetic C9 primary source is missing.");
  return source;
}

const primarySource = requiredPrimarySource();

export const fusionRequest = createFusionJobRequestSchema.parse({
  anchorGroups: [],
  baseSnapshot: {
    modelId: existingModelId,
    profile: "existing",
    snapshotId: c9SnapshotId,
    snapshotSha256: c9SnapshotSha256,
  },
  inferencePolicy: "label-and-expose",
  label: "Visibly synthetic whole-home fusion",
  sources,
});

export function verifiedSource(
  source: (typeof sources)[number] = primarySource,
  overrides: Partial<VerifiedFusionSource> = {},
): VerifiedFusionSource {
  return {
    elementCount: source.elementCount,
    evidenceState: source.evidenceState,
    kind: source.kind,
    projectId: alphaProjectId,
    referenceId: source.referenceId,
    rightsActive: true,
    schemaVersion: source.schemaVersion,
    sha256: source.sha256,
    tenantId: alphaTenantId,
    ...overrides,
  };
}

export class MemoryFusionVerification implements FusionSourceVerifier, FusionBaseVerifier {
  baseAvailable = true;
  readonly verified = new Map(sources.map((source) => [source.id, verifiedSource(source)]));

  findExact(tenantId: string, projectId: string) {
    return Promise.resolve(
      this.baseAvailable && tenantId === alphaTenantId && projectId === alphaProjectId
        ? baseRecord
        : undefined,
    );
  }

  verify(tenantId: string, projectId: string, source: (typeof sources)[number]) {
    const verified = this.verified.get(source.id);
    return Promise.resolve(
      verified?.tenantId === tenantId && verified.projectId === projectId ? verified : undefined,
    );
  }
}

function timestamp(version: number): string {
  return new Date(Date.parse(c6Now) + version).toISOString();
}

export const branch = modelBranchSchema.parse({
  createdAt: c6Now,
  createdBy: ownerUserId,
  headSnapshotId: c9SnapshotId,
  headSnapshotSha256: c9SnapshotSha256,
  id: branchId,
  modelId: existingModelId,
  name: "Synthetic existing branch",
  profile: "existing",
  projectId: alphaProjectId,
  revision: 0,
  schemaVersion: "c5-model-branch-v1",
  sourceSnapshotId: c9SnapshotId,
  updatedAt: c6Now,
});

export function fullProposal(job: FusionJob, sourceManifestSha256: string): FusionProposal {
  const space = snapshot.elements.spaces[0];
  if (!space) throw new Error("Synthetic C9 space is missing.");
  const operation = {
    clientOperationId: "99000000-0000-4000-8000-000000000041",
    name: { ...space.name, value: "Synthetic reconciled room" },
    reason: "Apply an explicitly reviewed source reconciliation.",
    schemaVersion: "c5-model-operation-v1" as const,
    spaceId,
    type: "space.rename.v1" as const,
  };
  return fusionProposalSchema.parse({
    authority: "proposal-only",
    baseSnapshot: job.request.baseSnapshot,
    candidateSnapshot: snapshot,
    candidateSnapshotSha256: canonicalizeHomeSnapshot(snapshot).snapshotSha256,
    coverage: {
      inputSourceCount: 2,
      levelsCovered: 1,
      registeredSourceCount: 1,
      unknownRegionCount: 1,
    },
    createdAt: c6Now,
    discrepancies: [
      {
        affectedElementIds: [spaceId],
        code: "FUSION_SPACE_NAME_CONFLICT",
        id: discrepancyId,
        kind: "classification",
        message: "Two immutable sources disagree about the synthetic room label.",
        requiresHumanDecision: true,
        schemaVersion: "c9-discrepancy-v1",
        severity: "warning",
        sourceClaims: [
          {
            confidenceBasisPoints: 8_000,
            elementId: spaceId,
            sourceId: planSourceId,
            state: "source-derived",
            valueSha256: "4".repeat(64),
          },
          {
            confidenceBasisPoints: 7_500,
            elementId: spaceId,
            sourceId: roomplanSourceId,
            state: "source-derived",
            valueSha256: "5".repeat(64),
          },
        ],
        suggestedOperations: [operation],
      },
    ],
    id: "99000000-0000-4000-8000-000000000051",
    projectId: alphaProjectId,
    registrations: [
      {
        confidenceBasisPoints: 8_000,
        connectedComponentId: "99000000-0000-4000-8000-000000000061",
        findings: [],
        method: "semantic-overlap",
        residuals: { inlierCount: 6, maximumMm: 90, medianMm: 20, p90Mm: 60, sampleCount: 8 },
        scaleStatus: "unknown",
        schemaVersion: "c9-registration-result-v1",
        sourceId: planSourceId,
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
            detail: "The synthetic RoomPlan source had no defensible transform.",
            severity: "warning",
          },
        ],
        schemaVersion: "c9-registration-result-v1",
        sourceId: roomplanSourceId,
        status: "unregistered",
      },
    ],
    schemaVersion: "c9-full-house-proposal-v1",
    sourceManifestSha256,
    status: "partial-proposal",
    version: 1,
  });
}

export class MemoryFusionRepository implements FusionRepository {
  readonly jobs = new Map<string, FusionJob>();
  readonly proposals = new Map<string, FusionProposal>();
  readonly idempotency = new Map<string, { readonly body: string; readonly job: FusionJob }>();
  readonly decisions = new Map<string, FusionDiscrepancyDecision>();
  lastCreate?: CreateFusionJobCommand;

  createJob(command: CreateFusionJobCommand) {
    this.lastCreate = command;
    const key = `${command.actor.tenantId}:${command.idempotencyKey}`;
    const body = JSON.stringify({ projectId: command.projectId, request: command.request });
    const existing = this.idempotency.get(key);
    if (existing) {
      if (existing.body !== body) throw fusionConflict("IDEMPOTENCY_CONFLICT", "Key reused.");
      return Promise.resolve({ job: existing.job, replayed: true });
    }
    const job = fusionJobSchema.parse({
      attempt: 1,
      createdAt: c6Now,
      createdBy: command.actor.userId,
      id: randomUUID(),
      projectId: command.projectId,
      request: command.request,
      state: "queued",
      updatedAt: c6Now,
      version: 1,
    });
    this.jobs.set(job.id, job);
    this.idempotency.set(key, { body, job });
    return Promise.resolve({ job, replayed: false });
  }

  listJobs(tenantId: string, projectId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId ? [...this.jobs.values()] : [],
    );
  }

  findJob(tenantId: string, projectId: string, fusionJobId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId
        ? this.jobs.get(fusionJobId)
        : undefined,
    );
  }

  findProposal(tenantId: string, projectId: string, fusionJobId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId
        ? this.proposals.get(fusionJobId)
        : undefined,
    );
  }

  cancelJob(command: TransitionFusionJobCommand) {
    const current = this.#current(command);
    if (current.version !== command.expectedVersion) {
      throw fusionConflict("FUSION_JOB_VERSION_CONFLICT", "Reload the exact job version.");
    }
    const job = fusionJobSchema.parse({
      ...current,
      state: "cancelled",
      updatedAt: timestamp(current.version + 1),
      version: current.version + 1,
    });
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, replayed: false });
  }

  retryJob(command: TransitionFusionJobCommand) {
    const current = this.#current(command);
    if (
      current.version !== command.expectedVersion ||
      !["cancelled", "failed", "abstained"].includes(current.state)
    ) {
      throw fusionConflict("FUSION_JOB_NOT_RETRYABLE", "Reload the exact terminal job.");
    }
    const job = fusionJobSchema.parse({
      ...current,
      attempt: current.attempt + 1,
      proposalId: undefined,
      safeCode: undefined,
      state: "queued",
      updatedAt: timestamp(current.version + 1),
      version: current.version + 1,
    });
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, replayed: false });
  }

  reviewDiscrepancies(command: ReviewFusionDiscrepanciesCommand) {
    const proposal = this.proposals.get(command.fusionJobId);
    if (!proposal || proposal.version !== command.request.expectedProposalVersion) {
      throw fusionConflict("FUSION_PROPOSAL_VERSION_CONFLICT", "Reload the exact proposal.");
    }
    const nextVersion = proposal.version + 1;
    const decisions = command.request.decisions.map((input) =>
      fusionDiscrepancyDecisionSchema.parse({
        choice: input.choice,
        decidedAt: timestamp(nextVersion),
        decidedBy: command.actor.userId,
        discrepancyId: input.discrepancyId,
        id: randomUUID(),
        proposalId: proposal.id,
        reason: input.reason,
        version: nextVersion,
      }),
    );
    for (const decision of decisions) this.decisions.set(decision.id, decision);
    const updated = fusionProposalSchema.parse({ ...proposal, version: nextVersion });
    this.proposals.set(command.fusionJobId, updated);
    return Promise.resolve({ decisions, proposal: updated, replayed: false });
  }

  createOperationDraft(command: CreateFusionOperationDraftCommand) {
    const proposal = this.proposals.get(command.fusionJobId);
    if (!proposal || proposal.status === "abstained")
      throw fusionConflict("FUSION_PROPOSAL_UNAVAILABLE", "No proposal.");
    if (proposal.version !== command.request.expectedProposalVersion)
      throw fusionConflict("FUSION_PROPOSAL_VERSION_CONFLICT", "Reload proposal.");
    if (
      command.request.branchId !== branch.id ||
      command.request.expectedBranchRevision !== branch.revision ||
      command.request.expectedHeadSnapshotSha256 !== branch.headSnapshotSha256
    )
      throw fusionConflict("FUSION_BRANCH_HEAD_CONFLICT", "Reload branch.");
    const selected = command.request.decisionIds.map((id) => this.decisions.get(id));
    if (selected.some((decision) => decision === undefined))
      throw fusionInvalid("FUSION_DECISION_MISMATCH", "Decision absent.");
    const operations = proposal.discrepancies.flatMap(
      ({ suggestedOperations }) => suggestedOperations,
    );
    const draft = fusionOperationDraftSchema.parse({
      baseSnapshot: proposal.baseSnapshot,
      branchId: branch.id,
      decisionIds: command.request.decisionIds,
      expectedBranchRevision: branch.revision,
      expectedHeadSnapshotSha256: branch.headSnapshotSha256,
      operations,
      projectId: command.projectId,
      proposalId: proposal.id,
      schemaVersion: "c9-operation-draft-v1",
    });
    return Promise.resolve({ draft, replayed: false });
  }

  findBranch(tenantId: string, projectId: string, requestedBranchId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId && requestedBranchId === branch.id
        ? branch
        : undefined,
    );
  }

  claimNext(command: ClaimFusionAttemptCommand) {
    void command;
    return Promise.resolve(undefined);
  }

  advanceAttempt(command: AdvanceFusionAttemptCommand) {
    void command;
    return Promise.reject(new Error("Worker transitions use the Postgres-gated suite."));
  }

  publishProposal(command: PublishFusionProposalCommand) {
    void command;
    return Promise.reject(new Error("Worker publication uses the Postgres-gated suite."));
  }

  failAttempt(command: FailFusionAttemptCommand) {
    void command;
    return Promise.reject(new Error("Worker failures use the Postgres-gated suite."));
  }

  acknowledgeCancellation(command: AcknowledgeFusionCancellationCommand) {
    void command;
    return Promise.resolve();
  }

  withdrawSource(command: WithdrawFusionSourceCommand) {
    void command;
    return Promise.resolve(0);
  }

  #current(command: TransitionFusionJobCommand): FusionJob {
    const current = this.jobs.get(command.fusionJobId);
    if (!current) throw fusionConflict("FUSION_JOB_NOT_FOUND", "Job absent.");
    return current;
  }
}

export function publishSyntheticProposal(
  repository: MemoryFusionRepository,
  job: FusionJob,
): FusionProposal {
  const manifest = repository.lastCreate?.sourceManifestSha256 ?? "6".repeat(64);
  const proposal = fullProposal(job, manifest);
  repository.proposals.set(job.id, proposal);
  repository.jobs.set(
    job.id,
    fusionJobSchema.parse({
      ...job,
      proposalId: proposal.id,
      state: "proposed",
      updatedAt: timestamp(job.version + 1),
      version: job.version + 1,
    }),
  );
  return proposal;
}
