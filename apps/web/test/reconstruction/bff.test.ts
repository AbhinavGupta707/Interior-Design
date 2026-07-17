import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c8/[...segments]/route";
import { imageAsset, job, project, session, uuid } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, key = "c8-test-key") {
  return new NextRequest("http://localhost:3000/api/c8/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-token",
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C8 same-origin BFF", () => {
  it("composes session/project/assets/jobs in parallel and filters to eligible immutable media", async () => {
    const pending = { ...imageAsset, id: uuid(20), status: "processing" as const };
    const plan = {
      ...imageAsset,
      declaredMimeType: "application/pdf" as const,
      detectedMimeType: "application/pdf",
      id: uuid(21),
      kind: "plan" as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json([imageAsset, pending, plan]))
      .mockResolvedValueOnce(Response.json({ jobs: [job] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(), context(["projects", project.id, "workspace"]));
    const payload = (await response.json()) as {
      assets: Array<{ id: string }>;
      capabilities: Record<string, string>;
    };
    expect(response.status).toBe(200);
    expect(payload.assets.map(({ id }) => id)).toEqual([imageAsset.id]);
    expect(payload.capabilities).toEqual({
      appearanceProvider: "unavailable",
      geometryWorker: "unavailable",
      gpu: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-token");
    }
  });

  it("rejects malformed IDs, browser authority and short mutation keys before upstream fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await GET(request(), context(["projects", "not-a-uuid", "workspace"]));
    const authority = await POST(
      request("POST", { ...job.request, role: "owner" }),
      context(["projects", project.id, "reconstruction-jobs"]),
    );
    const short = await POST(
      request("POST", job.request, "short"),
      context(["projects", project.id, "reconstruction-jobs"]),
    );
    expect([malformed.status, authority.status, short.status]).toEqual([404, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards exact optimistic transitions and strips unsafe upstream fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...job, state: "cancelled", retryable: true, version: 2 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "RECONSTRUCTION_PROVIDER_UNAVAILABLE",
            detail: "No eligible local provider is configured.",
            objectKey: "must-not-leak",
            stderr: "must-not-leak",
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const cancelled = await POST(
      request("POST", { expectedVersion: 1 }, "c8-cancel-key-0001"),
      context(["projects", project.id, "reconstruction-jobs", job.id, "cancel"]),
    );
    const [, cancelInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(cancelled.status).toBe(200);
    expect(new Headers(cancelInit.headers).get("idempotency-key")).toBe("c8-cancel-key-0001");
    const failed = await GET(
      request(),
      context(["projects", project.id, "reconstruction-jobs", job.id]),
    );
    const body = await failed.text();
    expect(failed.status).toBe(503);
    expect(body).toContain("RECONSTRUCTION_PROVIDER_UNAVAILABLE");
    expect(body).not.toMatch(/objectKey|stderr|must-not-leak/u);
  });
});
