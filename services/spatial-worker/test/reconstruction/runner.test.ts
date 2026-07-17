import {
  reconstructionResultSchema,
  type MediaPreparationManifest,
  type ReconstructionResult,
} from "@interior-design/contracts";
import type {
  LeasedReconstructionAttempt,
  ReconstructionRepository,
} from "@interior-design/platform-api/reconstruction";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MediaPreparationPipeline } from "../../src/media-prep/index.js";
import { canonicalSha256 } from "../../src/media-prep/canonical.js";
import { ReconstructionProcessingRunner } from "../../src/reconstruction/runner.js";
import {
  ReconstructionWorkerError,
  type LeasedReconstructionSource,
  type ReconstructionProcessor,
} from "../../src/reconstruction/types.js";
import type { ObjectStorage } from "../../src/storage.js";
import {
  acceptingPrivacyReviewer,
  sha256,
  SyntheticMediaProcess,
  syntheticPng,
} from "../media-prep/fixtures.js";

const roots: string[] = [];
const tenantId = "4e7fc4ea-0c12-462f-9ddd-b541dc60f008";
const projectId = "cb79666d-ed5f-5c2b-aa9e-9f0a187049de";
const jobId = "40c6c94a-7177-53a5-a367-49de0e4c9059";
const assetId = "61926662-21a7-573e-a768-c35f5583badb";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c8-runner-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function source(bytes: Uint8Array): LeasedReconstructionSource {
  return {
    assetId,
    byteSize: bytes.byteLength,
    detectedMimeType: "image/png",
    kind: "rgb-image",
    objectKey: "synthetic/source.png",
    sha256: sha256(bytes),
  };
}

