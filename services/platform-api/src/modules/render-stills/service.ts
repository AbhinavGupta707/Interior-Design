import {
  c14RenderPolicy,
  createRenderJobRequestSchema,
  renderArtifactAccessSchema,
  renderJobSchema,
  renderOutputManifestSchema,
  renderResultSchema,
  type RenderJob,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { renderConflict, renderInvalid, renderUnavailable } from "./errors.js";
import { renderTelemetry } from "./telemetry.js";
import type {
  AcknowledgeRenderCancellationCommand,
  ClaimRenderJobCommand,
  CreateRenderJobCommand,
  FailRenderJobCommand,
  HeartbeatRenderJobCommand,
  LeasedRenderJob,
  PublishSafeRenderBundleCommand,
  RenderCapabilities,
  RenderArtifactAccess,
  RenderClock,
  RenderObjectStorage,
  RenderRepository,
  RenderSourceResolver,
  RenderTelemetry,
  RequestEnhancementCommand,
  TransitionRenderJobCommand,
} from "./types.js";

const systemClock: RenderClock = { now: () => new Date() };

function cacheIdentity(input: {
  readonly cameraId: string;
  readonly lightingPresetId: string;
  readonly profileId: string;
  readonly sourceIdentitySha256: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function requireAcceptingCapability(capabilities: RenderCapabilities, profileId: string): void {
  const profile = capabilities.profiles.find((candidate) => candidate.profileId === profileId);
  if (!capabilities.acceptingNewJobs || profile?.available !== true) {
    throw renderUnavailable(
      "RENDER_CAPABILITY_UNAVAILABLE",
      "New render work is paused because the selected profile has no authorised render host.",
    );
  }
}

export class RenderStillService {
  readonly #capabilities: RenderCapabilities;
  readonly #clock: RenderClock;
  readonly #repository: RenderRepository;
  readonly #resolver: RenderSourceResolver;
  readonly #storage: RenderObjectStorage;
  readonly #telemetry: RenderTelemetry;

  constructor(options: {
    readonly capabilities: RenderCapabilities;
    readonly clock?: RenderClock;
    readonly repository: RenderRepository;
    readonly resolver: RenderSourceResolver;
    readonly storage: RenderObjectStorage;
    readonly telemetry?: RenderTelemetry;
  }) {
    this.#capabilities = options.capabilities;
    this.#clock = options.clock ?? systemClock;
    this.#repository = options.repository;
    this.#resolver = options.resolver;
    this.#storage = options.storage;
    this.#telemetry = options.telemetry ?? renderTelemetry;
  }

  capabilities(): RenderCapabilities {
    return this.#capabilities;
  }

  async createJob(
    command: Omit<
      CreateRenderJobCommand,
      "cacheIdentitySha256" | "enhancementProviderEnabled" | "requestSha256" | "resolved"
    >,
  ): Promise<{ readonly job: RenderJob; readonly replayed: boolean }> {
    const request = createRenderJobRequestSchema.parse(command.request);
    requireAcceptingCapability(this.#capabilities, request.profileId);
    const resolved = await this.#resolver.resolveForNewJob(
      command.actor.tenantId,
      command.projectId,
      request,
    );
    if (resolved === undefined) throw notFound();
    const result = await this.#repository.createJob({
      ...command,
      cacheIdentitySha256: cacheIdentity({
        cameraId: request.cameraId,
        lightingPresetId: request.lightingPresetId,
        profileId: request.profileId,
        sourceIdentitySha256: resolved.cacheSourceIdentitySha256,
      }),
      enhancementProviderEnabled: this.#capabilities.enhancementProvider === "enabled",
      request,
      requestSha256: requestHash(request),
      resolved,
    });
    this.#telemetry.record({ outcome: result.replayed ? "replayed" : "accepted", stage: "create" });
    return result;
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly RenderJob[]> {
    return this.#repository.listJobs(tenantId, projectId);
  }

  async getJob(tenantId: string, projectId: string, jobId: string): Promise<RenderJob> {
    const job = await this.#repository.findJob(tenantId, projectId, jobId);
    if (job === undefined) throw notFound();
    return renderJobSchema.parse(job);
  }

  async getResult(tenantId: string, projectId: string, jobId: string) {
    const job = await this.getJob(tenantId, projectId, jobId);
    if (job.state !== "succeeded" || job.resultId === undefined) {
      throw renderConflict(
        "RENDER_RESULT_UNAVAILABLE",
        "The base geometry-safe result has not published.",
      );
    }
    const result = await this.#repository.findResult(tenantId, projectId, jobId);
    if (result === undefined || result.id !== job.resultId) {
      throw new Error("A succeeded render job has no matching immutable result.");
    }
    return renderResultSchema.parse(result);
  }

  async cancelJob(command: TransitionRenderJobCommand) {
    const result = await this.#repository.cancelJob(command);
    this.#telemetry.record({ outcome: result.replayed ? "replayed" : "accepted", stage: "cancel" });
    return result;
  }

  async retryJob(command: TransitionRenderJobCommand) {
    const current = await this.getJob(command.actor.tenantId, command.projectId, command.jobId);
    const resultRecord = await this.#repository.findResult(
      command.actor.tenantId,
      command.projectId,
      command.jobId,
    );
    if (resultRecord !== undefined || current.state === "succeeded") {
      throw renderConflict(
        "RENDER_JOB_NOT_RETRYABLE",
        "A published safe result is immutable and cannot be retried.",
      );
    }
    const source = await this.#repository.findPinnedSource(
      command.actor.tenantId,
      command.projectId,
      command.jobId,
    );
    if (
      source === undefined ||
      !(await this.#resolver.revalidatePinnedSource(
        command.actor.tenantId,
        command.projectId,
        source,
      ))
    ) {
      throw renderConflict(
        "RENDER_SOURCE_CHANGED",
        "The exact C10/C13 source or active rights are no longer eligible for retry.",
      );
    }
    const result = await this.#repository.retryJob(command);
    this.#telemetry.record({ outcome: result.replayed ? "replayed" : "accepted", stage: "retry" });
    return result;
  }

  getEnhancement(tenantId: string, projectId: string, jobId: string) {
    return this.#repository.findEnhancement(tenantId, projectId, jobId);
  }

  requestEnhancement(command: Omit<RequestEnhancementCommand, "providerEnabled">) {
    return this.#repository.requestEnhancement({
      ...command,
      providerEnabled: this.#capabilities.enhancementProvider === "enabled",
    });
  }

  async createArtifactAccess(input: {
    readonly actor: Parameters<RenderRepository["recordArtifactAccess"]>[0]["actor"];
    readonly artifactId: string;
    readonly correlation: Parameters<RenderRepository["recordArtifactAccess"]>[0]["correlation"];
    readonly jobId: string;
    readonly projectId: string;
  }): Promise<RenderArtifactAccess> {
    const result = await this.getResult(input.actor.tenantId, input.projectId, input.jobId);
    const stored = await this.#repository.findArtifact(
      input.actor.tenantId,
      input.projectId,
      input.jobId,
      input.artifactId,
    );
    if (
      stored === undefined ||
      stored.resultId !== result.id ||
      stored.manifestSha256 !== result.manifestSha256
    ) {
      throw notFound();
    }
    const expiresAt = new Date(
      this.#clock.now().getTime() + c14RenderPolicy.accessTtlSeconds * 1_000,
    );
    const signed = await this.#storage.signExactAccess({
      artifact: stored.artifact,
      expiresAt,
      manifestSha256: stored.manifestSha256,
      objectKey: stored.objectKey,
      resultId: stored.resultId,
    });
    const response = renderArtifactAccessSchema.parse({
      artifactId: stored.artifact.id,
      byteLength: stored.artifact.byteLength,
      expiresAt: signed.expiresAt,
      manifestSha256: stored.manifestSha256,
      mediaType: stored.artifact.mediaType,
      role: stored.artifact.role,
      sha256: stored.artifact.sha256,
      url: signed.url,
    });
    await this.#repository.recordArtifactAccess({
      actor: input.actor,
      artifactId: input.artifactId,
      correlation: input.correlation,
      jobId: input.jobId,
      projectId: input.projectId,
      resultId: result.id,
    });
    this.#telemetry.record({ outcome: "accepted", stage: "access" });
    return response;
  }
}

