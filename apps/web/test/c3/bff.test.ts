import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as resolveProperty } from "../../src/app/api/c3/projects/[projectId]/property/resolutions/route";
import { PUT as selectProperty } from "../../src/app/api/c3/projects/[projectId]/property/route";
import { projectId, resolution } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

function request(body: unknown, idempotencyKey = "c3-test-key") {
  return new NextRequest("http://localhost:3000/api/c3/property", {
    body: JSON.stringify(body),
    headers: {
      cookie: "hds_c1_session=server-owned-token",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    method: "POST",
  });
}

describe("C3 same-origin BFF", () => {
  it("forwards only server-owned authorisation and validates the upstream result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(resolution, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await resolveProperty(request({ countryCode: "GB", query: "Example Mews" }), {
      params: Promise.resolve({ projectId }),
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(response.status).toBe(201);
    expect(headers.get("authorization")).toBe("Bearer server-owned-token");
    expect(headers.get("x-role")).toBeNull();
    expect(headers.get("x-tenant-id")).toBeNull();
  });

  it("rejects malformed identifiers, authority fields and short idempotency keys before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await resolveProperty(request({ countryCode: "GB", query: "Example Mews" }), {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });
    const extraAuthority = await resolveProperty(
      request({ countryCode: "GB", query: "Example Mews", role: "owner" }),
      { params: Promise.resolve({ projectId }) },
    );
    const shortKey = await resolveProperty(
      request({ countryCode: "GB", query: "Example Mews" }, "short"),
      { params: Promise.resolve({ projectId }) },
    );

    expect([malformed.status, extraAuthority.status, shortKey.status]).toEqual([404, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects candidate payload authority and requires the frozen selection shape", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await selectProperty(
      request({
        candidateId: "66666666-6666-4666-8666-666666666666",
        displayAddress: "Browser-controlled",
        expectedVersion: 0,
        mode: "candidate",
        resolutionId: "77777777-7777-4777-8777-777777777777",
      }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 for invalid upstream data and never reflects raw provider fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ rawProviderPayload: "must-not-leak", status: "matched" }),
        ),
    );
    const response = await resolveProperty(request({ countryCode: "GB", query: "Example Mews" }), {
      params: Promise.resolve({ projectId }),
    });
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).not.toContain("rawProviderPayload");
    expect(text).not.toContain("must-not-leak");
  });

  it("sanitizes upstream problems to the correlated public shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "PROPERTY_PROVIDER_UNAVAILABLE",
            detail: "Synthetic provider unavailable.",
            rawProviderPayload: "must-not-leak",
            requestId: "request-1",
            title: "Unavailable",
            traceId: "trace-1",
          },
          { status: 503 },
        ),
      ),
    );
    const response = await resolveProperty(request({ countryCode: "GB", query: "Example Mews" }), {
      params: Promise.resolve({ projectId }),
    });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain("PROPERTY_PROVIDER_UNAVAILABLE");
    expect(text).not.toContain("rawProviderPayload");
  });
});
