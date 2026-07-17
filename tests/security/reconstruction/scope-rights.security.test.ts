import { describe, expect, it } from "vitest";

import {
  assertRights,
  authorize,
  type ActorScope,
  type ReconstructionResource,
} from "./reference-boundary.js";

const owner = {
  projectId: "project-alpha",
  role: "owner",
  tenantId: "tenant-alpha",
} satisfies ActorScope;

const resource = {
  attempt: 1,
  cancelled: false,
  jobId: "job-alpha",
  projectId: "project-alpha",
  rightsActive: true,
  tenantId: "tenant-alpha",
  terminal: false,
  version: 3,
} satisfies ReconstructionResource;

describe("C8 rights and tenant reference boundary", () => {
  it("denies foreign tenant/project references before disclosing existence", () => {
    for (const actor of [
      { ...owner, tenantId: "tenant-beta" },
      { ...owner, projectId: "project-beta" },
    ]) {
      for (const action of ["cancel", "create", "publish", "read", "retry"] as const) {
        expect(() => authorize(actor, resource, action)).toThrow("RECONSTRUCTION_NOT_FOUND");
      }
    }
  });

  it("keeps viewers read-only and owner/editor mutations scoped", () => {
    const viewer = { ...owner, role: "viewer" } satisfies ActorScope;
    expect(() => authorize(viewer, resource, "read")).not.toThrow();
    for (const action of ["cancel", "create", "publish", "retry"] as const) {
      expect(() => authorize(viewer, resource, action)).toThrow("RECONSTRUCTION_FORBIDDEN");
    }
    expect(() => authorize(owner, resource, "publish")).not.toThrow();
  });

  it("requires service processing and fixes training use to denied", () => {
    expect(() =>
      assertRights({
        basis: "public-domain",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      }),
    ).not.toThrow();
    for (const rights of [
      { basis: "public-domain", serviceProcessingConsent: false, trainingUseConsent: "denied" },
      { basis: "public-domain", serviceProcessingConsent: true, trainingUseConsent: "allowed" },
      { basis: "scraped", serviceProcessingConsent: true, trainingUseConsent: "denied" },
    ]) {
      expect(() => assertRights(rights)).toThrow("RECONSTRUCTION_RIGHTS_DENIED");
    }
  });
});
