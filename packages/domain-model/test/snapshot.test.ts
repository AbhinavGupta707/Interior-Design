/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canonicalizeHomeSnapshot,
  hashCanonicalHomeSnapshot,
  parseCanonicalHomeSnapshotJson,
  roundTripCanonicalHomeSnapshot,
  selectCanonicalHomeSnapshotForProfile,
  SnapshotCanonicalizationError,
  validateCanonicalHomeSnapshot,
  verifyModelSnapshotRecord,
} from "../src/index.js";
import {
  reverseObjectInsertionOrder,
  syntheticCanonicalSnapshot,
  syntheticIds,
} from "./fixture.js";
import { GOLDEN_SNAPSHOT_BYTE_LENGTH, GOLDEN_SNAPSHOT_SHA256 } from "./golden.js";

describe("canonical home snapshots", () => {
  it("has a retained golden digest independent of object insertion order", () => {
    const direct = canonicalizeHomeSnapshot(syntheticCanonicalSnapshot);
    const reordered = canonicalizeHomeSnapshot(
      reverseObjectInsertionOrder(syntheticCanonicalSnapshot),
    );
    expect(direct.snapshotSha256).toBe(GOLDEN_SNAPSHOT_SHA256);
    expect(direct.canonicalByteLength).toBe(GOLDEN_SNAPSHOT_BYTE_LENGTH);
    expect(reordered.canonicalJson).toBe(direct.canonicalJson);
    expect(reordered.snapshotSha256).toBe(direct.snapshotSha256);
  });

  it("sorts only declared entity, reference, and limitation sets", () => {
    const canonical = canonicalizeHomeSnapshot(syntheticCanonicalSnapshot).snapshot;
    expect(canonical.elements.walls.map((wall) => wall.id)).toEqual([
      syntheticIds.wallA,
      syntheticIds.wallB,
    ]);
    expect(canonical.elements.spaces[0]?.boundedByElementIds).toEqual([
      syntheticIds.wallA,
      syntheticIds.wallB,
    ]);
    expect(canonical.elements.levels[0]?.name.attribution.evidenceIds).toEqual([
      syntheticIds.evidenceA,
      syntheticIds.evidenceB,
    ]);
    const nameAttribution = canonical.elements.levels[0]?.name.attribution;
    expect(
      nameAttribution?.verification.status === "reviewed-with-limitations"
        ? nameAttribution.verification.limitations
        : [],
    ).toEqual(["Accuracy remains source-limited.", "Concept review excludes setting out."]);
    expect(canonical.knownLimitations.map((limitation) => limitation.code)).toEqual([
      "INTERIOR_INCOMPLETE",
      "WALL_HEIGHT_UNKNOWN",
    ]);
    expect(canonical.elements.spaces[0]?.boundary.knowledge).toBe("known");
    const boundary = canonical.elements.spaces[0]?.boundary;
    expect(boundary?.knowledge === "known" ? boundary.value : []).toEqual([
      { xMm: 0, yMm: 0 },
      { xMm: 4_000, yMm: 0 },
      { xMm: 4_000, yMm: 3_000 },
      { xMm: 0, yMm: 3_000 },
    ]);
  });

  it("changes the hash for meaningful values and authored geometric point order", () => {
    const original = hashCanonicalHomeSnapshot(syntheticCanonicalSnapshot).snapshotSha256;
    const changedName = structuredClone(validateCanonicalHomeSnapshot(syntheticCanonicalSnapshot));
    const levelName = changedName.elements.levels[0]?.name;
    if (levelName?.knowledge === "known") levelName.value = "Changed synthetic level";
    expect(hashCanonicalHomeSnapshot(changedName).snapshotSha256).not.toBe(original);

    const reversedGeometry = structuredClone(
      validateCanonicalHomeSnapshot(syntheticCanonicalSnapshot),
    );
    const boundary = reversedGeometry.elements.spaces[0]?.boundary;
    if (boundary?.knowledge === "known") boundary.value.reverse();
    expect(hashCanonicalHomeSnapshot(reversedGeometry).snapshotSha256).not.toBe(original);
  });

  it("survives canonical bytes and ordinary JSON round trips", () => {
    const direct = canonicalizeHomeSnapshot(syntheticCanonicalSnapshot);
    const parsed = parseCanonicalHomeSnapshotJson(direct.canonicalBytes());
    expect(hashCanonicalHomeSnapshot(parsed)).toEqual(hashCanonicalHomeSnapshot(direct.snapshot));
    expect(roundTripCanonicalHomeSnapshot(syntheticCanonicalSnapshot)).toEqual(direct.snapshot);

    const ordinaryRoundTrip = JSON.parse(JSON.stringify(syntheticCanonicalSnapshot)) as unknown;
    expect(hashCanonicalHomeSnapshot(ordinaryRoundTrip)).toEqual(
      hashCanonicalHomeSnapshot(syntheticCanonicalSnapshot),
    );
  });

  it("does not mutate input and returns frozen snapshots and defensive byte copies", () => {
    const input = structuredClone(syntheticCanonicalSnapshot);
    const before = structuredClone(input);
    const canonical = canonicalizeHomeSnapshot(input);
    expect(input).toEqual(before);
    expect(input.elements.walls[0].id).toBe(syntheticIds.wallB);
    expect(Object.isFrozen(canonical.snapshot)).toBe(true);
    expect(Object.isFrozen(canonical.snapshot.elements.walls[0])).toBe(true);

    const firstBytes = canonical.canonicalBytes();
    firstBytes[0] = 0;
    expect(canonical.canonicalBytes()[0]).toBe("{".charCodeAt(0));
  });

  it("hashes only the frozen snapshot and verifies record integrity", () => {
    const canonical = canonicalizeHomeSnapshot(syntheticCanonicalSnapshot);
    const record = {
      canonicalByteLength: canonical.canonicalByteLength,
      createdAt: "2026-07-17T11:00:00.000Z",
      createdBy: syntheticIds.actor,
      id: "94000000-0000-4000-8000-000000000001",
      modelId: syntheticIds.model,
      profile: "existing",
      projectId: syntheticIds.project,
      schemaVersion: syntheticCanonicalSnapshot.schemaVersion,
      snapshot: syntheticCanonicalSnapshot,
      snapshotSha256: canonical.snapshotSha256,
      version: 1,
    } as const;
    const first = verifyModelSnapshotRecord(record);
    const second = verifyModelSnapshotRecord({
      ...record,
      createdAt: "2026-07-17T12:00:00.000Z",
      createdBy: "20000000-0000-4000-8000-000000000002",
      id: "94000000-0000-4000-8000-000000000002",
      version: 2,
    });
    expect(second.canonical.snapshotSha256).toBe(first.canonical.snapshotSha256);
    expect(second.canonical.canonicalJson).toBe(first.canonical.canonicalJson);
    expect(() => verifyModelSnapshotRecord({ ...record, snapshotSha256: "a".repeat(64) })).toThrow(
      SnapshotCanonicalizationError,
    );
  });

  it("keeps profile selection exact and never falls back across states", () => {
    expect(
      selectCanonicalHomeSnapshotForProfile({ existing: syntheticCanonicalSnapshot }, "proposed"),
    ).toBeUndefined();
    expect(() =>
      selectCanonicalHomeSnapshotForProfile({ proposed: syntheticCanonicalSnapshot }, "proposed"),
    ).toThrow(SnapshotCanonicalizationError);

    const proposed = {
      ...syntheticCanonicalSnapshot,
      derivedFromSnapshotSha256: "b".repeat(64),
      profile: "proposed" as const,
    };
    expect(selectCanonicalHomeSnapshotForProfile({ proposed }, "proposed")?.profile).toBe(
      "proposed",
    );
  });

  it("rejects negative zero before frozen-schema validation can collapse it", () => {
    const hostile = structuredClone(validateCanonicalHomeSnapshot(syntheticCanonicalSnapshot));
    const elevation = hostile.elements.levels[0]?.elevationMm;
    if (elevation?.knowledge === "known") elevation.value = -0;
    expect(() => validateCanonicalHomeSnapshot(hostile)).toThrow(/Negative zero/u);
  });

  it("recomputes the retained golden hash in a fresh process", () => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    expect(() =>
      execFileSync("pnpm", ["exec", "vitest", "run", "test/fresh-process.test.ts"], {
        cwd: packageRoot,
        env: { ...process.env, C4_FRESH_PROCESS_CHECK: "1" },
        stdio: "pipe",
      }),
    ).not.toThrow();
  }, 30_000);
});
