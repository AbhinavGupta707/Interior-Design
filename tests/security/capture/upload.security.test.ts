import { describe, expect, it } from "vitest";

import {
  inspectBoundArtifact,
  ReferenceMultipartLedger,
  type CompletedPart,
} from "./reference-boundary.js";
import {
  syntheticJSONArtifact,
  syntheticJSONBytes,
  syntheticUSDZArtifact,
  syntheticUSDZBytes,
} from "./synthetic-security-fixtures.js";

const uploadSessionId = "44444444-4444-4444-8444-444444444444";
const expiresAt = "2026-07-17T12:05:00.000Z";
const now = Date.parse("2026-07-17T12:00:00.000Z");
const firstChecksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const secondChecksum = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

describe("C7 checksum-bound multipart and artifact security", () => {
  it("accepts exact JSON and USDZ bindings with matching media signatures", () => {
    expect(() =>
      inspectBoundArtifact(syntheticJSONArtifact, syntheticJSONArtifact, syntheticJSONBytes),
    ).not.toThrow();
    expect(() =>
      inspectBoundArtifact(syntheticUSDZArtifact, syntheticUSDZArtifact, syntheticUSDZBytes),
    ).not.toThrow();
  });

  it("rejects artifact substitution before inspecting attacker-controlled bytes", () => {
    expect(() =>
      inspectBoundArtifact(
        syntheticJSONArtifact,
        { ...syntheticJSONArtifact, kind: "quality-manifest-json" },
        syntheticJSONBytes,
      ),
    ).toThrow("ARTIFACT_SUBSTITUTION");
    expect(() =>
      inspectBoundArtifact(
        syntheticJSONArtifact,
        { ...syntheticJSONArtifact, artifactId: syntheticUSDZArtifact.artifactId },
        syntheticJSONBytes,
      ),
    ).toThrow("ARTIFACT_SUBSTITUTION");
  });

  it("rejects signature/type, byte-size and checksum mismatches", () => {
    const jsonClaimingUSDZ = {
      ...syntheticUSDZArtifact,
      byteSize: syntheticJSONBytes.byteLength,
      sha256: syntheticJSONArtifact.sha256,
    };
    expect(() =>
      inspectBoundArtifact(jsonClaimingUSDZ, jsonClaimingUSDZ, syntheticJSONBytes),
    ).toThrow("MEDIA_SIGNATURE_MISMATCH");
    expect(() =>
      inspectBoundArtifact(
        syntheticJSONArtifact,
        syntheticJSONArtifact,
        syntheticJSONBytes.slice(1),
      ),
    ).toThrow("ARTIFACT_BYTE_MISMATCH");
    const corrupted = Uint8Array.from(syntheticJSONBytes);
    corrupted[corrupted.length - 2] = 0x58;
    expect(() =>
      inspectBoundArtifact(syntheticJSONArtifact, syntheticJSONArtifact, corrupted),
    ).toThrow("ARTIFACT_HASH_MISMATCH");
  });

  it("makes exact part replay idempotent and conflicting replay fail closed", () => {
    const ledger = new ReferenceMultipartLedger(uploadSessionId);
    const part = completedPart(1, firstChecksum);
    expect(ledger.record(part, expiresAt, now)).toBe("accepted");
    expect(ledger.record(part, expiresAt, now)).toBe("replayed");
    expect(() => ledger.record(completedPart(1, secondChecksum), expiresAt, now)).toThrow(
      "PART_REPLAY_CONFLICT",
    );
  });

  it("rejects foreign-session, expired, out-of-order and missing completion parts", () => {
    const ledger = new ReferenceMultipartLedger(uploadSessionId);
    expect(() =>
      ledger.record(
        { ...completedPart(1, firstChecksum), uploadSessionId: "foreign-upload-session" },
        expiresAt,
        now,
      ),
    ).toThrow("UPLOAD_SESSION_MISMATCH");
    expect(() =>
      ledger.record(completedPart(1, firstChecksum), expiresAt, Date.parse(expiresAt)),
    ).toThrow("SIGNED_URL_EXPIRED");

    ledger.record(completedPart(1, firstChecksum), expiresAt, now);
    ledger.record(completedPart(2, secondChecksum), expiresAt, now);
    expect(() =>
      ledger.complete([completedPart(2, secondChecksum), completedPart(1, firstChecksum)]),
    ).toThrow("PARTS_NOT_CONSECUTIVE");
    expect(() =>
      ledger.complete([completedPart(1, firstChecksum), completedPart(3, secondChecksum)]),
    ).toThrow("PARTS_NOT_CONSECUTIVE");
  });

  it("leaves interrupted completion resumable and fences a different terminal replay", () => {
    const ledger = new ReferenceMultipartLedger(uploadSessionId);
    const parts = [completedPart(1, firstChecksum), completedPart(2, secondChecksum)] as const;
    for (const part of parts) ledger.record(part, expiresAt, now);

    expect(() => ledger.complete(parts, true)).toThrow("COMPLETION_INTERRUPTED");
    expect(ledger.state).toBe("uploading");
    expect(ledger.complete(parts)).toBe("completed");
    expect(ledger.complete(parts)).toBe("replayed");
    expect(() => ledger.complete([completedPart(1, firstChecksum)])).toThrow(
      "COMPLETION_REPLAY_CONFLICT",
    );
  });
});

function completedPart(partNumber: number, checksumSha256: string): CompletedPart {
  return { checksumSha256, partNumber, uploadSessionId };
}
