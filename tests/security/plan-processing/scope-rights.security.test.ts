import { describe, expect, it } from "vitest";

import { holdoutInBoxPlanFixtures } from "../../../packages/test-fixtures/src/plans/holdout/catalog.js";

import { verifySourceLease, type SourceLeaseClaim } from "./reference-boundary.js";

const fixture = requireFixture();

function validClaim(): SourceLeaseClaim {
  return {
    assetId: fixture.scope.assetId,
    objectKey: fixture.scope.objectKey,
    projectId: fixture.scope.projectId,
    serviceProcessingConsent: true,
    sourceSha256: fixture.sha256,
    sourceStatus: "ready",
    tenantId: fixture.scope.tenantId,
    trainingUseConsent: "denied",
  };
}

describe("C6 source, rights, tenant, path and object-key binding", () => {
  it("accepts only the exact ready, rights-cleared, training-denied source claim", () => {
    expect(verifySourceLease(fixture, validClaim()).accepted).toBe(true);
  });

  it.each([
    ["tenant mismatch", { tenantId: "c6000000-0000-4000-8000-999999999999" }],
    ["project mismatch", { projectId: "c6000000-0000-4000-8000-999999999999" }],
    ["asset mismatch", { assetId: "c6000000-0000-4000-8000-999999999999" }],
    ["source hash mismatch", { sourceSha256: "f".repeat(64) }],
    ["foreign object key", { objectKey: "tenant/c6-synthetic/foreign" }],
    ["path traversal", { objectKey: "tenant/c6-synthetic/../../etc/passwd" }],
    ["absolute path", { objectKey: "/tmp/c6-source.svg" }],
    ["URL object key", { objectKey: "https://attacker.invalid/source.svg" }],
  ])("fails closed for %s", (_label, patch) => {
    expect(verifySourceLease(fixture, { ...validClaim(), ...patch })).toMatchObject({
      accepted: false,
      code: "source-mismatch",
    });
  });

  it.each(["processing", "quarantined", "rejected"] as const)(
    "rejects non-ready status %s",
    (sourceStatus) => {
      expect(verifySourceLease(fixture, { ...validClaim(), sourceStatus })).toMatchObject({
        accepted: false,
        code: "source-not-ready",
      });
    },
  );

  it("rejects withdrawn processing consent or any non-denied training state", () => {
    expect(
      verifySourceLease(fixture, { ...validClaim(), serviceProcessingConsent: false }),
    ).toMatchObject({ accepted: false, code: "rights-not-permitted" });
    expect(
      verifySourceLease(fixture, { ...validClaim(), trainingUseConsent: "allowed" }),
    ).toMatchObject({ accepted: false, code: "rights-not-permitted" });
    expect(
      verifySourceLease(fixture, { ...validClaim(), trainingUseConsent: "unspecified" }),
    ).toMatchObject({ accepted: false, code: "rights-not-permitted" });
  });
});

function requireFixture() {
  const result = holdoutInBoxPlanFixtures.at(0);
  if (result === undefined) throw new Error("C6 scope tests require one in-box fixture.");
  return result;
}
