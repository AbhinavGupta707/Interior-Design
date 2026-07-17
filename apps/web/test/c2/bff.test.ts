import { NextRequest } from "next/server";
import { signedAssetUploadPartSchema } from "@interior-design/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET as listAssets,
  POST as createSession,
} from "../../src/app/api/c2/projects/[projectId]/assets/route";
import { POST as signPart } from "../../src/app/api/c2/projects/[projectId]/assets/upload-sessions/[sessionId]/parts/route";

const projectId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";

afterEach(() => vi.unstubAllGlobals());

describe("C2 same-origin BFF", () => {
  it("forwards server-owned authorisation without browser authority headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(`http://localhost:3000/api/c2/projects/${projectId}/assets`, {
      headers: { cookie: "hds_c1_session=server-owned-token" },
    });

    const response = await listAssets(request, { params: Promise.resolve({ projectId }) });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(response.status).toBe(200);
    expect(headers.get("authorization")).toBe("Bearer server-owned-token");
    expect(headers.get("x-tenant-id")).toBeNull();
    expect(headers.get("x-role")).toBeNull();
  });

  it("rejects malformed identifiers without contacting the evidence service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost:3000/api/c2/projects/not-a-uuid/assets", {
      headers: { cookie: "hds_c1_session=server-owned-token" },
    });

    const response = await listAssets(request, {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires idempotency and preserves only the checksum-bound part response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        expiresAt: "2026-07-17T12:15:00.000Z",
        partNumber: 1,
        requiredHeaders: {
          "x-amz-checksum-sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
        url: "http://127.0.0.1:8333/source-part",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      byteSize: 16,
      checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      partNumber: 1,
    };
    const withoutKey = new NextRequest("http://localhost/part", {
      body: JSON.stringify(body),
      headers: { cookie: "hds_c1_session=server-owned-token", "content-type": "application/json" },
      method: "POST",
    });
    expect(
      (await signPart(withoutKey, { params: Promise.resolve({ projectId, sessionId }) })).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const withKey = new NextRequest("http://localhost/part", {
      body: JSON.stringify(body),
      headers: {
        cookie: "hds_c1_session=server-owned-token",
        "content-type": "application/json",
        "idempotency-key": "part-test-1",
      },
      method: "POST",
    });
    const response = await signPart(withKey, { params: Promise.resolve({ projectId, sessionId }) });
    const payload = signedAssetUploadPartSchema.parse((await response.json()) as unknown);
    expect(payload.requiredHeaders["x-amz-checksum-sha256"]).toBe(body.checksumSha256);
    expect(JSON.stringify(payload)).not.toContain("server-owned-token");
  });

  it("does not accept a browser bearer when the HTTP-only session cookie is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(`http://localhost:3000/api/c2/projects/${projectId}/assets`, {
      headers: {
        authorization: "Bearer browser-controlled",
        "idempotency-key": "browser-bearer-test",
      },
    });

    const response = await createSession(request, { params: Promise.resolve({ projectId }) });
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
