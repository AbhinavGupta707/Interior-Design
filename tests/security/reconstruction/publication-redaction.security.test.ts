import { describe, expect, it } from "vitest";

import {
  assertAppearanceAuthority,
  assertPublicationFence,
  safeTelemetry,
  type PublicationClaim,
  type ReconstructionResource,
} from "./reference-boundary.js";

const resource = {
  attempt: 2,
  cancelled: false,
  jobId: "job-alpha",
  projectId: "project-alpha",
  rightsActive: true,
  tenantId: "tenant-alpha",
  terminal: false,
  version: 7,
} satisfies ReconstructionResource;

const claim = {
  attempt: 2,
  jobId: "job-alpha",
  projectId: "project-alpha",
  tenantId: "tenant-alpha",
  version: 7,
} satisfies PublicationClaim;

describe("C8 publication, authority, and logging boundary", () => {
  it("permits only the exact live attempt/version and denies cancel, withdrawal and terminal races", () => {
    expect(() => assertPublicationFence(resource, claim)).not.toThrow();
    for (const [changedResource, changedClaim] of [
      [resource, { ...claim, attempt: 1 }],
      [resource, { ...claim, version: 6 }],
      [{ ...resource, cancelled: true }, claim],
      [{ ...resource, rightsActive: false }, claim],
      [{ ...resource, terminal: true }, claim],
      [{ ...resource, tenantId: "tenant-beta" }, claim],
    ] as const) {
      expect(() => assertPublicationFence(changedResource, changedClaim)).toThrow(
        "RECONSTRUCTION_STALE_PUBLICATION",
      );
    }
  });

  it("accepts only non-dimensional appearance and no canonical/C5 mutation reference", () => {
    const appearance = {
      artifacts: [
        { dimensionalAuthority: "non-dimensional", kind: "nerfstudio-viewer" },
        { dimensionalAuthority: "non-dimensional", kind: "gaussian-splat" },
      ],
      method: "nerfstudio",
    };
    expect(() => assertAppearanceAuthority(appearance)).not.toThrow();
    expect(() =>
      assertAppearanceAuthority({
        ...appearance,
        artifacts: [{ dimensionalAuthority: "proposal-only", kind: "gaussian-splat" }],
      }),
    ).toThrow("APPEARANCE_DIMENSIONAL_AUTHORITY_DENIED");
    expect(() => assertAppearanceAuthority({ ...appearance, canonicalModelId: "model" })).toThrow(
      "APPEARANCE_CANONICAL_MUTATION_DENIED",
    );
  });

  it("emits only allowlisted numeric/coded telemetry and hashes stable IDs", () => {
    const secret = "Bearer secret /private/customer.mov X-Amz-Signature=secret";
    const telemetry = safeTelemetry({
      attempt: 2,
      durationMilliseconds: 900,
      eventCode: "APPEARANCE_FAILED",
      jobId: "job-alpha",
      projectId: "project-alpha",
      safeCode: "APPEARANCE_TOOL_FAILED",
      stage: "reconstructing-appearance",
      untrusted: { rawMedia: secret, stderr: secret },
    });
    const serialized = JSON.stringify(telemetry);
    expect(Object.keys(telemetry).sort()).toEqual([
      "attempt",
      "durationMilliseconds",
      "eventCode",
      "jobIdHash",
      "projectIdHash",
      "safeCode",
      "stage",
    ]);
    expect(serialized).not.toContain("job-alpha");
    expect(serialized).not.toContain("project-alpha");
    expect(serialized).not.toContain(secret);
    expect(telemetry.jobIdHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
