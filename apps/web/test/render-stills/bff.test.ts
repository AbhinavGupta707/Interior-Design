import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c14/[...segments]/route";
import { access, availableCapabilities, enhancement, ids, job, result } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const key = "c1400000-0000-4000-8000-000000000099";
const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, token = "server-owned-c14-token") {
  return new NextRequest("http://localhost:3000/api/c14/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: `hds_c1_session=${token}`,
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

function requestBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body) as unknown;
}

describe("C14 exact same-origin BFF", () => {
  it("proxies and validates capabilities, jobs, result, enhancement and fresh access", async () => {
    const cases = [
      {
        payload: availableCapabilities,
        segments: ["projects", ids.project, "render-capabilities"],
        suffix: `/v1/projects/${ids.project}/render-capabilities`,
      },
      {
        payload: { jobs: [job] },
        segments: ["projects", ids.project, "render-jobs"],
        suffix: `/v1/projects/${ids.project}/render-jobs`,
      },
      {
        payload: job,
        segments: ["projects", ids.project, "render-jobs", ids.job],
        suffix: `/render-jobs/${ids.job}`,
      },
      {
        payload: result,
        segments: ["projects", ids.project, "render-jobs", ids.job, "result"],
        suffix: `/render-jobs/${ids.job}/result`,
      },
      {
        payload: enhancement,
        segments: ["projects", ids.project, "render-jobs", ids.job, "enhancement"],
        suffix: `/render-jobs/${ids.job}/enhancement`,
      },
      {
        payload: access,
        segments: [
          "projects",
          ids.project,
          "render-jobs",
          ids.job,
          "artifacts",
          access.artifactId,
          "access",
        ],
        suffix: `/artifacts/${access.artifactId}/access`,
      },
    ];
    for (const testCase of cases) {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(testCase.payload));
      vi.stubGlobal("fetch", fetchMock);
      const response = await GET(request(), context(testCase.segments));
      expect(response.status, testCase.suffix).toBe(200);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(testCase.suffix);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-c14-token");
      expect(JSON.stringify(await response.json())).not.toMatch(/server-owned|authorization/iu);
      vi.unstubAllGlobals();
    }
  });

  it("forwards strict create and transition bodies with the server session token", async () => {
    for (const testCase of [
      {
        body: job.request,
        segments: ["projects", ids.project, "render-jobs"],
        suffix: `/v1/projects/${ids.project}/render-jobs`,
      },
      {
        body: { expectedVersion: job.version },
        segments: ["projects", ids.project, "render-jobs", ids.job, "retry"],
        suffix: `/render-jobs/${ids.job}/retry`,
      },
    ]) {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(job, { status: 201 }));
      vi.stubGlobal("fetch", fetchMock);
      const response = await POST(request("POST", testCase.body), context(testCase.segments));
      expect(response.status).toBe(201);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(testCase.suffix);
      expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
      expect(requestBody(init)).toEqual(testCase.body);
      vi.unstubAllGlobals();
    }
  });

  it("rejects traversal, extra segments and mismatched upstream scope before disclosure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const traversal = await GET(
      request(),
      context(["projects", ids.project, "render-jobs", `${ids.job}%2F..%2Fprojects`]),
    );
    const extra = await GET(
      request(),
      context(["projects", ids.project, "render-jobs", ids.job, "result", "raw"]),
    );
    expect([traversal.status, extra.status]).toEqual([404, 404]);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ jobs: [{ ...job, projectId: ids.tenant }] })),
    );
    const mismatch = await GET(request(), context(["projects", ids.project, "render-jobs"]));
    expect(mismatch.status).toBe(502);
    expect(JSON.stringify(await mismatch.json())).not.toContain(ids.tenant);
  });
});
