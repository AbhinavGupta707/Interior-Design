import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../../apps/web/src/app/api/c11/[...segments]/route";
import { promptLikeText, securityIds, securityProposal } from "./hostile-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const key = "f1100000-0000-4000-8000-000000000099";
const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(
  body?: unknown,
  options?: { readonly authorization?: string; readonly cookie?: boolean },
) {
  const result = new Request("http://localhost:3000/api/c11/security", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(options?.authorization ? { authorization: options.authorization } : {}),
      ...(options?.cookie === false ? {} : { cookie: "hds_c1_session=private-server-token" }),
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method: body === undefined ? "GET" : "POST",
  });
  Object.defineProperty(result, "cookies", {
    value: {
      get(name: string) {
        return options?.cookie === false || name !== "hds_c1_session"
          ? undefined
          : { value: "private-server-token" };
      },
    },
  });
  return result;
}

describe("C11 independent BFF security", () => {
  it("does not accept browser Authorization as a session substitute", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      request(undefined, { authorization: "Bearer attacker", cookie: false }),
      context(["projects", securityIds.project, "workspace"]),
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects traversal, extra path segments and non-UUID resource identities", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const traversal = await POST(
      request({ expectedBriefRevision: 2, idempotencyKey: key }),
      context([
        "projects",
        securityIds.project,
        "design-consultations",
        securityIds.session,
        "proposals",
        "..",
        "confirm",
      ]),
    );
    const injected = await GET(
      request(),
      context([
        "projects",
        securityIds.project,
        "design-consultations",
        `${securityIds.session}%2F..%2Fmodels`,
      ]),
    );
    const extra = await GET(
      request(),
      context(["projects", securityIds.project, "workspace", "unexpected"]),
    );
    expect([traversal.status, injected.status, extra.status]).toEqual([404, 404, 404]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces message limits and rejects browser-supplied authority before forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tooLong = await POST(
      request({
        clientMessageId: key,
        expectedBriefRevision: 2,
        message: "x".repeat(8_001),
      }),
      context([
        "projects",
        securityIds.project,
        "design-consultations",
        securityIds.session,
        "turns",
      ]),
    );
    const authority = await POST(
      request({
        clientMessageId: key,
        expectedBriefRevision: 2,
        message: "ordinary bounded message",
        role: "owner",
        tenantId: "attacker",
      }),
      context([
        "projects",
        securityIds.project,
        "design-consultations",
        securityIds.session,
        "turns",
      ]),
    );
    expect([tooLong.status, authority.status]).toEqual([400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards prompt-like text as a bounded turn only and never as a path or policy", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(securityProposal));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      request({
        clientMessageId: key,
        expectedBriefRevision: 2,
        message: promptLikeText,
      }),
      context([
        "projects",
        securityIds.project,
        "design-consultations",
        securityIds.session,
        "turns",
      ]),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://127.0.0.1:4100/v1/projects/${securityIds.project}/design-consultations/${securityIds.session}/turns`,
    );
    expect(String(init.body)).toContain("attacker.invalid");
    expect(url).not.toContain("attacker.invalid");
    expect(url).not.toMatch(/\/models|snapshot|operation/iu);
  });

  it("redacts tokens, locators and raw prompts from upstream errors and console output", async () => {
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
            accessToken: "private-server-token",
            detail: `${promptLikeText} at s3://private/customer/object`,
            refreshToken: "refresh-secret",
          },
          { status: 500 },
        ),
      ),
    );
    const response = await GET(
      request(),
      context(["projects", securityIds.project, "design-consultations", securityIds.session]),
    );
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toMatch(/attacker|private-server|refresh-secret|s3:\/\//iu);
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});
