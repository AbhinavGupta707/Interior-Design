import { describe, expect, it, vi } from "vitest";

import {
  createDesignOptionsClient,
  DesignOptionsProblem,
} from "../../src/features/design-options/api";
import { designOptionLaunchContextSchema } from "../../src/features/design-options/contracts";
import { confirmationA, ids, job, launchContext, optionA, optionsResponse } from "./fixtures";

const key = "c1200000-0000-4000-8000-000000000099";

function requestBody(init: RequestInit): string {
  if (typeof init.body !== "string") throw new Error("Expected a JSON string request body");
  return init.body;
}

describe("C12 browser client", () => {
  it("validates list responses and sends no cacheable state", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(optionsResponse));
    const client = createDesignOptionsClient(transport, () => key);
    await expect(client.listOptions(ids.project, ids.job)).resolves.toEqual(optionsResponse);
    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(init.cache).toBe("no-store");
  });

  it("creates a job with exact frozen request fields and a separate idempotency header", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(job, { status: 201 }));
    const client = createDesignOptionsClient(transport, () => key);
    await client.createJob(ids.project, designOptionLaunchContextSchema.parse(launchContext));
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/c12/projects/${ids.project}/design-option-jobs`);
    expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
    expect(JSON.parse(requestBody(init))).toEqual(launchContext);
    expect(requestBody(init)).not.toContain("constraints");
  });

  it("constructs a stale-safe confirmation from the displayed immutable pins", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(confirmationA));
    const client = createDesignOptionsClient(transport, () => key);
    const optionSet = optionsResponse.optionSet;
    if (!optionSet) throw new Error("Expected an option-set fixture");
    await client.confirmOption(ids.project, job, optionA, optionSet.setSha256);
    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestBody(init)) as Record<string, unknown>;
    expect(body).toEqual({
      expectedBriefContentSha256: optionA.baseBrief.contentSha256,
      expectedBriefRevision: optionA.baseBrief.revision,
      expectedJobVersion: job.version,
      expectedOptionSetSha256: optionSet.setSha256,
      expectedOptionStatus: "pending",
      expectedSourceSnapshotSha256: job.sourceModel.snapshotSha256,
      idempotencyKey: key,
    });
    expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
  });

  it("binds cancel and retry to the exact displayed job identity and version", async () => {
    const transitionedJob = { ...job, version: job.version + 1 };
    const transport = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(transitionedJob)));
    const client = createDesignOptionsClient(transport, () => key);

    await client.cancelJob(ids.project, job);
    await client.retryJob(ids.project, job);

    for (const [index, action] of ["cancel", "retry"].entries()) {
      const [url, init] = transport.mock.calls[index] as [string, RequestInit];
      expect(url).toBe(`/api/c12/projects/${ids.project}/design-option-jobs/${ids.job}/${action}`);
      expect(JSON.parse(requestBody(init))).toEqual({ expectedVersion: job.version });
      expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
    }
  });

  it("surfaces a stale cancel or retry as an explicit conflict without leaking raw data", async () => {
    const transport = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json(
          {
            detail:
              "The brief, source model, job, option, or branch changed. Reload the exact latest pins.",
            privateJobPayload: "do-not-return",
          },
          { status: 409 },
        ),
      ),
    );
    const client = createDesignOptionsClient(transport, () => key);

    await expect(client.cancelJob(ids.project, job)).rejects.toMatchObject({
      kind: "conflict",
      message:
        "The brief, source model, job, option, or branch changed. Reload the exact latest pins.",
      status: 409,
    });
    await expect(client.retryJob(ids.project, job)).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });
  });

  it("maps offline, stale, expiry, and malformed responses without exposing raw payloads", async () => {
    const offline = createDesignOptionsClient(vi.fn().mockRejectedValue(new Error("secret")));
    await expect(offline.getJob(ids.project, ids.job)).rejects.toMatchObject({ kind: "offline" });

    for (const [status, kind] of [
      [409, "conflict"],
      [410, "option-expired"],
    ] as const) {
      const client = createDesignOptionsClient(
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { detail: "Safe BFF copy", rawPrivateBrief: "do-not-return" },
              { status },
            ),
          ),
      );
      await expect(client.getOption(ids.project, ids.job, ids.optionA)).rejects.toMatchObject({
        kind,
        message: "Safe BFF copy",
      });
    }

    const malformed = createDesignOptionsClient(
      vi.fn().mockResolvedValue(Response.json({ ...optionA, schemaVersion: "forged" })),
    );
    await expect(malformed.getOption(ids.project, ids.job, ids.optionA)).rejects.toBeInstanceOf(
      DesignOptionsProblem,
    );
  });
});
