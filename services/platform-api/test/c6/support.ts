import {
  modelBranchSchema,
  planCalibrationSchema,
  planOperationDraftSchema,
  planProcessingJobSchema,
  projectSchema,
  type Actor,
  type LocalPersona,
  type PlanCalibration,
  type PlanOperationDraft,
  type PlanParserResult,
  type PlanProcessingJob,
  type Project,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";

import { LocalFixtureTokenProvider } from "../../src/modules/identity/jwt.js";
import { IdentityService } from "../../src/modules/identity/service.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";
import type {
  BranchTarget,
  CreateCalibrationCommand,
  CreateOperationDraftCommand,
  CreatePlanJobCommand,
  EligiblePlanSource,
  PlanProcessingRepository,
  TransitionPlanJobCommand,
} from "../../src/modules/plan-processing/types.js";
import type {
  CreateProjectCommand,
  ProjectRepository,
} from "../../src/modules/projects/repository.js";
import {
  alphaProjectId,
  alphaTenantId,
  betaTenantId,
  editorUserId,
  existingModelId,
  ownerUserId,
  viewerUserId,
} from "../c4/fixtures.js";

export const c6Now = "2026-07-17T12:00:00.000Z";
export const planAssetId = "86000000-0000-4000-8000-000000000001";
export const planSourceSha256 = "a".repeat(64);
export const c6SessionSecret = "c6-route-session-secret-with-at-least-thirty-two-bytes";

export const actors: Record<string, Actor> = {
  "fixture|editor-alpha": {
    displayName: "Synthetic editor",
    role: "editor",
    subject: "fixture|editor-alpha",
    tenantId: alphaTenantId,
    userId: editorUserId,
  },
  "fixture|owner-alpha": {
    displayName: "Synthetic owner",
    role: "owner",
    subject: "fixture|owner-alpha",
    tenantId: alphaTenantId,
    userId: ownerUserId,
  },
  "fixture|viewer-alpha": {
    displayName: "Synthetic viewer",
    role: "viewer",
    subject: "fixture|viewer-alpha",
    tenantId: alphaTenantId,
    userId: viewerUserId,
  },
  "fixture|owner-beta": {
    displayName: "Synthetic foreign owner",
    role: "owner",
    subject: "fixture|owner-beta",
    tenantId: betaTenantId,
    userId: "20000000-0000-4000-8000-000000000004",
  },
};

class FixtureIdentityStore implements IdentityStore {
  findFixtureActor(persona: LocalPersona): Promise<Actor | undefined> {
    void persona;
    return Promise.resolve(undefined);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    const actor = actors[subject];
    return Promise.resolve(actor?.tenantId === tenantId ? actor : undefined);
  }
}

export function fixtureIdentity(): IdentityService {
  return new IdentityService(
    "test",
    new FixtureIdentityStore(),
    new LocalFixtureTokenProvider(c6SessionSecret),
  );
}

export function tokenFor(subject: keyof typeof actors): string {
  return new LocalFixtureTokenProvider(c6SessionSecret).issueLocal({
    subject,
    tenantId: actors[subject]?.tenantId ?? alphaTenantId,
  }).accessToken;
}

export const c6Project = projectSchema.parse({
  createdAt: c6Now,
  id: alphaProjectId,
  name: "Synthetic C6 project",
  status: "draft",
  tenantId: alphaTenantId,
  updatedAt: c6Now,
  version: 1,
});

export class FixtureProjectRepository implements ProjectRepository {
  create(command: CreateProjectCommand): Promise<Project> {
    void command;
    return Promise.reject(new Error("Project creation is outside the C6 route fixture."));
  }

  findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    return Promise.resolve(
      tenantId === c6Project.tenantId && projectId === c6Project.id ? c6Project : undefined,
    );
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(tenantId === c6Project.tenantId ? [c6Project] : []);
  }
}

export function eligibleSource(overrides: Partial<EligiblePlanSource> = {}): EligiblePlanSource {
  return {
    assetId: planAssetId,
    byteSize: 1024,
    detectedMimeType: "image/svg+xml",
    kind: "plan",
    projectId: alphaProjectId,
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    sha256: planSourceSha256,
    status: "ready",
    tenantId: alphaTenantId,
    ...overrides,
  };
}

