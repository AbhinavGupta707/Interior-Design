/* Package manifests are frozen in C4-L4, so the root-owned Node types are referenced for this test. */
/// <reference types="node" />

import { execFileSync } from "node:child_process";

import { canonicalHomeSnapshotSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  canonicalProfileFixtures,
  canonicalProfileGoldens,
  existingHomeSnapshot,
  expectedCanonicalElementOrder,
  generateOrderingVariants,
  referenceCanonicalByteLength,
  referenceCanonicalJson,
  referenceCanonicalSnapshot,
  referenceSnapshotSha256,
} from "../src/models/index.js";

describe("C4 independent canonical fixture oracle", () => {
  it.each(Object.entries(canonicalProfileFixtures))(
    "matches the fixed %s hash and UTF-8 byte length",
    async (profile, snapshot) => {
      const golden = canonicalProfileGoldens[profile as keyof typeof canonicalProfileGoldens];
      expect(await referenceSnapshotSha256(snapshot)).toBe(golden.sha256);
      expect(referenceCanonicalByteLength(snapshot)).toBe(golden.canonicalByteLength);
    },
  );

  it("links proposed and as-built derivation to the exact source golden", () => {
    expect(canonicalProfileFixtures.proposed.derivedFromSnapshotSha256).toBe(
      canonicalProfileGoldens.existing.sha256,
    );
    expect(canonicalProfileFixtures["as-built"].derivedFromSnapshotSha256).toBe(
      canonicalProfileGoldens.proposed.sha256,
    );
  });

  it("sorts entities and reference sets while preserving authored geometry order", () => {
    const canonical = referenceCanonicalSnapshot(existingHomeSnapshot);
    for (const [collection, expectedIds] of Object.entries(expectedCanonicalElementOrder)) {
      const elements = canonical.elements[collection as keyof typeof canonical.elements];
      expect(elements.map((element) => element.id)).toEqual(expectedIds);
    }
    const livingAuthored = existingHomeSnapshot.elements.spaces.find(
      (space) => space.name.knowledge === "known" && space.name.value === "Synthetic living room",
    );
    const livingCanonical = canonical.elements.spaces.find(
      (space) => space.id === livingAuthored?.id,
    );
    expect(livingCanonical?.boundary).toEqual(livingAuthored?.boundary);
    expect(livingCanonical?.boundedByElementIds).toEqual(
      [...(livingAuthored?.boundedByElementIds ?? [])].sort(),
    );
  });

  it("is invariant across fixed-seed insertion-order variants", async () => {
    const expected = canonicalProfileGoldens.existing.sha256;
    const variants = generateOrderingVariants(existingHomeSnapshot);
    expect(variants).toHaveLength(24);
    for (const variant of variants) {
      expect(await referenceSnapshotSha256(variant)).toBe(expected);
    }
  });

  it("changes hash when a semantically relevant authored point changes", async () => {
    const changed = structuredClone(existingHomeSnapshot);
    const camera = changed.elements.cameras[0];
    if (camera?.position.knowledge !== "known") throw new Error("Expected a known fixture camera.");
    camera.position.value.xMm += 1;
    expect(await referenceSnapshotSha256(changed)).not.toBe(
      canonicalProfileGoldens.existing.sha256,
    );
  });

  it("round-trips canonical bytes and hash in an independent Node process", () => {
    const canonicalJson = referenceCanonicalJson(existingHomeSnapshot);
    const script = `
      const { createHash } = require("node:crypto");
      const { readFileSync } = require("node:fs");
      const input = readFileSync(0, "utf8");
      const roundTripped = JSON.stringify(JSON.parse(input));
      process.stdout.write(JSON.stringify({
        byteLength: Buffer.byteLength(roundTripped, "utf8"),
        sha256: createHash("sha256").update(roundTripped, "utf8").digest("hex")
      }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=commonjs", "--eval", script], {
      encoding: "utf8",
      input: canonicalJson,
    });
    expect(JSON.parse(output)).toEqual({
      byteLength: canonicalProfileGoldens.existing.canonicalByteLength,
      sha256: canonicalProfileGoldens.existing.sha256,
    });
  });

  it("is stable after a plain JSON round trip", () => {
    const before = referenceCanonicalJson(existingHomeSnapshot);
    const roundTripped: unknown = JSON.parse(JSON.stringify(existingHomeSnapshot));
    const after = referenceCanonicalJson(canonicalHomeSnapshotSchema.parse(roundTripped));
    expect(after).toBe(before);
  });
});
