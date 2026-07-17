import {
  reconstructionArtifactSchema,
  reconstructionResultSchema,
  type MediaPreparationManifest,
  type ReconstructionArtifact,
  type ReconstructionResult,
} from "@interior-design/contracts";
import type { LeasedReconstructionAttempt } from "@interior-design/platform-api/reconstruction";
import { createHash } from "node:crypto";
import { open, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  canonicalJson,
  canonicalSha256,
  deterministicUuid,
  sha256Hex,
} from "../media-prep/canonical.js";
import type { PreparedMediaBundle } from "../media-prep/index.js";
import type { ObjectStorage } from "../storage.js";
import { ProcessExecutionError, runBoundedProcess } from "../subprocess.js";
import { ReconstructionWorkerError, type ReconstructionProcessor } from "./types.js";

const privateArtifactSchema = z
  .object({ artifact: reconstructionArtifactSchema, privatePath: z.string().min(1) })
  .strict();
const bridgeSchema = z
  .object({
    privateArtifacts: z.array(privateArtifactSchema).max(64),
    result: z.record(z.string(), z.unknown()),
  })
  .strict();

export interface PythonReconstructionProcessorOptions {
  readonly clock?: { now(): Date };
  readonly maximumOutputBytes?: number;
  readonly processTimeoutMilliseconds?: number;
  readonly pythonCommand?: string;
  readonly pythonModuleRoot: string;
  readonly storage: ObjectStorage;
  readonly temporaryRoot: string;
}