export class MemoryPlanProcessingRepository implements PlanProcessingRepository {
  readonly calibrations = new Map<string, PlanCalibration>();
  readonly drafts = new Map<string, PlanOperationDraft>();
  readonly jobs = new Map<string, PlanProcessingJob>();
  readonly results = new Map<string, PlanParserResult>();
  readonly idempotency = new Map<string, object>();
  branchTarget?: BranchTarget;
  source: EligiblePlanSource | undefined = eligibleSource();

  #replay<T extends object>(
    command: { readonly actor: Actor; readonly idempotencyKey: string },
    action: string,
    body: object,
    create: () => T,
  ): { readonly replayed: boolean; readonly value: T } {
    const key = `${command.actor.tenantId}:${command.idempotencyKey}`;
    const envelope = { action, actor: command.actor.userId, body };
    const stored = this.idempotency.get(key) as
      { readonly envelope: object; readonly value: T } | undefined;
    if (stored !== undefined) {
      if (JSON.stringify(stored.envelope) !== JSON.stringify(envelope))
        throw new Error("idempotency-conflict");
      return { replayed: true, value: stored.value };
    }
    const value = create();
    this.idempotency.set(key, { envelope, value });
    return { replayed: false, value };
  }

  findPlanSource(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<EligiblePlanSource | undefined> {
    return Promise.resolve(
      this.source?.tenantId === tenantId &&
        this.source.projectId === projectId &&
        this.source.assetId === assetId
        ? this.source
        : undefined,
    );
  }

  createJob(command: CreatePlanJobCommand) {
    const result = this.#replay(
      command,
      "create",
      {
        assetId: command.assetId,
        pageIndex: command.pageIndex,
        parserPreference: command.parserPreference,
        projectId: command.projectId,
        sourceSha256: command.sourceSha256,
      },
      () => {
        const id = randomUUID();
        const job = planProcessingJobSchema.parse({
          assetId: command.assetId,
          attempt: 1,
          createdAt: c6Now,
          id,
          pageIndex: command.pageIndex,
          parserPreference: command.parserPreference,
          projectId: command.projectId,
          retryable: false,
          schemaVersion: "c6-plan-job-v1",
          sourceSha256: command.sourceSha256,
          state: "queued",
          updatedAt: c6Now,
          version: 1,
        });
        this.jobs.set(id, job);
        return job;
      },
    );
    return Promise.resolve({ job: result.value, replayed: result.replayed });
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly PlanProcessingJob[]> {
    return Promise.resolve(
      [...this.jobs.values()].filter(
        (job) => job.projectId === projectId && tenantId === alphaTenantId,
      ),
    );
  }

  findJob(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<PlanProcessingJob | undefined> {
    const job = this.jobs.get(jobId);
    return Promise.resolve(
      job?.projectId === projectId && tenantId === alphaTenantId ? job : undefined,
    );
  }

  findResult(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<PlanParserResult | undefined> {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId
        ? this.results.get(jobId)
        : undefined,
    );
  }

  cancelJob(command: TransitionPlanJobCommand) {
    const result = this.#replay(
      command,
      "cancel",
      { expectedVersion: command.expectedVersion, jobId: command.jobId },
      () => {
        const current = this.jobs.get(command.jobId);
        if (current === undefined || current.version !== command.expectedVersion)
          throw new Error("version-conflict");
        const job = planProcessingJobSchema.parse({
          ...current,
          state: current.state === "queued" ? "cancelled" : "cancel-requested",
          updatedAt: "2026-07-17T12:00:01.000Z",
          version: current.version + 1,
        });
        this.jobs.set(job.id, job);
        return job;
      },
    );
    return Promise.resolve({ job: result.value, replayed: result.replayed });
  }

  retryJob(command: TransitionPlanJobCommand) {
    const result = this.#replay(
      command,
      "retry",
      { expectedVersion: command.expectedVersion, jobId: command.jobId },
      () => {
        const current = this.jobs.get(command.jobId);
        if (current === undefined || !current.retryable || current.attempt >= 3)
          throw new Error("not-retryable");
        const id = randomUUID();
        const job = planProcessingJobSchema.parse({
          ...current,
          attempt: current.attempt + 1,
          createdAt: "2026-07-17T12:00:02.000Z",
          id,
          resultId: undefined,
          retryable: false,
          safeCode: undefined,
          state: "queued",
          updatedAt: "2026-07-17T12:00:02.000Z",
          version: 1,
        });
        this.jobs.set(id, job);
        return job;
      },
    );
    return Promise.resolve({ job: result.value, replayed: result.replayed });
  }

  createCalibration(command: CreateCalibrationCommand) {
    const result = this.#replay(
      command,
      "calibrate",
      { jobId: command.jobId, request: command.request },
      () => {
        const proposal = this.results.get(command.jobId);
        if (proposal?.status !== "proposal") throw new Error("proposal-required");
        const calibration = planCalibrationSchema.parse({
          createdAt: c6Now,
          createdBy: command.actor.userId,
          evidence: command.request.evidence,
          id: randomUUID(),
          jobId: command.jobId,
          projectId: command.projectId,
          proposalId: proposal.proposalId,
          residualMillimetres: command.residualMillimetres,
          sourceToModel: command.request.sourceToModel,
        });
        this.calibrations.set(calibration.id, calibration);
        return calibration;
      },
    );
    return Promise.resolve({ calibration: result.value, replayed: result.replayed });
  }

  findCalibration(
    tenantId: string,
    projectId: string,
    jobId: string,
    calibrationId: string,
  ): Promise<PlanCalibration | undefined> {
    const calibration = this.calibrations.get(calibrationId);
    return Promise.resolve(
      tenantId === alphaTenantId &&
        calibration?.projectId === projectId &&
        calibration.jobId === jobId
        ? calibration
        : undefined,
    );
  }

  findBranchTarget(
    tenantId: string,
    projectId: string,
    profile: "as-built" | "existing" | "proposed",
    branchId: string,
  ): Promise<BranchTarget | undefined> {
    const target = this.branchTarget;
    return Promise.resolve(
      tenantId === alphaTenantId &&
        target?.branch.projectId === projectId &&
        target.branch.profile === profile &&
        target.branch.id === branchId
        ? target
        : undefined,
    );
  }

  createOperationDraft(command: CreateOperationDraftCommand) {
    const result = this.#replay(
      command,
      "draft",
      { jobId: command.jobId, request: command.request },
      () => {
        const proposal = this.results.get(command.jobId);
        if (proposal?.status !== "proposal") throw new Error("proposal-required");
        const counts = { accepted: 0, corrected: 0, excluded: 0, unresolved: 0 };
        for (const decision of command.request.decisions) counts[decision.decision] += 1;
        const draft = planOperationDraftSchema.parse({
          acknowledgedFindingCodes: command.request.acknowledgedFindingCodes,
          calibrationId: command.request.calibrationId,
          createdAt: c6Now,
          createdBy: command.actor.userId,
          decisions: command.request.decisions,
          id: randomUUID(),
          jobId: command.jobId,
          metrics: {
            acceptedCount: counts.accepted,
            correctedCount: counts.corrected,
            excludedCount: counts.excluded,
            reviewDurationMilliseconds: command.request.reviewDurationMilliseconds,
            unresolvedCount: counts.unresolved,
          },
          operations: command.request.operations,
          projectId: command.projectId,
          proposalId: proposal.proposalId,
          schemaVersion: "c6-plan-operation-draft-v1",
          target: command.request.target,
        });
        this.drafts.set(draft.id, draft);
        return draft;
      },
    );
    return Promise.resolve({ draft: result.value, replayed: result.replayed });
  }
}

export function fixtureBranch(headSnapshotSha256: string, snapshot: unknown): BranchTarget {
  return {
    branch: modelBranchSchema.parse({
      createdAt: c6Now,
      createdBy: ownerUserId,
      headSnapshotId: "87000000-0000-4000-8000-000000000001",
      headSnapshotSha256,
      id: "87000000-0000-4000-8000-000000000002",
      modelId: existingModelId,
      name: "Main",
      profile: "existing",
      projectId: alphaProjectId,
      revision: 1,
      schemaVersion: "c5-model-branch-v1",
      sourceSnapshotId: "87000000-0000-4000-8000-000000000001",
      updatedAt: c6Now,
    }),
    snapshot,
  };
}
