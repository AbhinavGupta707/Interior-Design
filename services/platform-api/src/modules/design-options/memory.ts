import {
  designOptionSchema,
  modelSnapshotRecordSchema,
  optionConfirmationSchema,
  optionJobSchema,
  type CanonicalHomeSnapshot,
  type DesignBrief,
  type DesignConstraint,
  type DesignOption,
  type DesignOptionSet,
  type OptionConfirmation,
  type OptionJob,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import { canonicalBriefSnapshot } from "@interior-design/design-brief";
import {
  reduceModelOperations,
  validateAndCanonicalizeSnapshot,
} from "@interior-design/model-operations";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { designOptionConflict } from "./errors.js";
import { c12Sha256 } from "./hashes.js";
import type {
  AbstainOptionAttemptCommand,
  AcknowledgeOptionCancellationCommand,
  AdvanceOptionAttemptCommand,
  ClaimOptionAttemptCommand,
  ConfirmOptionCommand,
  CreateOptionJobCommand,
  DesignAssetVerificationPort,
  DesignOptionClock,
  DesignOptionConfirmationResult,
  DesignOptionRepository,
  DesignOptionUuidFactory,
  FailOptionAttemptCommand,
  HeartbeatOptionAttemptCommand,
  LeasedOptionAttempt,
  PublishOptionSetCommand,
  TransitionOptionJobCommand,
} from "./types.js";
import { validateOptionPublication } from "./validation.js";

interface StoredJob {
  readonly acceptedBrief: DesignBrief;
  readonly constraints: readonly DesignConstraint[];
  job: OptionJob;
  readonly sourceSnapshot: ModelSnapshotRecord;
  readonly workingSnapshot: CanonicalHomeSnapshot;
}

interface StoredAttempt {
  attempt: number;
  jobVersion: number;
  leaseExpiresAt?: string;
  leaseToken?: string;
  stage: OptionJob["stage"];
  state: "cancel-requested" | "cancelled" | "failed" | "leased" | "queued" | "succeeded";
  workerId?: string;
}

interface StoredPublication {
  readonly optionSet: DesignOptionSet;
  readonly options: Map<string, DesignOption>;
}

interface StoredEffect {
  readonly actorUserId: string;
  readonly operation: string;
  readonly projectId: string;
  readonly requestSha256: string;
  readonly response: unknown;
}

function key(...parts: readonly string[]): string {
  return parts.join(":");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryDesignOptionRepository implements DesignOptionRepository {
  readonly attempts = new Map<string, StoredAttempt>();
  readonly branches = new Map<
    string,
    { readonly optionId: string; readonly snapshotSha256: string }
  >();
  readonly confirmations = new Map<string, OptionConfirmation>();
  readonly effects = new Map<string, StoredEffect>();
  readonly jobs = new Map<string, StoredJob>();
  readonly publications = new Map<string, StoredPublication>();
  readonly stateEvents: Array<{
    readonly jobId: string;
    readonly state: string;
    readonly version: number;
  }> = [];
  readonly #clock: DesignOptionClock;
  readonly #assetVerifier: DesignAssetVerificationPort;
  readonly #uuid: DesignOptionUuidFactory;

  constructor(
    options: {
      readonly clock?: DesignOptionClock;
      readonly assetVerifier?: DesignAssetVerificationPort;
      readonly uuid?: DesignOptionUuidFactory;
    } = {},
  ) {
    this.#assetVerifier = options.assetVerifier ?? { verifyExact: () => Promise.resolve(true) };
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#uuid = options.uuid ?? { randomUUID };
  }

  #effect(
    tenantId: string,
    idempotencyKey: string,
    actorUserId: string,
    operation: string,
    projectId: string,
    requestSha256: string,
  ): { readonly replay?: unknown; readonly storageKey: string } {
    const storageKey = key(tenantId, idempotencyKey);
    const existing = this.effects.get(storageKey);
    if (existing === undefined) return { storageKey };
    if (
      existing.actorUserId !== actorUserId ||
      existing.operation !== operation ||
      existing.projectId !== projectId ||
      existing.requestSha256 !== requestSha256
    ) {
      throw designOptionConflict(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different C12 mutation.",
      );
    }
    return { replay: clone(existing.response), storageKey };
  }

  #storeEffect(
    storageKey: string,
    actorUserId: string,
    operation: string,
    projectId: string,
    requestSha256: string,
    response: unknown,
  ): void {
    this.effects.set(storageKey, {
      actorUserId,
      operation,
      projectId,
      requestSha256,
      response: clone(response),
    });
  }

  #stored(tenantId: string, projectId: string, jobId: string): StoredJob | undefined {
    return this.jobs.get(key(tenantId, projectId, jobId));
  }

  #require(tenantId: string, projectId: string, jobId: string): StoredJob {
    const stored = this.#stored(tenantId, projectId, jobId);
    if (stored === undefined)
      throw designOptionConflict("SOURCE_CHANGED", "The C12 job is unavailable.");
    return stored;
  }

  #record(stored: StoredJob): void {
    this.stateEvents.push({
      jobId: stored.job.id,
      state: stored.job.state,
      version: stored.job.version,
    });
  }

  #workerInputs(
    stored: StoredJob,
  ):
    | { readonly acceptedBrief: DesignBrief; readonly sourceSnapshot: ModelSnapshotRecord }
    | undefined {
    try {
      const accepted = canonicalBriefSnapshot(stored.acceptedBrief);
      const source = modelSnapshotRecordSchema.parse(stored.sourceSnapshot);
      const canonicalSource = validateAndCanonicalizeSnapshot(source.snapshot);
      const canonicalWorking = validateAndCanonicalizeSnapshot(stored.workingSnapshot);
      if (
        accepted.brief.status !== "accepted" ||
        accepted.brief.id !== stored.job.baseBrief.briefId ||
        accepted.brief.projectId !== stored.job.projectId ||
        accepted.brief.revision !== stored.job.baseBrief.revision ||
        accepted.contentSha256 !== stored.job.baseBrief.contentSha256 ||
        source.projectId !== stored.job.projectId ||
        source.modelId !== stored.job.sourceModel.modelId ||
        source.profile !== stored.job.sourceModel.profile ||
        source.id !== stored.job.sourceModel.snapshotId ||
        source.version !== stored.job.sourceModel.snapshotVersion ||
        source.snapshotSha256 !== stored.job.sourceModel.snapshotSha256 ||
        canonicalSource.hasBlockingFindings ||
        canonicalSource.snapshotSha256 !== source.snapshotSha256 ||
        canonicalSource.canonicalByteLength !== source.canonicalByteLength ||
        canonicalWorking.hasBlockingFindings ||
        canonicalWorking.snapshotSha256 !== stored.job.workingModel.snapshotSha256
      ) {
        return undefined;
      }
      return { acceptedBrief: accepted.brief, sourceSnapshot: source };
    } catch {
      return undefined;
    }
  }

  createJob(command: CreateOptionJobCommand) {
    const effect = this.#effect(
      command.actor.tenantId,
      command.idempotencyKey,
      command.actor.userId,
      "design-option.job.create",
      command.projectId,
      command.requestSha256,
    );
    if (effect.replay !== undefined) {
      const replay = z.object({ job: optionJobSchema }).parse(effect.replay);
      return Promise.resolve({ job: replay.job, replayed: true });
    }
    const now = this.#clock.now().toISOString();
    const job = optionJobSchema.parse({
      assetManifestSha256: command.assetManifestSha256,
      attempt: 1,
      baseBrief: command.request.baseBrief,
      constraints: command.constraints,
      constraintsSha256: command.constraintsSha256,
      createdAt: now,
      createdBy: command.actor.userId,
      id: command.jobId,
      optionCount: 0,
      projectId: command.projectId,
      requestedDirections: command.request.requestedDirections,
      requestedOptionCount: command.request.requestedOptionCount,
      retryable: false,
      schemaVersion: "c12-option-job-v1",
      sourceModel: command.request.sourceModel,
      stage: "queued",
      state: "queued",
      updatedAt: now,
      version: 1,
      workingModel: command.workingModel,
    });
    const storageKey = key(command.actor.tenantId, command.projectId, command.jobId);
    this.jobs.set(storageKey, {
      acceptedBrief: clone(command.acceptedBrief),
      constraints: Object.freeze(clone(command.constraints)),
      job,
      sourceSnapshot: clone(command.sourceSnapshot),
      workingSnapshot: clone(command.workingSnapshot),
    });
    this.attempts.set(storageKey, { attempt: 1, jobVersion: 1, stage: "queued", state: "queued" });
    this.#record(this.jobs.get(storageKey) as StoredJob);
    this.#storeEffect(
      effect.storageKey,
      command.actor.userId,
      "design-option.job.create",
      command.projectId,
      command.requestSha256,
      { job },
    );
    return Promise.resolve({ job: clone(job), replayed: false });
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly OptionJob[]> {
    return Promise.resolve(
      [...this.jobs.entries()]
        .filter(([storageKey]) => storageKey.startsWith(key(tenantId, projectId) + ":"))
        .map(([, stored]) => clone(stored.job))
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        ),
    );
  }

  findJob(tenantId: string, projectId: string, jobId: string): Promise<OptionJob | undefined> {
    const job = this.#stored(tenantId, projectId, jobId)?.job;
    return Promise.resolve(job === undefined ? undefined : clone(job));
  }

  cancelJob(command: TransitionOptionJobCommand) {
    const requestSha256 = c12Sha256({
      expectedVersion: command.expectedVersion,
      jobId: command.jobId,
      projectId: command.projectId,
    });
    const effect = this.#effect(
      command.actor.tenantId,
      command.idempotencyKey,
      command.actor.userId,
      "design-option.job.cancel",
      command.projectId,
      requestSha256,
    );
    if (effect.replay !== undefined) {
      const replay = z.object({ job: optionJobSchema }).parse(effect.replay);
      return Promise.resolve({ job: replay.job, replayed: true });
    }
    const stored = this.#require(command.actor.tenantId, command.projectId, command.jobId);
    if (stored.job.version !== command.expectedVersion) {
      throw designOptionConflict("JOB_VERSION_CONFLICT", "The C12 job version changed.");
    }
    const now = this.#clock.now().toISOString();
    const attempt = this.attempts.get(
      key(command.actor.tenantId, command.projectId, command.jobId),
    );
    if (stored.job.state === "queued") {
      stored.job = optionJobSchema.parse({
        ...stored.job,
        cancelledAt: now,
        retryable: true,
        stage: "complete",
        state: "cancelled",
        updatedAt: now,
        version: stored.job.version + 1,
      });
      if (attempt !== undefined) attempt.state = "cancelled";
    } else if (stored.job.state === "running") {
      stored.job = optionJobSchema.parse({
        ...stored.job,
        state: "cancel-requested",
        updatedAt: now,
        version: stored.job.version + 1,
      });
      if (attempt !== undefined) attempt.state = "cancel-requested";
    } else {
      throw designOptionConflict(
        "JOB_VERSION_CONFLICT",
        "Only queued or running jobs can be cancelled.",
      );
    }
    this.#record(stored);
    this.#storeEffect(
      effect.storageKey,
      command.actor.userId,
      "design-option.job.cancel",
      command.projectId,
      requestSha256,
      { job: stored.job },
    );
    return Promise.resolve({ job: clone(stored.job), replayed: false });
  }

  retryJob(command: TransitionOptionJobCommand) {
    const requestSha256 = c12Sha256({
      expectedVersion: command.expectedVersion,
      jobId: command.jobId,
      projectId: command.projectId,
    });
    const effect = this.#effect(
      command.actor.tenantId,
      command.idempotencyKey,
      command.actor.userId,
      "design-option.job.retry",
      command.projectId,
      requestSha256,
    );
    if (effect.replay !== undefined) {
      const replay = z.object({ job: optionJobSchema }).parse(effect.replay);
      return Promise.resolve({ job: replay.job, replayed: true });
    }
    const stored = this.#require(command.actor.tenantId, command.projectId, command.jobId);
    if (stored.job.version !== command.expectedVersion) {
      throw designOptionConflict("JOB_VERSION_CONFLICT", "The C12 job version changed.");
    }
    if (!stored.job.retryable || !["failed", "cancelled", "abstained"].includes(stored.job.state)) {
      throw designOptionConflict("JOB_NOT_RETRYABLE", "This terminal C12 job is not retryable.");
    }
    const now = this.#clock.now().toISOString();
    stored.job = optionJobSchema.parse({
      ...stored.job,
      attempt: stored.job.attempt + 1,
      cancelledAt: undefined,
      completedAt: undefined,
      optionCount: 0,
      retryable: false,
      safeCode: undefined,
      stage: "queued",
      state: "queued",
      updatedAt: now,
      version: stored.job.version + 1,
    });
    this.attempts.set(key(command.actor.tenantId, command.projectId, command.jobId), {
      attempt: stored.job.attempt,
      jobVersion: stored.job.version,
      stage: "queued",
      state: "queued",
    });
    this.#record(stored);
    this.#storeEffect(
      effect.storageKey,
      command.actor.userId,
      "design-option.job.retry",
      command.projectId,
      requestSha256,
      { job: stored.job },
    );
    return Promise.resolve({ job: clone(stored.job), replayed: false });
  }

  claimNext(command: ClaimOptionAttemptCommand): Promise<LeasedOptionAttempt | undefined> {
    const now = this.#clock.now();
    const leaseSeconds = command.leaseSeconds ?? 60;
    if (leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw designOptionConflict("LEASE_LOST", "C12 leases must be between 30 and 3600 seconds.");
    }
    const candidates = [...this.jobs.entries()].sort(
      ([, left], [, right]) =>
        left.job.createdAt.localeCompare(right.job.createdAt) ||
        left.job.id.localeCompare(right.job.id),
    );
    for (const [storageKey, stored] of candidates) {
      const attempt = this.attempts.get(storageKey);
      if (attempt === undefined) continue;
      if (attempt.state === "cancel-requested") continue;
      const expired =
        attempt.state === "leased" &&
        attempt.leaseExpiresAt !== undefined &&
        Date.parse(attempt.leaseExpiresAt) <= now.getTime();
      if (attempt.state !== "queued" && !expired) continue;
      const inputs = this.#workerInputs(stored);
      if (inputs === undefined) {
        stored.job = optionJobSchema.parse({
          ...stored.job,
          retryable: true,
          safeCode: "SOURCE_CHANGED",
          stage: "complete",
          state: "failed",
          updatedAt: now.toISOString(),
          version: stored.job.version + 1,
        });
        attempt.jobVersion = stored.job.version;
        attempt.stage = "complete";
        attempt.state = "failed";
        this.#record(stored);
        continue;
      }
      const leaseToken = this.#uuid.randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
      attempt.state = "leased";
      attempt.workerId = command.workerId;
      attempt.leaseToken = leaseToken;
      attempt.leaseExpiresAt = leaseExpiresAt;
      attempt.stage = "deriving-constraints";
      if (stored.job.state === "queued") {
        stored.job = optionJobSchema.parse({
          ...stored.job,
          stage: "deriving-constraints",
          state: "running",
          updatedAt: now.toISOString(),
          version: stored.job.version + 1,
        });
        attempt.jobVersion = stored.job.version;
        this.#record(stored);
      }
      const [tenantId = ""] = storageKey.split(":");
      return Promise.resolve({
        acceptedBrief: clone(inputs.acceptedBrief),
        attempt: attempt.attempt,
        constraints: clone(stored.constraints),
        job: clone(stored.job),
        leaseExpiresAt,
        leaseToken,
        sourceSnapshot: clone(inputs.sourceSnapshot),
        tenantId,
        workingSnapshot: clone(stored.workingSnapshot),
      });
    }
    return Promise.resolve(undefined);
  }

  #lease(command: {
    readonly attempt: number;
    readonly expectedJobVersion: number;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  }): {
    readonly acceptedBrief: DesignBrief;
    readonly attempt: StoredAttempt;
    readonly sourceSnapshot: ModelSnapshotRecord;
    readonly stored: StoredJob;
  } {
    const storageKey = key(command.tenantId, command.projectId, command.jobId);
    const stored = this.#require(command.tenantId, command.projectId, command.jobId);
    const attempt = this.attempts.get(storageKey);
    if (
      attempt === undefined ||
      attempt.attempt !== command.attempt ||
      attempt.jobVersion !== command.expectedJobVersion ||
      attempt.workerId !== command.workerId ||
      attempt.leaseToken !== command.leaseToken ||
      attempt.leaseExpiresAt === undefined ||
      Date.parse(attempt.leaseExpiresAt) <= this.#clock.now().getTime() ||
      (attempt.state !== "leased" && attempt.state !== "cancel-requested")
    ) {
      throw designOptionConflict(
        "LEASE_LOST",
        "The C12 worker lease or publication fence was lost.",
      );
    }
    const inputs = this.#workerInputs(stored);
    if (inputs === undefined) {
      throw designOptionConflict("SOURCE_CHANGED", "The exact C12 worker inputs changed.");
    }
    return { ...inputs, attempt, stored };
  }

  heartbeatAttempt(command: HeartbeatOptionAttemptCommand): Promise<LeasedOptionAttempt> {
    const leased = this.#lease(command);
    const seconds = command.leaseSeconds ?? 60;
    if (seconds < 30 || seconds > 3_600) {
      throw designOptionConflict("LEASE_LOST", "C12 leases must be between 30 and 3600 seconds.");
    }
    leased.attempt.leaseExpiresAt = new Date(
      this.#clock.now().getTime() + seconds * 1_000,
    ).toISOString();
    return Promise.resolve({
      acceptedBrief: clone(leased.acceptedBrief),
      attempt: leased.attempt.attempt,
      constraints: clone(leased.stored.constraints),
      job: clone(leased.stored.job),
      leaseExpiresAt: leased.attempt.leaseExpiresAt,
      leaseToken: command.leaseToken,
      sourceSnapshot: clone(leased.sourceSnapshot),
      tenantId: command.tenantId,
      workingSnapshot: clone(leased.stored.workingSnapshot),
    });
  }

  advanceAttempt(command: AdvanceOptionAttemptCommand): Promise<OptionJob> {
    const leased = this.#lease(command);
    const order = ["deriving-constraints", "generating", "validating", "publishing"] as const;
    if (
      order.indexOf(command.stage) !==
      order.indexOf(leased.attempt.stage as typeof command.stage) + 1
    ) {
      throw designOptionConflict("LEASE_LOST", "C12 worker stages must advance exactly once.");
    }
    const now = this.#clock.now().toISOString();
    leased.stored.job = optionJobSchema.parse({
      ...leased.stored.job,
      stage: command.stage,
      updatedAt: now,
      version: leased.stored.job.version + 1,
    });
    leased.attempt.stage = command.stage;
    leased.attempt.jobVersion = leased.stored.job.version;
    this.#record(leased.stored);
    return Promise.resolve(clone(leased.stored.job));
  }

  async publishOptions(command: PublishOptionSetCommand): Promise<OptionJob> {
    const leased = this.#lease(command);
    if (leased.attempt.stage !== "publishing" || leased.stored.job.state !== "running") {
      throw designOptionConflict(
        "LEASE_LOST",
        "Only a running fenced publishing attempt may publish.",
      );
    }
    const validated = validateOptionPublication({
      constraints: leased.stored.constraints,
      job: leased.stored.job,
      optionSet: command.optionSet,
      options: command.options,
      workingSnapshot: leased.stored.workingSnapshot,
    });
    for (const option of validated.options) {
      for (const placement of option.operationBundle.assetPlacements) {
        if (!(await this.#assetVerifier.verifyExact(placement.asset))) {
          throw designOptionConflict(
            "ASSET_BINDING_CHANGED",
            "A published C12 asset binding is unavailable or changed.",
          );
        }
      }
    }
    // The verifier is asynchronous; re-check the complete fence before the first durable write.
    this.#lease(command);
    const now = this.#clock.now().toISOString();
    this.publications.set(key(command.tenantId, command.projectId, command.jobId), {
      optionSet: clone(validated.optionSet),
      options: new Map(validated.options.map((option) => [option.id, clone(option)])),
    });
    leased.stored.job = optionJobSchema.parse({
      ...leased.stored.job,
      completedAt: now,
      optionCount: validated.options.length,
      retryable: false,
      stage: "complete",
      state: "succeeded",
      updatedAt: now,
      version: leased.stored.job.version + 1,
    });
    leased.attempt.state = "succeeded";
    leased.attempt.jobVersion = leased.stored.job.version;
    this.#record(leased.stored);
    return clone(leased.stored.job);
  }

  abstainAttempt(command: AbstainOptionAttemptCommand): Promise<OptionJob> {
    const leased = this.#lease(command);
    const now = this.#clock.now().toISOString();
    leased.stored.job = optionJobSchema.parse({
      ...leased.stored.job,
      completedAt: now,
      optionCount: 0,
      retryable: true,
      safeCode: command.safeCode,
      stage: "complete",
      state: "abstained",
      updatedAt: now,
      version: leased.stored.job.version + 1,
    });
    leased.attempt.state = "failed";
    this.#record(leased.stored);
    return Promise.resolve(clone(leased.stored.job));
  }

  failAttempt(command: FailOptionAttemptCommand): Promise<OptionJob> {
    const leased = this.#lease(command);
    const now = this.#clock.now().toISOString();
    leased.stored.job = optionJobSchema.parse({
      ...leased.stored.job,
      retryable: command.retryable,
      safeCode: command.safeCode,
      stage: "complete",
      state: "failed",
      updatedAt: now,
      version: leased.stored.job.version + 1,
    });
    leased.attempt.state = "failed";
    this.#record(leased.stored);
    return Promise.resolve(clone(leased.stored.job));
  }

  acknowledgeCancellation(command: AcknowledgeOptionCancellationCommand): Promise<OptionJob> {
    const leased = this.#lease(command);
    if (
      leased.attempt.state !== "cancel-requested" ||
      leased.stored.job.state !== "cancel-requested"
    ) {
      throw designOptionConflict("LEASE_LOST", "This fenced attempt has no cancellation request.");
    }
    const now = this.#clock.now().toISOString();
    leased.stored.job = optionJobSchema.parse({
      ...leased.stored.job,
      cancelledAt: now,
      retryable: true,
      stage: "complete",
      state: "cancelled",
      updatedAt: now,
      version: leased.stored.job.version + 1,
    });
    leased.attempt.state = "cancelled";
    this.#record(leased.stored);
    return Promise.resolve(clone(leased.stored.job));
  }

  listOptions(tenantId: string, projectId: string, jobId: string) {
    const publication = this.publications.get(key(tenantId, projectId, jobId));
    if (publication === undefined) return Promise.resolve({ options: [] });
    return Promise.resolve({
      optionSet: clone(publication.optionSet),
      options: [...publication.options.values()].map((option) => this.#projectStatus(option)),
    });
  }

  findOption(tenantId: string, projectId: string, jobId: string, optionId: string) {
    const option = this.publications.get(key(tenantId, projectId, jobId))?.options.get(optionId);
    return Promise.resolve(option === undefined ? undefined : this.#projectStatus(option));
  }

  #projectStatus(option: DesignOption): DesignOption {
    if (
      option.status === "pending" &&
      Date.parse(option.expiresAt) <= this.#clock.now().getTime()
    ) {
      return designOptionSchema.parse({ ...clone(option), status: "expired" });
    }
    return clone(option);
  }

  confirmOption(command: ConfirmOptionCommand): Promise<DesignOptionConfirmationResult> {
    const effect = this.#effect(
      command.actor.tenantId,
      command.request.idempotencyKey,
      command.actor.userId,
      "design-option.option.confirm",
      command.projectId,
      command.requestSha256,
    );
    if (effect.replay !== undefined) {
      const replay = z.object({ confirmation: optionConfirmationSchema }).parse(effect.replay);
      return Promise.resolve({ confirmation: replay.confirmation, replayed: true });
    }
    const stored = this.#require(command.actor.tenantId, command.projectId, command.jobId);
    const publication = this.publications.get(
      key(command.actor.tenantId, command.projectId, command.jobId),
    );
    const retained = publication?.options.get(command.optionId);
    if (publication === undefined || retained === undefined || stored.job.state !== "succeeded") {
      throw designOptionConflict(
        "OPTION_NOT_PENDING",
        "The exact pending C12 option is unavailable.",
      );
    }
    if (Date.parse(retained.expiresAt) <= this.#clock.now().getTime()) {
      throw designOptionConflict(
        "OPTION_EXPIRED",
        "The C12 option expired before confirmation.",
        410,
      );
    }
    if (retained.status !== "pending") {
      throw designOptionConflict("OPTION_NOT_PENDING", "The C12 option is no longer pending.");
    }
    if (
      command.request.expectedJobVersion !== stored.job.version ||
      command.request.expectedBriefRevision !== stored.job.baseBrief.revision ||
      command.request.expectedBriefContentSha256 !== stored.job.baseBrief.contentSha256 ||
      command.request.expectedSourceSnapshotSha256 !== stored.job.sourceModel.snapshotSha256 ||
      command.request.expectedOptionSetSha256 !== publication.optionSet.setSha256
    ) {
      throw designOptionConflict(
        "CONFIRMATION_CONFLICT",
        "A C12 confirmation pin is stale or forged.",
      );
    }
    const replay = reduceModelOperations(
      stored.workingSnapshot,
      retained.operationBundle.operations,
    );
    if (
      replay.hasBlockingFindings ||
      replay.snapshotSha256 !== retained.operationBundle.candidateSnapshotSha256
    ) {
      throw designOptionConflict(
        "CONSTRAINTS_FAILED",
        "The retained C12 option no longer replays exactly.",
        422,
      );
    }

    // All validation precedes these writes, providing rollback semantics for the in-memory adapter.
    const branchId = this.#uuid.randomUUID();
    const previewId = this.#uuid.randomUUID();
    const commitId = this.#uuid.randomUUID();
    const confirmation = optionConfirmationSchema.parse({
      branchId,
      branchRevision: 1,
      commitId,
      confirmedAt: this.#clock.now().toISOString(),
      confirmedBy: command.actor.userId,
      id: this.#uuid.randomUUID(),
      idempotencyKey: command.request.idempotencyKey,
      optionId: command.optionId,
      previewId,
      projectId: command.projectId,
      resultSnapshotSha256: replay.snapshotSha256,
      schemaVersion: "c12-option-confirmation-v1",
    });
    publication.options.set(
      command.optionId,
      designOptionSchema.parse({ ...retained, status: "confirmed" }),
    );
    this.branches.set(branchId, {
      optionId: command.optionId,
      snapshotSha256: replay.snapshotSha256,
    });
    this.confirmations.set(
      key(command.actor.tenantId, command.projectId, command.optionId),
      confirmation,
    );
    this.#storeEffect(
      effect.storageKey,
      command.actor.userId,
      "design-option.option.confirm",
      command.projectId,
      command.requestSha256,
      { confirmation },
    );
    return Promise.resolve({ confirmation: clone(confirmation), replayed: false });
  }
}
