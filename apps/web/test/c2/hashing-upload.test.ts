import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvidenceFileName } from "../../src/features/evidence/evidence-workspace";
import type { ReconciledUploadSession } from "../../src/features/evidence/api";
import {
  bytesToBase64,
  bytesToHex,
  hashBlob,
  IncrementalSha256,
} from "../../src/features/evidence/hashing";
import {
  reconcileRecordedParts,
  SelectionProblem,
  validateFile,
} from "../../src/features/evidence/upload";
import type { RecoveryRecord } from "../../src/features/evidence/recovery";

describe("C2 browser hashing and edge validation", () => {
  it("matches the SHA-256 standard vector across incremental chunks", () => {
    const encoder = new TextEncoder();
    const hasher = new IncrementalSha256();
    hasher.update(encoder.encode("a"));
    hasher.update(encoder.encode("bc"));

    expect(bytesToHex(hasher.digest())).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes blobs without reading the complete file in one allocation", async () => {
    const digest = await hashBlob(new Blob(["synthetic-plan"]));
    expect(bytesToHex(digest)).toHaveLength(64);
    expect(bytesToBase64(digest)).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
  });

  it("accepts only the kind-specific frozen MIME allowlist", () => {
    const valid = new File(["synthetic"], "sample-plan.pdf", { type: "application/pdf" });
    expect(validateFile(valid, "plan")).toBe("application/pdf");

    const unsupported = new File(["synthetic"], "notes.txt", { type: "text/plain" });
    expect(() => validateFile(unsupported, "document")).toThrow(SelectionProblem);
  });

  it("rejects path-bearing names and files above the frozen two GiB ceiling", () => {
    const pathName = new File(["synthetic"], "plan.pdf", { type: "application/pdf" });
    Object.defineProperty(pathName, "name", { value: "../plan.pdf" });
    expect(() => validateFile(pathName, "plan")).toThrow(/path or control/u);

    const oversized = new File(["synthetic"], "plan.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 2_147_483_649 });
    expect(() => validateFile(oversized, "plan")).toThrow(/2 GiB/u);
  });

  it("intersects local completion tokens with the sorted server-recorded part list", () => {
    const record: RecoveryRecord = {
      assetId: "55555555-5555-4555-8555-555555555555",
      completedParts: [
        { checksumSha256: "A".repeat(44), etag: "part-three", partNumber: 3 },
        { checksumSha256: "B".repeat(44), etag: "part-one", partNumber: 1 },
      ],
      completionKey: "complete-test",
      fileName: "synthetic-plan.pdf",
      kind: "plan",
      partSize: 5_242_880,
      projectId: "33333333-3333-4333-8333-333333333333",
      sessionId: "44444444-4444-4444-8444-444444444444",
      sha256: "a".repeat(64),
      updatedAt: "2026-07-17T12:00:00.000Z",
    };
    const session = {
      asset: {
        createdAt: "2026-07-17T12:00:00.000Z",
        declaredMimeType: "application/pdf",
        fileName: record.fileName,
        id: record.assetId,
        kind: "plan",
        projectId: record.projectId,
        rights: {
          basis: "owned-by-user",
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        source: { byteSize: 32, sha256: record.sha256 },
        status: "uploading",
        updatedAt: "2026-07-17T12:00:00.000Z",
      },
      expiresAt: "2026-07-17T13:00:00.000Z",
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 5_242_880,
      partSize: record.partSize,
      recordedPartNumbers: [2, 1, 2],
      sessionId: record.sessionId,
      state: "uploading",
    } satisfies ReconciledUploadSession;

    const reconciled = reconcileRecordedParts(record, session);

    expect(reconciled.completedParts.map((part) => part.partNumber)).toEqual([1]);
    expect(reconciled.completedParts[0]?.etag).toBe("part-one");
  });

  it("renders adversarial filenames as bidi-contained escaped plain text", () => {
    const markup = renderToStaticMarkup(
      createElement(EvidenceFileName, { value: "\u202E<img src=x onerror=alert(1)>.pdf" }),
    );

    expect(markup).toContain("<bdi");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;.pdf");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("href=");
  });
});
