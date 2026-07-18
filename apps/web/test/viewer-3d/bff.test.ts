import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c10/[...segments]/route";
import { access, job, project, scene, session, sourceSnapshot } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, key = "c10-test-key-0001") {
  return new NextRequest("http://localhost:3000/api/c10/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-token",
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C10 same-origin BFF", () => {
  it("composes session, project, strict jobs and exact snapshot references without canonical bodies", async () => {
    vi.stubEnv("C10_VIEWER_EVIDENCE_CLASSIFICATION", "fixture-presentation");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json({ jobs: [job] }))
      .mockResolvedValueOnce(
        Response.json({
          profiles: [
            {
              currentSnapshotId: sourceSnapshot.snapshotId,
              currentSnapshotSha256: sourceSnapshot.snapshotSha256,
              modelId: sourceSnapshot.modelId,
              profile: "existing",
              status: "available",
              updatedAt: "2026-07-17T20:00:00.000Z",
              version: 1,
            },
            { profile: "proposed", status: "empty" },
            { profile: "as-built", status: "empty" },
          ],
          projectId: project.id,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), context(["projects", project.id, "workspace"]));
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.evidenceClassification).toBe("fixture-presentation");
    expect(JSON.stringify(payload)).not.toMatch(/"snapshot":|objectKey|credential|accessToken/u);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-token");
    }
  });

  it("rejects malformed paths, browser authority, unknown bodies and short keys before upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await GET(request(), context(["projects", "not-a-uuid", "workspace"]));
    const authority = await POST(
      request("POST", { ...job.request, role: "owner" }),
      context(["projects", project.id, "scene-jobs"]),
    );
    const short = await POST(
      request("POST", job.request, "short"),
      context(["projects", project.id, "scene-jobs"]),
    );
    const accessBody = await POST(
      request("POST", { signedUrl: "browser-controlled" }),
      context(["projects", project.id, "scene-jobs", job.id, "scene", "access"]),
    );
    expect([malformed.status, authority.status, short.status, accessBody.status]).toEqual([
      404, 400, 400, 400,
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only allow-listed access creation and never logs or reflects unsafe diagnostics", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(access))
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "SCENE_ACCESS_EXPIRED",
            detail: "Request fresh access.",
            objectKey: "derived/private/scene.glb",
            signedUrl: "https://must-not-leak.invalid/signed",
          },
          { status: 410 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const granted = await POST(
      request("POST", {}),
      context(["projects", project.id, "scene-jobs", job.id, "scene", "access"]),
    );
    expect(granted.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("idempotency-key")).toBe("c10-test-key-0001");
    const failed = await GET(request(), context(["projects", project.id, "scene-jobs", job.id]));
    const failedText = await failed.text();
    expect(failed.status).toBe(410);
    expect(failedText).not.toMatch(/objectKey|signedUrl|must-not-leak|scene\.glb/u);
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("does not trust a viewer mutation claim and preserves upstream role/IDOR denials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ detail: "Read only", status: 403 }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ detail: "Not found", status: 404 }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const denied = await POST(
      request("POST", job.request),
      context(["projects", project.id, "scene-jobs"]),
    );
    const foreign = await GET(
      request(),
      context(["projects", project.id, "scene-jobs", job.id, "scene"]),
    );
    expect([denied.status, foreign.status]).toEqual([403, 404]);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).not.toContain("role");
  });

  it("strictly validates scene responses before exposing them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...scene, objectKey: "hidden" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      request(),
      context(["projects", project.id, "scene-jobs", job.id, "scene"]),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("hidden");
  });

  it("rejects a valid same-tenant project body that does not match the requested project", async () => {
    const foreignProject = {
      ...project,
      id: "a1000000-0000-4000-8000-000000000099",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(foreignProject))
      .mockResolvedValueOnce(Response.json({ jobs: [job] }))
      .mockResolvedValueOnce(
        Response.json({
          profiles: [],
          projectId: project.id,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), context(["projects", project.id, "workspace"]));
    expect(response.status).toBe(502);
  });
});
