import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { MediaProcessor } from "../src/processor.js";
import { validatePixelEnvelope, validateVideoDurationMilliseconds } from "../src/inspectors.js";
import {
  commandFor,
  jpegFixture,
  MemoryObjectStorage,
  onePagePdfFixture,
  sha256,
  testConfig,
} from "./support.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c2-worker-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("provider-free hostile media processor", () => {
  it("enforces the frozen pixel-area and 30-minute boundaries with overflow-safe arithmetic", () => {
    expect(() => {
      validatePixelEnvelope(10_000, 10_000);
    }).not.toThrow();
    expect(() => {
      validatePixelEnvelope(10_001, 10_000);
    }).toThrow("resource-limit");
    expect(() => {
      validatePixelEnvelope(Number.MAX_SAFE_INTEGER, 2);
    }).toThrow("resource-limit");
    expect(() => {
      validateVideoDurationMilliseconds(1_800_000);
    }).not.toThrow();
    expect(() => {
      validateVideoDurationMilliseconds(1_800_001);
    }).toThrow("resource-limit");
  });

  it("streams the whole source and rejects a checksum mismatch before media work", async () => {
    const contents = await jpegFixture();
    const command = commandFor(contents, { sha256: "a".repeat(64) });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      artifacts: [],
      rejectionCode: "checksum-mismatch",
      status: "rejected",
      verifiedSource: { byteSize: contents.byteLength, sha256: sha256(contents) },
    });
    expect(prepared.writes).toHaveLength(0);
    await prepared.cleanup();
  });

  it("rejects declared and detected signature disagreement", async () => {
    const contents = await jpegFixture();
    const command = commandFor(contents, { declaredMimeType: "image/png" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      detectedMimeType: "image/jpeg",
      rejectionCode: "signature-mismatch",
      status: "rejected",
    });
    await prepared.cleanup();
  });

  it("fails malformed content closed after a valid leading signature", async () => {
    const valid = await jpegFixture();
    const contents = valid.subarray(0, Math.max(24, Math.floor(valid.byteLength / 3)));
    const command = commandFor(contents);
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({ rejectionCode: "malformed-media", status: "rejected" });
    await prepared.cleanup();
  });

  it("creates deterministic metadata-stripped previews and an honest provenance manifest", async () => {
    const contents = await jpegFixture({ withMetadata: true });
    const command = commandFor(contents);
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);
    const executedAt = "2026-07-17T10:00:00.000Z";

    const first = await processor.process({ command, executedAt });
    const second = await processor.process({ command, executedAt });
    expect(first.result).toMatchObject({
      detectedMimeType: "image/jpeg",
      status: "ready",
      technicalMetadata: { heightPixels: 12, widthPixels: 16 },
    });
    expect(first.result.artifacts).toHaveLength(3);
    expect(second.result.artifacts).toEqual(first.result.artifacts);

    const preview = first.writes.find((write) => write.contentType === "image/jpeg");
    const manifest = first.writes.find((write) => write.contentType === "application/json");
    expect(preview).toBeDefined();
    expect(manifest).toBeDefined();
    if (preview === undefined || manifest === undefined)
      throw new Error("Expected derived artifacts.");
    const previewMetadata = await sharp(preview.filePath).metadata();
    expect(previewMetadata.exif).toBeUndefined();
    expect(previewMetadata.icc).toBeUndefined();
    expect(previewMetadata.xmp).toBeUndefined();
    const manifestText = await readFile(manifest.filePath, "utf8");
    expect(manifestText).toContain('"antivirus": "not-configured"');
    expect(manifestText).toContain('"metadataStrippedFromRasterOutputs": true');
    expect(manifestText).not.toContain(command.source.key);
    expect(manifestText).not.toContain("synthetic-private-metadata");

    await first.cleanup();
    await second.cleanup();
  });

  it("rejects SVG external resources and never emits raw SVG", async () => {
    const contents = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.invalid/a.png"/></svg>',
      "utf8",
    );
    const command = commandFor(contents, { declaredMimeType: "image/svg+xml", kind: "plan" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      rejectionCode: "unsupported-type",
      status: "rejected",
    });
    expect(prepared.writes).toHaveLength(0);
    await prepared.cleanup();
  });

  it("enforces image dimensions before raster output", async () => {
    const contents = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20001" height="1"><rect width="1" height="1"/></svg>',
      "utf8",
    );
    const command = commandFor(contents, { declaredMimeType: "image/svg+xml", kind: "plan" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({ rejectionCode: "resource-limit", status: "rejected" });
    await prepared.cleanup();
  });

  it("rejects HEIC honestly when no decoder path is supported", async () => {
    const contents = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00,
      0x00, 0x68, 0x65, 0x69, 0x63, 0x6d, 0x69, 0x66, 0x31,
    ]);
    const command = commandFor(contents, { declaredMimeType: "image/heic" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      rejectionCode: "unsupported-type",
      status: "rejected",
    });
    await prepared.cleanup();
  });

  it("supports a typed quarantine result only when an explicit scanner adapter signals suspicion", async () => {
    const contents = await jpegFixture();
    const command = commandFor(contents);
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage, {
      assess: () => Promise.resolve("malware-suspected"),
      tool: { name: "synthetic-threat-adapter", version: "test-only" },
    });

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      artifacts: [],
      rejectionCode: "malware-suspected",
      status: "quarantined",
    });
    expect(prepared.result.provenance.tools.map((tool) => tool.name)).toContain(
      "synthetic-threat-adapter",
    );
    await prepared.cleanup();
  });

  it("inspects and rasterises a tiny synthetic PDF", async () => {
    const contents = onePagePdfFixture();
    const command = commandFor(contents, { declaredMimeType: "application/pdf", kind: "document" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(await temporaryRoot()), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      detectedMimeType: "application/pdf",
      status: "ready",
      technicalMetadata: { pageCount: 1 },
    });
    expect(prepared.result.provenance.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["pdfinfo", "pdftoppm", "sharp"]),
    );
    await prepared.cleanup();
  });
});