export class RenderStillWorkerService {
  readonly #repository: RenderRepository;
  readonly #resolver: RenderSourceResolver;
  readonly #storage: RenderObjectStorage;
  readonly #telemetry: RenderTelemetry;

  constructor(options: {
    readonly repository: RenderRepository;
    readonly resolver: RenderSourceResolver;
    readonly storage: RenderObjectStorage;
    readonly telemetry?: RenderTelemetry;
  }) {
    this.#repository = options.repository;
    this.#resolver = options.resolver;
    this.#storage = options.storage;
    this.#telemetry = options.telemetry ?? renderTelemetry;
  }

  claimNext(command: ClaimRenderJobCommand): Promise<LeasedRenderJob | undefined> {
    this.#telemetry.record({ outcome: "accepted", stage: "claim" });
    return this.#repository.claimNext(command);
  }

  heartbeat(command: HeartbeatRenderJobCommand): Promise<RenderJob> {
    this.#telemetry.record({ outcome: "accepted", stage: command.stage });
    return this.#repository.heartbeat(command);
  }

  async publish(command: PublishSafeRenderBundleCommand): Promise<RenderJob> {
    await this.#repository.assertLease(command);
    const job = await this.#repository.findJob(command.tenantId, command.projectId, command.jobId);
    if (job === undefined || job.attempt !== command.attempt || job.state !== "publishing-safe") {
      throw renderConflict(
        "RENDER_PUBLICATION_FENCED",
        "Only the active publishing lease can expose a safe result.",
      );
    }
    const manifest = renderOutputManifestSchema.parse(command.manifest);
    if (
      manifest.resultId !== command.resultId ||
      createHash("sha256").update(command.manifestBytes).digest("hex") !== command.manifestSha256
    ) {
      throw renderInvalid(
        "RENDER_MANIFEST_INVALID",
        "The output manifest failed its external hash envelope.",
      );
    }
    if (
      !(await this.#resolver.revalidatePinnedSource(
        command.tenantId,
        command.projectId,
        manifest.source,
      ))
    ) {
      throw renderConflict(
        "RENDER_SOURCE_CHANGED",
        "The exact C10/C13 source or active rights changed before publication.",
      );
    }
    const published = [];
    for (const artifact of manifest.artifacts) {
      const bytes = command.artifactBytes.get(artifact.role);
      if (
        bytes === undefined ||
        bytes.byteLength !== artifact.byteLength ||
        createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
      ) {
        throw renderInvalid(
          "RENDER_ARTIFACT_HASH_MISMATCH",
          "A safe artifact failed exact hash or size verification.",
        );
      }
      const object = await this.#storage.putImmutable({
        bytes,
        mediaType: artifact.mediaType,
        role: artifact.role,
        sha256: artifact.sha256,
      });
      published.push({ artifact, objectKey: object.objectKey });
    }
    // Immutable objects exist first. This one fenced transaction is the sole visibility point;
    // failures leave content-addressed orphans but no readable result.
    const result = await this.#repository.publishResult({
      ...command,
      artifacts: published,
      manifest,
      manifestSha256: command.manifestSha256,
    });
    this.#telemetry.record({ outcome: "accepted", stage: "publish" });
    return result;
  }

  fail(command: FailRenderJobCommand): Promise<RenderJob> {
    this.#telemetry.record({ outcome: "failed", stage: "publish" });
    return this.#repository.failAttempt(command);
  }

  acknowledgeCancellation(command: AcknowledgeRenderCancellationCommand): Promise<void> {
    return this.#repository.acknowledgeCancellation(command);
  }
}
