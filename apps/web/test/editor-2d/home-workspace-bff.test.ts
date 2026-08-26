import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/app/api/c5/[...segments]/route";
import { buildUnmeasuredHomeWorkspaceRequest } from "../../src/app/api/c5/_shared/home-workspace";
import { snapshotRecord, uuid } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const projectId = uuid(5);
const actorUserId = uuid(1);
const propertyId = uuid(70);
const context = (profile = "existing") => ({
  params: Promise.resolve({
    segments: ["projects", projectId, "models", profile, "home-workspace"],
  }),
});

function request(body: unknown, key = "persisted-home-workspace-key") {
  return new NextRequest("http://localhost:3000/api/c5/test", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: "hds_c1_session=server-owned-token",
      "idempotency-key": key,
    },
    method: "POST",
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function successfulInitializationFetch(capturedBodies: unknown[]) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith(`/v1/projects/${projectId}/models/existing/home-workspace`)) {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      const body: unknown = JSON.parse(init.body);
      capturedBodies.push(body);
      return Response.json(
        {
          ...snapshotRecord,
          canonicalByteLength: 2_048,
          createdBy: actorUserId,
          id: uuid(90),
          modelId: snapshotRecord.snapshot.modelId,
          projectId,
          snapshot: { ...snapshotRecord.snapshot, projectId, propertyId },
          snapshotSha256: "c".repeat(64),
          version: 1,
        },
        { status: 201 },
      );
    }
    return Response.json({ code: "UNEXPECTED_TEST_ROUTE" }, { status: 500 });
  });
}

describe("C14.2 persisted homeowner setup BFF", () => {
  it("builds one strict unmeasured placeholder snapshot deterministically", () => {
    const scope = {
      actorUserId,
      idempotencyKey: "persisted-home-workspace-key",
      projectId,
      propertyId,
    };
    const first = buildUnmeasuredHomeWorkspaceRequest(scope);
    const second = buildUnmeasuredHomeWorkspaceRequest(scope);
    expect(second).toEqual(first);
    expect(first.expectedCurrentSnapshotSha256).toBeNull();
    expect(first.snapshot).toMatchObject({
      coordinateSystem: { globalAnchor: { status: "not-established" } },
      profile: "existing",
      projectId,
      propertyId,
    });
    expect(first.snapshot.elements.levels).toHaveLength(1);
    expect(first.snapshot.elements.levels[0]).toMatchObject({
      elevationMm: { knowledge: "unknown" },
      name: { knowledge: "unknown" },
      origin: {
        actorUserId,
        state: "user-asserted",
        verification: { status: "not-reviewed" },
      },
      storeyHeightMm: { knowledge: "unknown" },
    });
    for (const [collection, elements] of Object.entries(first.snapshot.elements)) {
      if (collection !== "levels") expect(elements).toEqual([]);
    }
    expect(first.snapshot.knownLimitations.map(({ code }) => code)).toEqual([
      "PLACEHOLDER_LEVEL_UNMEASURED",
      "PROPERTY_CONTEXT_PROVES_NO_INTERIOR",
    ]);
  });

  it("forwards only acknowledgement while the platform owns actor, property and model state", async () => {
    const capturedBodies: unknown[] = [];
    const fetchMock = successfulInitializationFetch(capturedBodies);
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(request({ confirmUnmeasuredInterior: true }), context());
    const second = await POST(request({ confirmUnmeasuredInterior: true }), context());
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[1]).toEqual(capturedBodies[0]);
    expect(capturedBodies[0]).toEqual({ confirmUnmeasuredInterior: true });
    expect(JSON.stringify(capturedBodies)).not.toMatch(
      /Secret Mews|Private Town|providerId|snapshot|propertyId|actor/iu,
    );

    const mutationCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input).endsWith("/models/existing/home-workspace"),
    );
    expect(mutationCall).toBeDefined();
    const mutationHeaders = new Headers(mutationCall?.[1]?.headers);
    expect(mutationHeaders.get("authorization")).toBe("Bearer server-owned-token");
    expect(mutationHeaders.get("idempotency-key")).toBe("persisted-home-workspace-key");
  });

  it("rejects browser authority/model fields and non-existing profiles before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const strict = await POST(
      request({
        actor: { role: "owner" },
        address: "14 Secret Mews",
        confirmUnmeasuredInterior: true,
        dimensions: [1, 2, 3],
        snapshot: { profile: "existing" },
      }),
      context(),
    );
    const falseAcknowledgement = await POST(
      request({ confirmUnmeasuredInterior: false }),
      context(),
    );
    const proposed = await POST(request({ confirmUnmeasuredInterior: true }), context("proposed"));

    expect([strict.status, falseAcknowledgement.status, proposed.status]).toEqual([400, 400, 404]);
    expect(await strict.text()).not.toContain("14 Secret Mews");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for viewer, expired session, and absent property platform responses", async () => {
    const viewerFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: "FORBIDDEN" }, { status: 403 }));
    vi.stubGlobal("fetch", viewerFetch);
    const viewer = await POST(request({ confirmUnmeasuredInterior: true }), context());
    expect(viewer.status).toBe(403);
    expect(viewerFetch).toHaveBeenCalledTimes(1);

    const expiredFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: "SESSION_EXPIRED" }, { status: 401 }));
    vi.stubGlobal("fetch", expiredFetch);
    const expired = await POST(request({ confirmUnmeasuredInterior: true }), context());
    expect(expired.status).toBe(401);
    expect(expired.headers.get("set-cookie")).toContain("hds_c1_session=");

    const absentFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { address: "14 Secret Mews", code: "PROPERTY_NOT_SELECTED", internal: "hidden" },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", absentFetch);
    const absent = await POST(request({ confirmUnmeasuredInterior: true }), context());
    const absentBody = await absent.text();
    expect(absent.status).toBe(409);
    expect(absentBody).toContain("PROPERTY_NOT_SELECTED");
    expect(absentBody).not.toMatch(/Secret Mews|internal/iu);
  });

  it("sanitizes unavailable model-service failures without echoing upstream data", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json(
        {
          address: "14 Secret Mews",
          code: "MODEL_BACKEND_UNAVAILABLE",
          databaseLocator: "private-cluster",
          detail: "raw provider failure",
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ confirmUnmeasuredInterior: true }), context());
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toMatch(/Secret Mews|private-cluster|raw provider failure/iu);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const initializedFetch = vi.fn().mockResolvedValueOnce(
      Response.json(
        {
          code: "TYPED_OPERATION_REQUIRED",
          databaseLocator: "private-cluster",
          detail: "raw already initialized detail",
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", initializedFetch);
    const initialized = await POST(request({ confirmUnmeasuredInterior: true }), context());
    const initializedBody = await initialized.text();
    expect(initialized.status).toBe(409);
    expect(initializedBody).toContain("TYPED_OPERATION_REQUIRED");
    expect(initializedBody).not.toMatch(/private-cluster|raw already initialized detail/iu);
  });
});
