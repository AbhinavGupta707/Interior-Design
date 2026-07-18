import {
  parseCatalogSourceManifest,
  pinnedKhronosValidatorVersion,
  sha256Bytes,
} from "@interior-design/catalog";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PinnedKhronosValidator } from "../../src/catalog/khronos-validator.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../../packages/catalog/fixtures/source");

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog fixture is incomplete.");
  return value;
}

describe("C13 pinned Khronos validator adapter", () => {
  it("loads the exact scene-compiler-owned validator and reports a clean real GLB", async () => {
    const manifest = parseCatalogSourceManifest(
      await readFile(resolve(fixtureRoot, "release.json")),
    );
    const modelDescriptor = required(
      required(manifest.assets[0]).artifacts.find(({ role }) => role === "model"),
    );
    const bytes = Uint8Array.from(
      await readFile(resolve(fixtureRoot, modelDescriptor.relativePath)),
    );
    const result = await new PinnedKhronosValidator().validate(bytes, sha256Bytes(bytes));
    expect(result).toEqual({
      // UV0 is mandatory under the stricter catalog policy even when this bounded
      // synthetic material has no texture, so the official validator emits one info.
      issueCodes: ["UNUSED_OBJECT"],
      numErrors: 0,
      numWarnings: 0,
      validatorVersion: pinnedKhronosValidatorVersion,
    });
  });

  it("fails closed before invocation when the artifact identity is malformed", async () => {
    await expect(
      new PinnedKhronosValidator().validate(Uint8Array.of(1, 2, 3), "not-a-sha256"),
    ).rejects.toMatchObject({ safeCode: "CATALOG_VALIDATOR_FAILED" });
    await expect(
      new PinnedKhronosValidator().validate(Uint8Array.of(1, 2, 3), "0".repeat(64)),
    ).rejects.toMatchObject({ safeCode: "CATALOG_VALIDATOR_FAILED" });
  });
});