function sourceManifestSha256(value: LeasedReconstructionSource): string {
  return canonicalSha256({
    mode: "rgb-sfm",
    sources: [
      {
        assetId: value.assetId,
        byteSize: value.byteSize,
        detectedMimeType: value.detectedMimeType,
        rights: {
          basis: "owned-by-user",
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        sha256: value.sha256,
      },
    ],
  });
}

function lease(value: LeasedReconstructionSource): LeasedReconstructionAttempt {
  return {
    attempt: 1,
    jobId,
    leaseExpiresAt: "2026-07-17T23:00:00.000Z",
    leaseToken: "c7b7f20e-0d91-4fe5-af30-ee25c8b6e39a",
    projectId,
    request: {
      appearanceMode: "disabled",
      label: "Visibly synthetic runner fixture",
      mode: "rgb-sfm",
      registrationAnchors: [],
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sources: [
        {
          assetId: value.assetId,
          byteSize: value.byteSize,
          detectedMimeType: value.detectedMimeType,
          kind: value.kind,
          sha256: value.sha256,
        },
      ],
    },
    sourceManifestSha256: sourceManifestSha256(value),
    stage: "preparing",
    tenantId,
  };
}

function abstention(job: LeasedReconstructionAttempt, safeCode: string): ReconstructionResult {
  return reconstructionResultSchema.parse({
    createdAt: "2026-07-17T20:00:00.000Z",
    diagnosticArtifact: {
      artifactId: "54d8b982-a5ca-40fc-883a-274c2b5a26bb",
      byteSize: 32,
      contentSha256: "a".repeat(64),
      dimensionalAuthority: "proposal-only",
      kind: "diagnostics",
      mediaType: "application/json",
      sourceManifestSha256: job.sourceManifestSha256,
      toolManifestSha256: "b".repeat(64),
    },
    findings: [safeCode],
    jobId: job.jobId,
    projectId: job.projectId,
    resultId: "9eeadbd9-967e-4d17-845f-7150dd431f24",
    safeCode,
    schemaVersion: "c8-reconstruction-result-v1",
    sourceManifestSha256: job.sourceManifestSha256,
    status: "abstained",
  });
}

class MemoryQueue {
  readonly lease: LeasedReconstructionAttempt;
  acknowledgements = 0;
  advances: string[] = [];
  failures: Array<{ readonly retryable: boolean; readonly safeCode: string }> = [];
  published: ReconstructionResult[] = [];
  claimed = false;
  fencePublication = false;

  constructor(value: LeasedReconstructionAttempt) {
    this.lease = value;
  }

  claimNext(): Promise<LeasedReconstructionAttempt | undefined> {
    if (this.claimed) return Promise.resolve(undefined);
    this.claimed = true;
    return Promise.resolve(this.lease);
  }

  advanceAttempt(command: Parameters<ReconstructionRepository["advanceAttempt"]>[0]) {
    this.advances.push(command.stage);
    return Promise.resolve({} as Awaited<ReturnType<ReconstructionRepository["advanceAttempt"]>>);
  }

  publishResult(command: Parameters<ReconstructionRepository["publishResult"]>[0]) {
    if (this.fencePublication) return Promise.reject(new Error("synthetic-fence"));
    this.published.push(command.result);
    return Promise.resolve({} as Awaited<ReturnType<ReconstructionRepository["publishResult"]>>);
  }

  failAttempt(command: Parameters<ReconstructionRepository["failAttempt"]>[0]) {
    if (this.fencePublication) return Promise.reject(new Error("synthetic-fence"));
    this.failures.push({ retryable: command.retryable, safeCode: command.safeCode });
    return Promise.resolve({} as Awaited<ReturnType<ReconstructionRepository["failAttempt"]>>);
  }

  acknowledgeCancellation(): Promise<void> {
    this.acknowledgements += 1;
    return Promise.resolve();
  }
}

class MemoryStorage implements ObjectStorage {
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  openSource(): Promise<AsyncIterable<Uint8Array>> {
    const bytes = this.bytes;
    return Promise.resolve(
      (async function* stream() {
        await Promise.resolve();
        yield bytes;
      })(),
    );
  }

  putDerivedIfAbsent(): Promise<"created"> {
    return Promise.resolve("created");
  }
}

class MemoryProcessor implements ReconstructionProcessor {
  failure?: ReconstructionWorkerError;
  calls: string[] = [];

  abstain(
    job: LeasedReconstructionAttempt,
    _prepared: MediaPreparationManifest | undefined,
    safeCode: string,
  ): Promise<ReconstructionResult> {
    this.calls.push(`abstain:${safeCode}`);
    return Promise.resolve(abstention(job, safeCode));
  }

  process(job: LeasedReconstructionAttempt): Promise<ReconstructionResult> {
    this.calls.push("process");
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve(abstention(job, "COLMAP_NOT_INSTALLED"));
  }
}

const logger = {
  debug() {},
  error() {},
  info() {},
  warn(event: string, fields?: Readonly<Record<string, unknown>>) {
    if (process.env.DEBUG_C8_TEST === "true") console.warn(event, fields);
  },
};

async function fixture(options: { readonly privacyAccepted?: boolean } = {}) {
  const bytes = await syntheticPng();
  const reconstructionSource = source(bytes);
  const durableLease = lease(reconstructionSource);
  const queue = new MemoryQueue(durableLease);
  const processor = new MemoryProcessor();
  const storage = new MemoryStorage(bytes);
  const root = await temporaryRoot();
  const runner = new ReconstructionProcessingRunner({
    logger,
    media: new MediaPreparationPipeline({
      ...(options.privacyAccepted === false ? {} : { privacyReviewer: acceptingPrivacyReviewer }),
      process: new SyntheticMediaProcess(),
      temporaryRoot: root,
    }),
    pollMilliseconds: 1,
    processor,
    queue,
    sources: { load: () => Promise.resolve([reconstructionSource]) },
    storage,
    workerId: "c8-synthetic-worker",
  });
  return { processor, queue, root, runner };
}

describe("C8 composed reconstruction runner", () => {
  it("prepares exact sources, advances the durable stages and publishes a fenced result", async () => {
    const { processor, queue, root, runner } = await fixture();
    await expect(runner.processNext()).resolves.toBe("processed");
    expect(queue.advances).toEqual(["ready-for-reconstruction", "reconstructing-geometry"]);
    expect(processor.calls).toEqual(["process"]);
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0]).toMatchObject({ safeCode: "COLMAP_NOT_INSTALLED" });
    expect(await readdir(root)).toEqual([]);
  });

  it("fails closed before geometry when privacy review has not accepted frames", async () => {
    const { processor, queue, runner } = await fixture({ privacyAccepted: false });
    await runner.processNext();
    expect(queue.advances).toEqual([]);
    expect(processor.calls).toEqual(["abstain:RECONSTRUCTION_PRIVACY_REVIEW_REQUIRED"]);
    expect(queue.published[0]).toMatchObject({
      safeCode: "RECONSTRUCTION_PRIVACY_REVIEW_REQUIRED",
    });
  });

  it("records a bounded retryable worker failure without publishing", async () => {
    const { processor, queue, runner } = await fixture();
    processor.failure = new ReconstructionWorkerError("RECONSTRUCTION_STORAGE_UNAVAILABLE", {
      retryable: true,
    });
    await runner.processNext();
    expect(queue.published).toEqual([]);
    expect(queue.failures).toEqual([
      { retryable: true, safeCode: "RECONSTRUCTION_STORAGE_UNAVAILABLE" },
    ]);
  });

  it("acknowledges cancellation when the final durable publication fence closes", async () => {
    const { queue, runner } = await fixture();
    queue.fencePublication = true;
    await runner.processNext();
    expect(queue.published).toEqual([]);
    expect(queue.acknowledgements).toBe(1);
  });

  it("reports idle without a second lease", async () => {
    const { runner } = await fixture();
    await runner.processNext();
    await expect(runner.processNext()).resolves.toBe("idle");
  });
});
