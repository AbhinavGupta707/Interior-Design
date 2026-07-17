import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getProjects, POST as createProject } from "../../src/app/api/c1/projects/route";
import { POST as createSession } from "../../src/app/api/c1/session/route";

const sessionPayload = {
  accessToken: "fixture-access-token-with-more-than-thirty-two-characters",
  session: {
    actor: {
      displayName: "Avery Morgan",
      role: "owner",
      subject: "fixture:homeowner-alpha",
      tenantId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
    },
    authMode: "local-fixture",
    expiresAt: "2026-07-18T12:00:00.000Z",
  },
};

const projectPayload = {
  createdAt: "2026-07-17T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  name: "Sample terrace refresh",
  status: "draft",
  tenantId: "11111111-1111-4111-8111-111111111111",
  updatedAt: "2026-07-17T12:00:00.000Z",
  version: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C1 same-origin BFF", () => {
  it("stores the backend bearer in an HTTP-only SameSite cookie and never returns it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(sessionPayload, {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      ),
    );

    const response = await createSession(
      new Request("http://localhost:3000/api/c1/session", {
        body: JSON.stringify({ persona: "homeowner-alpha" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const responseBody: unknown = await response.json();
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(responseBody).toEqual(sessionPayload.session);
    expect(JSON.stringify(responseBody)).not.toContain(sessionPayload.accessToken);
    expect(setCookie).toContain("hds_c1_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("forwards the cookie token as backend authorisation without accepting browser authority", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([projectPayload]));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost:3000/api/c1/projects", {
      headers: { cookie: "hds_c1_session=server-owned-token" },
    });

    const response = await getProjects(request);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(response.status).toBe(200);
    expect(headers.get("authorization")).toBe("Bearer server-owned-token");
    expect(headers.get("x-tenant-id")).toBeNull();
    expect(headers.get("x-user-id")).toBeNull();
    expect(headers.get("x-role")).toBeNull();
  });

  it("rejects extra tenant or role fields before a project mutation reaches the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost:3000/api/c1/projects", {
      body: JSON.stringify({ name: "Sample project", role: "owner" }),
      headers: {
        cookie: "hds_c1_session=server-owned-token",
        "idempotency-key": "test-create-1",
      },
      method: "POST",
    });

    const response = await createProject(request);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
