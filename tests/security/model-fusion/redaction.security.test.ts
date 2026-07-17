import { describe, expect, it } from "vitest";

import { safeFusionLog } from "./reference-boundary.js";

describe("C9 log and trace redaction boundary", () => {
  it("emits only allowlisted counts/codes and one-way hashed stable IDs", () => {
    const secret =
      "Bearer secret /private/customer.obj https://storage.invalid/?X-Signature=secret";
    const log = safeFusionLog({
      attempt: 2,
      eventCode: "FUSION_PROPOSAL_PUBLISHED",
      jobId: "job-alpha",
      latencyMilliseconds: 923,
      projectId: "project-alpha",
      registeredSourceCount: 4,
      safeCode: "PARTIAL_DISCONNECTED",
      tenantId: "tenant-alpha",
      untrusted: { exception: secret, sourceManifest: secret, stderr: secret },
    });
    expect(Object.keys(log).sort()).toEqual([
      "attempt",
      "eventCode",
      "jobIdSha256",
      "latencyMilliseconds",
      "projectIdSha256",
      "registeredSourceCount",
      "safeCode",
      "tenantIdSha256",
    ]);
    const serialized = JSON.stringify(log);
    for (const forbidden of [secret, "job-alpha", "project-alpha", "tenant-alpha", "Bearer"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(log.jobIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(log.projectIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(log.tenantIdSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("normalizes unsafe codes and invalid resource observations", () => {
    const log = safeFusionLog({
      attempt: Number.NaN,
      eventCode: "customer path /private/home",
      jobId: "job-alpha",
      latencyMilliseconds: Number.POSITIVE_INFINITY,
      projectId: "project-alpha",
      registeredSourceCount: -1,
      safeCode: "raw exception: signed URL",
      tenantId: "tenant-alpha",
    });
    expect(log).toMatchObject({
      attempt: 0,
      eventCode: "UNSAFE_EVENT",
      latencyMilliseconds: 0,
      registeredSourceCount: 0,
      safeCode: "UNSAFE_ERROR",
    });
  });
});
