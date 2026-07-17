import type { LeasedReconstructionAttempt } from "@interior-design/platform-api/reconstruction";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MediaPreparationPipeline } from "../../src/media-prep/index.js";
import { PythonReconstructionProcessor } from "../../src/reconstruction/processor.js";
import type { DerivedWrite, ObjectStorage } from "../../src/storage.js";
import {
  acceptingPrivacyReviewer,
  jobId,
  projectId,
  sourceFor,
  SyntheticMediaProcess,
  syntheticPng,
} from "../media-prep/fixtures.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c8-processor-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

class CapturingStorage implements ObjectStorage {
  writes: Array<DerivedWrite & { readonly bytes: Buffer }> = [];

  openSource(): Promise<AsyncIterable<Uint8Array>> {
    return Promise.reject(new Error("The processor receives only prepared streams."));
  }

  async putDerivedIfAbsent(write: DerivedWrite): Promise<"created"> {
    this.writes.push({ ...write, bytes: await readFile(write.filePath) });
    return "created";
  }
}

describe("C8 private Python reconstruction protocol", () => {
  it("runs real host discovery and publishes an honest bounded abstention when COLMAP is absent", async () => {
    const root = await temporaryRoot();
    const first = sourceFor(await syntheticPng(), {
      assetId: "61926662-21a7-573e-a768-c35f5583badb",
      detectedMimeType: "video/mp4",
      kind: "rgb-video",
    });
    const sourceManifestSha256 = "9".repeat(64);
    const mediaProcess = new SyntheticMediaProcess();
    mediaProcess.frameCount = 2;
    mediaProcess.probe = {
      ...mediaProcess.probe,
      codecName: "h264",
      duration: "2",
      formatName: "mov,mp4",
    };
    const prepared = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      process: mediaProcess,
      temporaryRoot: root,
    }).prepare({
      jobId,
      projectId,
      sourceManifestSha256,
      sources: [first],
    });
    const storage = new CapturingStorage();
    const lease: LeasedReconstructionAttempt = {
      attempt: 1,
      jobId,
      leaseExpiresAt: "2026-07-17T23:00:00.000Z",
      leaseToken: "c7b7f20e-0d91-4fe5-af30-ee25c8b6e39a",
      projectId,
      request: {
        appearanceMode: "optional",
        label: "Visibly synthetic protocol fixture",
        mode: "rgb-sfm",
        registrationAnchors: [],
        rights: {
          basis: "owned-by-user",
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        sources: [first.descriptor],
      },
      sourceManifestSha256,
      stage: "reconstructing-geometry",
      tenantId: "4e7fc4ea-0c12-462f-9ddd-b541dc60f008",
    };
    const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
    const processor = new PythonReconstructionProcessor({
      pythonCommand: path.join(repositoryRoot, ".venv/bin/python"),
      pythonModuleRoot: path.join(repositoryRoot, "services/inference-worker/src"),
      storage,
      temporaryRoot: root,
    });
    const result = await processor.process(lease, prepared);
    expect(result).toMatchObject({ safeCode: "COLMAP_NOT_INSTALLED", status: "abstained" });
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]).toMatchObject({
      bucket: "derived",
      contentType: "application/json",
    });
    expect(storage.writes[0]?.key).not.toContain("file:");
    expect(storage.writes[0]?.bytes.toString("utf8")).toContain("COLMAP_NOT_INSTALLED");
    await prepared.cleanup();
    expect(await readdir(root)).toEqual([]);
  });
});
