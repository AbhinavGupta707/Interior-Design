import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c5/[...segments]/route";
import { branch, snapshotRecord, uuid } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, key = "c5-test-key") {
  return new NextRequest("http://localhost:3000/api/c5/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-token",
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C5 same-origin BFF", () => {
  it("loads the exact branch head and source using only server-owned authorisation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(branch))
      .mockResolvedValueOnce(Response.json(snapshotRecord));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      request(),
      context(["projects", uuid(5), "models", "existing", "branches", branch.id]),
    );
    const payload: unknown = await response.json();
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(firstInit.headers);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      branch,
      headSnapshot: snapshotRecord,
      sourceSnapshot: snapshotRecord,
    });
    expect(headers.get("authorization")).toBe("Bearer server-owned-token");
    expect(headers.get("x-role")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed IDs, authority fields, and short mutation keys before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await GET(
      request(),
      context(["projects", "not-a-uuid", "models", "existing", "branches"]),
    );
    const authority = await POST(
      request("POST", {
        expectedHeadSnapshotSha256: "a".repeat(64),
        expectedRevision: 0,
        operations: [],
        role: "owner",
      }),
      context(["projects", uuid(5), "models", "existing", "branches", branch.id, "previews"]),
    );
    const shortKey = await POST(
      request(
        "POST",
        {
          name: "Study",
          sourceSnapshotId: snapshotRecord.id,
          sourceSnapshotSha256: "a".repeat(64),
        },
        "short",
      ),
      context(["projects", uuid(5), "models", "existing", "branches"]),
    );

    expect([malformed.status, authority.status, shortKey.status]).toEqual([404, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when a branch points to a mismatched upstream snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(branch))
        .mockResolvedValueOnce(Response.json({ ...snapshotRecord, id: uuid(99) })),
    );
    const response = await GET(
      request(),
      context(["projects", uuid(5), "models", "existing", "branches", branch.id]),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(uuid(99));
  });

  it("sanitizes conflict recovery fields and strips raw internal data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "BRANCH_REVISION_CONFLICT",
            currentHeadSnapshotSha256: "b".repeat(64),
            currentRevision: 4,
            databaseLocator: "must-not-leak",
            detail: "Reload exact branch state.",
          },
          { status: 409 },
        ),
      ),
    );
    const response = await POST(
      request("POST", {
        name: "Study",
        sourceSnapshotId: snapshotRecord.id,
        sourceSnapshotSha256: "a".repeat(64),
      }),
      context(["projects", uuid(5), "models", "existing", "branches"]),
    );
    const body = await response.text();
    expect(response.status).toBe(409);
    expect(body).toContain("BRANCH_REVISION_CONFLICT");
    expect(body).toContain('"currentRevision":4');
    expect(body).not.toContain("databaseLocator");
  });
});
