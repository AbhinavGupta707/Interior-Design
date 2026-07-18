import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../../apps/web/src/app/api/c12/[...segments]/route";
import {
  ids,
  job,
  launchContext,
  optionA,
  optionsResponse,
} from "../../../apps/web/test/design-options/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const key = "c1200000-0000-4000-8000-000000000099";
const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(
  body?: unknown,
  options?: { readonly authorization?: string; readonly cookie?: boolean; readonly key?: string },
) {
  const result = new Request("http://localhost:3000/api/c12/security", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(options?.authorization ? { authorization: options.authorization } : {}),
      ...(options?.cookie === false ? {} : { cookie: "hds_c1_session=private-c12-token" }),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "idempotency-key": options?.key ?? key }),
    },
    method: body === undefined ? "GET" : "POST",
  });
  Object.defineProperty(result, "cookies", {
    value: {
      get(name: string) {
        return options?.cookie === false || name !== "hds_c1_session"
          ? undefined
          : { value: "private-c12-token" };
      },
    },
  });
  return result;
}

describe("C12 independent BFF security", () => {
  it("does not accept browser Authorization as a session substitute", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      request(undefined, { authorization: "Bearer attacker", cookie: false }),
      context(["projects", ids.project, "design-option-jobs"]),
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, encoded IDs, extra segments, and browser-supplied constraint authority", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const traversal = await POST(
      request({ ...launchContext, role: "owner", hardConstraintsPassed: true }),
      context(["projects", ids.project, "design-option-jobs"]),
    );
    const encoded = await GET(
      request(),
      context(["projects", ids.project, "design-option-jobs", `${ids.job}%2F..%2Fmodels`]),
    );
    const extra = await GET(
      request(),
      context([
        "projects",
        ids.project,
        "design-option-jobs",
        ids.job,
        "options",
        ids.optionA,
        "raw",
      ]),
    );
    expect([traversal.status, encoded.status, extra.status]).toEqual([400, 404, 404]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects forged confirmation pins and mismatched idempotency before forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      request({
        expectedBriefContentSha256: optionA.baseBrief.contentSha256,
        expectedBriefRevision: optionA.baseBrief.revision,
        expectedJobVersion: -1,
        expectedOptionSetSha256: optionsResponse.optionSet?.setSha256,
        expectedOptionStatus: "confirmed",
        expectedSourceSnapshotSha256: job.sourceModel.snapshotSha256,
        idempotencyKey: "c1200000-0000-4000-8000-000000000098",
      }),
      context([
        "projects",
        ids.project,
        "design-option-jobs",
        ids.job,
        "options",
        ids.optionA,
        "confirm",
      ]),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on foreign-tenant response identities before disclosure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...job, projectId: "c1200000-0000-4000-8000-000000000097" }),
        ),
    );
    const response = await GET(
      request(),
      context(["projects", ids.project, "design-option-jobs", ids.job]),
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("000000000097");
  });

  it("redacts brief content, operations, assets, tokens, and locators from upstream failures and logs", async () => {
    const privateMarker = "PRIVATE_C12_ACCESSIBILITY_AND_ASSET_MARKER";
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            accessToken: "private-c12-token",
            assets: [{ locator: "s3://private/customer/object" }],
            detail: privateMarker,
            operations: [privateMarker],
          },
          { status: 500 },
        ),
      ),
    );
    const response = await GET(
      request(),
      context(["projects", ids.project, "design-option-jobs", ids.job]),
    );
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toMatch(/PRIVATE_C12|private-c12-token|s3:\/\/|operations|assets/iu);
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});