async function stageFrame(
  destination: string,
  source: AsyncIterable<Uint8Array>,
  expectedSha256: string,
  signal?: AbortSignal,
): Promise<void> {
  const handle = await open(destination, "wx", 0o600);
  const digest = createHash("sha256");
  try {
    for await (const chunk of source) {
      if (signal?.aborted === true) throw new ReconstructionWorkerError("RECONSTRUCTION_CANCELLED");
      digest.update(chunk);
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  if (digest.digest("hex") !== expectedSha256) {
    throw new ReconstructionWorkerError("RECONSTRUCTION_PREPARED_FRAME_MISMATCH");
  }
}

function publicArtifact(value: ReconstructionArtifact): ReconstructionArtifact {
  return reconstructionArtifactSchema.parse(value);
}

export class PythonReconstructionProcessor implements ReconstructionProcessor {
  readonly #clock: { now(): Date };
  readonly #maximumOutputBytes: number;
  readonly #processTimeoutMilliseconds: number;
  readonly #pythonCommand: string;
  readonly #pythonModuleRoot: string;
  readonly #storage: ObjectStorage;
  readonly #temporaryRoot: string;

  constructor(options: PythonReconstructionProcessorOptions) {
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#maximumOutputBytes = options.maximumOutputBytes ?? 1_048_576;
    this.#processTimeoutMilliseconds = options.processTimeoutMilliseconds ?? 86_400_000;
    this.#pythonCommand = options.pythonCommand ?? "python3";
    this.#pythonModuleRoot = path.resolve(options.pythonModuleRoot);
    this.#storage = options.storage;
    this.#temporaryRoot = path.resolve(options.temporaryRoot);
  }

  async abstain(
    lease: LeasedReconstructionAttempt,
    prepared: MediaPreparationManifest | undefined,
    safeCode: string,
    signal?: AbortSignal,
  ): Promise<ReconstructionResult> {
    const root = await mkdtemp(path.join(this.#temporaryRoot, "c8-abstention-"));
    try {
      const diagnosticPayload = {
        authority: "proposal-only",
        findings: [{ code: safeCode, count: 1 }],
        preparedManifestSha256: prepared?.manifestSha256,
        schemaVersion: "c8-reconstruction-diagnostics-v1",
      };
      const filePath = path.join(root, "diagnostics.json");
      const bytes = Buffer.from(canonicalJson(diagnosticPayload), "utf8");
      await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
      const tool = {
        adapterId: "c8.worker-composition",
        adapterVersion: "1.0.0",
        configSha256: canonicalSha256({ policy: "abstention-v1" }),
        executableVersion: "internal",
      } as const;
      const artifact = publicArtifact({
        artifactId: deterministicUuid(`c8:diagnostic:${sha256Hex(bytes)}`),
        byteSize: bytes.byteLength,
        contentSha256: sha256Hex(bytes),
        dimensionalAuthority: "proposal-only",
        kind: "diagnostics",
        mediaType: "application/json",
        sourceManifestSha256: lease.sourceManifestSha256,
        toolManifestSha256: canonicalSha256(tool),
      });
      await this.#upload(lease, artifact, filePath, signal);
      return reconstructionResultSchema.parse({
        createdAt: this.#clock.now().toISOString(),
        diagnosticArtifact: artifact,
        findings: [safeCode],
        jobId: lease.jobId,
        projectId: lease.projectId,
        resultId: this.#resultId(lease, safeCode),
        safeCode,
        schemaVersion: "c8-reconstruction-result-v1",
        sourceManifestSha256: lease.sourceManifestSha256,
        status: "abstained",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }

  async process(
    lease: LeasedReconstructionAttempt,
    prepared: PreparedMediaBundle,
    signal?: AbortSignal,
  ): Promise<ReconstructionResult> {
    if (prepared.frames.length < 2) {
      return this.abstain(lease, prepared.manifest, "RECONSTRUCTION_INSUFFICIENT_FRAMES", signal);
    }
    const root = await mkdtemp(path.join(this.#temporaryRoot, "c8-reconstruction-"));
    try {
      const inputRoot = path.join(root, "inputs");
      await mkdir(inputRoot, { mode: 0o700 });
      const protocolFrames = [];
      for (const [index, frame] of prepared.frames.entries()) {
        const manifestFrame = prepared.manifest.frames[index];
        if (manifestFrame === undefined || manifestFrame.frameId !== frame.frameId) {
          throw new ReconstructionWorkerError("RECONSTRUCTION_PREPARED_FRAME_MISMATCH");
        }
        const framePath = path.join(inputRoot, `frame-${String(index).padStart(6, "0")}.png`);
        await stageFrame(framePath, frame.open(), manifestFrame.sanitizedSha256, signal);
        protocolFrames.push({
          frameId: frame.frameId,
          path: framePath,
          sha256: manifestFrame.sanitizedSha256,
        });
      }
      const requestPath = path.join(root, "request.json");
      const resultPath = path.join(root, "result.json");
      await writeFile(
        requestPath,
        canonicalJson({
          attempt: lease.attempt,
          appearanceMode: lease.request.appearanceMode,
          frames: protocolFrames,
          inputRoot,
          jobId: lease.jobId,
          jobSourceManifestSha256: lease.sourceManifestSha256,
          mode: lease.request.mode,
          prepared: prepared.manifest,
          projectId: lease.projectId,
          registrationAnchors: lease.request.registrationAnchors.map((anchor) => ({
            anchorId: anchor.anchorId,
            source: anchor.sourcePointMicrometres,
            target: anchor.targetPointMicrometres,
          })),
          rights: lease.request.rights,
        }),
        { flag: "wx", mode: 0o600 },
      );
      try {
        await runBoundedProcess(
          this.#pythonCommand,
          [
            "-m",
            "inference_worker.reconstruction.worker_protocol",
            "--request",
            requestPath,
            "--result",
            resultPath,
          ],
          {
            maximumOutputBytes: this.#maximumOutputBytes,
            timeoutMs: this.#processTimeoutMilliseconds,
          },
          signal,
          { cwd: this.#pythonModuleRoot },
        );
      } catch (error) {
        const retryable =
          error instanceof ProcessExecutionError && ["spawn", "timeout"].includes(error.reason);
        throw new ReconstructionWorkerError("RECONSTRUCTION_INFERENCE_PROCESS_FAILED", {
          cause: error,
          retryable,
        });
      }
      const envelope = bridgeSchema.parse(JSON.parse(await readFile(resultPath, "utf8")));
      await this.#publishPrivateArtifacts(lease, root, envelope.privateArtifacts, signal);
      const result = reconstructionResultSchema.parse({
        ...envelope.result,
        createdAt: this.#clock.now().toISOString(),
        jobId: lease.jobId,
        projectId: lease.projectId,
        resultId: this.#resultId(lease, canonicalSha256(envelope.result)),
        schemaVersion: "c8-reconstruction-result-v1",
        sourceManifestSha256: lease.sourceManifestSha256,
      });
      return result;
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }

  async #publishPrivateArtifacts(
    lease: LeasedReconstructionAttempt,
    root: string,
    records: readonly z.infer<typeof privateArtifactSchema>[],
    signal?: AbortSignal,
  ): Promise<void> {
    const rootPath = await realpath(root);
    for (const record of records) {
      const filePath = await realpath(record.privatePath);
      if (!filePath.startsWith(`${rootPath}${path.sep}`)) {
        throw new ReconstructionWorkerError("RECONSTRUCTION_ARTIFACT_SCOPE_MISMATCH");
      }
      const file = await stat(filePath);
      if (!file.isFile() || file.isSymbolicLink() || file.size !== record.artifact.byteSize) {
        throw new ReconstructionWorkerError("RECONSTRUCTION_ARTIFACT_MISMATCH");
      }
      const bytes = await readFile(filePath);
      if (sha256Hex(bytes) !== record.artifact.contentSha256) {
        throw new ReconstructionWorkerError("RECONSTRUCTION_ARTIFACT_MISMATCH");
      }
      await this.#upload(lease, record.artifact, filePath, signal);
    }
  }

  async #upload(
    lease: LeasedReconstructionAttempt,
    artifact: ReconstructionArtifact,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#storage.putDerivedIfAbsent(
      {
        bucket: "derived",
        byteSize: artifact.byteSize,
        contentType: artifact.mediaType,
        filePath,
        key: [
          "reconstruction",
          lease.tenantId,
          lease.projectId,
          lease.jobId,
          `attempt-${String(lease.attempt)}`,
          artifact.kind,
          artifact.contentSha256,
        ].join("/"),
        sha256: artifact.contentSha256,
      },
      signal,
    );
  }

  #resultId(lease: LeasedReconstructionAttempt, discriminator: string): string {
    return deterministicUuid(
      `c8:result:${lease.jobId}:${String(lease.attempt)}:${lease.sourceManifestSha256}:${discriminator}`,
    );
  }
}
