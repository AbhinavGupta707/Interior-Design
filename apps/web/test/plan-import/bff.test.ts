import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c6/[...segments]/route";
import { asset, branch, job, project, session, uuid } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, key = "c6-test-key") {
  return new NextRequest("http://localhost:3000/api/c6/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-token",
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C6 same-origin BFF", () => {
  it("combines reauthenticated project context and exposes only C6-ready plan assets", async () => {
    const rejectedAsset = { ...asset, id: uuid(40), kind: "photograph" as const };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json([asset, rejectedAsset]))
      .mockResolvedValueOnce(Response.json({ jobs: [job] }))
      .mockResolvedValueOnce(
        Response.json({ branches: [branch], profile: "existing", projectId: project.id }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(), context(["projects", project.id, "workspace"]));
    const payload = (await response.json()) as { assets: Array<{ id: string }> };
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(response.status).toBe(200);
    expect(payload.assets.map(({ id }) => id)).toEqual([asset.id]);
    expect(headers.get("authorization")).toBe("Bearer server-owned-token");
    expect(headers.get("x-role")).toBeNull();
  });

  it("rejects malformed IDs, browser authority and short mutation keys before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await GET(request(), context(["projects", "not-a-uuid", "workspace"]));
    const authority = await POST(
      request("POST", {
        assetId: asset.id,
        pageIndex: 0,
        parserPreference: "fixture",
        role: "owner",
      }),
      context(["projects", project.id, "plan-processing-jobs"]),
    );
    const shortKey = await POST(
      request("POST", { assetId: asset.id, pageIndex: 0, parserPreference: "fixture" }, "short"),
      context(["projects", project.id, "plan-processing-jobs"]),
    );
    expect([malformed.status, authority.status, shortKey.status]).toEqual([404, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sanitizes upstream failures without leaking internal locators or raw diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "PARSER_UNAVAILABLE",
            databaseLocator: "must-not-leak",
            detail: "Use the manual editor or retry later.",
            stderr: "must-not-leak",
          },
          { status: 503 },
        ),
      ),
    );
    const response = await GET(
      request(),
      context(["projects", project.id, "plan-processing-jobs", job.id]),
    );
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain("PARSER_UNAVAILABLE");
    expect(body).not.toContain("databaseLocator");
    expect(body).not.toContain("stderr");
  });
});
