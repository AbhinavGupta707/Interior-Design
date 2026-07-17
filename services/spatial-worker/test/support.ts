import {
  assetProcessingCommandSchema,
  type AssetProcessingCommand,
  type AssetProcessingResult,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";

import { parseWorkerConfig, type WorkerConfig } from "../src/config.js";
import type { LeasedProcessingJob, ProcessingJobRepository, RetryOutcome } from "../src/jobs.js";
import type { DerivedWrite, ObjectStorage } from "../src/storage.js";

export const assetId = "5ad284ff-31de-4e0a-b77a-45aaee2a9283";
export const projectId = "719f83b4-937d-40ab-a079-4d59a2086381";
export const tenantId = "2d4a2c2d-2b2f-498a-a19a-a4c4268d45b2";

export function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export function commandFor(
  contents: Uint8Array,
  overrides: Partial<AssetProcessingCommand["expected"]> = {},
): AssetProcessingCommand {
  return assetProcessingCommandSchema.parse({
    assetId,
    attempt: 1,
    destinations: {
      derivedBucket: "derived",
      prefix: `projects/${projectId}/assets/${assetId}`,
      quarantineBucket: "quarantine",
    },
    expected: {
      byteSize: contents.byteLength,
      declaredMimeType: "image/jpeg",
      kind: "photograph",
      sha256: sha256(contents),
      ...overrides,
    },
    projectId,
    source: { bucket: "source", key: `projects/${projectId}/assets/${assetId}/source` },
    version: "c2-ingest-v1",
  });
}

export function testConfig(temporaryRoot: string): WorkerConfig {
  return parseWorkerConfig({
    C2_TEMP_ROOT: temporaryRoot,
    C2_WORKER_ID: "test-worker",
    NODE_ENV: "test",
  });
}

export async function jpegFixture(
  options: { readonly withMetadata?: boolean } = {},
): Promise<Buffer> {
  let image = sharp({
    create: { background: { b: 80, g: 40, r: 20 }, channels: 3, height: 12, width: 16 },
  }).jpeg({ chromaSubsampling: "4:2:0", quality: 90 });
  if (options.withMetadata === true) {
    image = image.withExif({ IFD0: { ImageDescription: "synthetic-private-metadata" } });
  }
  return image.toBuffer();
}

export function onePagePdfFixture(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R /Resources << >> >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

export class MemoryObjectStorage implements ObjectStorage {
  readonly derived = new Map<string, { readonly bytes: Buffer; readonly sha256: string }>();
  readonly sources = new Map<string, Buffer>();
  failNextDerivedWrite = false;
  sourceOpenCount = 0;

  openSource(_bucket: "source", key: string): Promise<AsyncIterable<Uint8Array>> {
    this.sourceOpenCount += 1;
    const contents = this.sources.get(key);
    if (contents === undefined) throw new Error("missing synthetic source");
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < contents.byteLength; offset += 7) {
      chunks.push(contents.subarray(offset, offset + 7));
    }
    return Promise.resolve(Readable.from(chunks));
  }

  async putDerivedIfAbsent(write: DerivedWrite): Promise<"created" | "existing"> {
    if (this.failNextDerivedWrite) {
      this.failNextDerivedWrite = false;
      throw new Error("synthetic storage outage");
    }
    const bytes = await readFile(write.filePath);
    const existing = this.derived.get(write.key);
    if (existing !== undefined) {
      if (existing.sha256 !== write.sha256 || !existing.bytes.equals(bytes)) {
        throw new Error("synthetic content-address collision");
      }
      return "existing";
    }
    this.derived.set(write.key, { bytes, sha256: write.sha256 });
    return "created";
  }
}

export class MemoryJobRepository implements ProcessingJobRepository {
  readonly completed: AssetProcessingResult[] = [];
  readonly retried: string[] = [];
  available = true;
  attempt = 0;
  leaseRenewalSucceeds = true;
  retryOutcome: RetryOutcome = "retrying";
  readonly #baseCommand: AssetProcessingCommand;
  readonly #executionStartedAt: string;

  constructor(command: AssetProcessingCommand, executionStartedAt = "2026-07-17T10:00:00.000Z") {
    this.#baseCommand = command;
    this.#executionStartedAt = executionStartedAt;
  }

  claim(workerId: string, leaseMs: number): Promise<LeasedProcessingJob | undefined> {
    if (!this.available) return Promise.resolve(undefined);
    this.available = false;
    this.attempt += 1;
    return Promise.resolve({
      command: assetProcessingCommandSchema.parse({ ...this.#baseCommand, attempt: this.attempt }),
      executionStartedAt: this.#executionStartedAt,
      jobId: "91fef3df-4a0f-4f35-909d-d7a451ac6057",
      leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
      leaseToken: "746bc869-a24d-4146-8b6a-830115090d5a",
      tenantId,
      workerId,
    });
  }

  complete(_job: LeasedProcessingJob, result: AssetProcessingResult): Promise<boolean> {
    this.completed.push(result);
    return Promise.resolve(true);
  }

  renew(): Promise<boolean> {
    return Promise.resolve(this.leaseRenewalSucceeds);
  }

  retry(_job: LeasedProcessingJob, safeErrorCode: string): Promise<RetryOutcome> {
    this.retried.push(safeErrorCode);
    if (this.retryOutcome === "retrying") this.available = true;
    return Promise.resolve(this.retryOutcome);
  }
}
