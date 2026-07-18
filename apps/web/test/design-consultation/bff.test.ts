import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c11/[...segments]/route";
import { brief, consultation, ids, ownerSession, project, proposal } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, key = "c1100000-0000-4000-8000-000000000099") {
  return new NextRequest("http://localhost:3000/api/c11/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-c11-token",
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C11 same-origin BFF", () => {
  it("composes a strict local-only workspace without exposing the session token", async () => {
    vi.stubEnv("C11_CONSULTATION_EVIDENCE_CLASSIFICATION", "fixture-presentation");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ownerSession))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json(brief));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), context(["projects", ids.project, "workspace"]));
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.capability).toEqual(
      expect.objectContaining({ externalNetworkUsed: false, externalProviders: "disabled" }),
    );
    expect(JSON.stringify(payload)).not.toMatch(
      /server-owned|accessToken|authorization|credential/iu,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-c11-token");
    }
  });

  it("returns an address-free explicit initialization state without mutating during GET", async () => {
    const savedIntake = {
      intake: {
        accessibilityNeeds: ["Step-free circulation."],
        addressSummary: "48 Sensitive Street, ZZ1 1ZZ",
        dwellingType: "flat",
        evidenceAvailable: {
          photographs: false,
          plans: false,
          roomCapture: false,
          video: false,
        },
        goals: ["Make the dining room easier to use."],
        household: { adults: 2, children: 0, pets: 0 },
        mustChange: ["Improve evening lighting."],
        mustKeep: ["Keep the oak table."],
        styleWords: ["warm mineral"],
      },
      projectId: ids.project,
      updatedAt: "2026-07-18T09:00:00.000Z",
      updatedBy: ids.viewer,
      version: 2,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(ownerSession))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json({ detail: "no brief" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(savedIntake));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), context(["projects", ids.project, "workspace"]));
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.brief).toBeNull();
    expect(payload.intake).toEqual({
      accessibilityNeeds: savedIntake.intake.accessibilityNeeds,
      goals: savedIntake.intake.goals,
      mustChange: savedIntake.intake.mustChange,
      mustKeep: savedIntake.intake.mustKeep,
      projectId: ids.project,
      styleWords: savedIntake.intake.styleWords,
      updatedAt: savedIntake.updatedAt,
      updatedBy: ids.viewer,
      version: 2,
    });
    expect(JSON.stringify(payload)).not.toContain("Sensitive Street");
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(init.body).toBeUndefined();
      expect(init.method ?? "GET").toBe("GET");
    }
  });

  it("keeps browser update POST but forwards the frozen design-brief update as upstream PUT", async () => {
    const key = "c1100000-0000-4000-8000-000000000099";
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...brief, revision: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      request(
        "POST",
        {
          expectedRevision: brief.revision,
          idempotencyKey: key,
          operations: proposal.operations,
        },
        key,
      ),
      context(["projects", ids.project, "design-brief"]),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/projects/" + ids.project + "/design-brief");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
  });

  it("rejects malformed paths, IDs, browser authority and key mismatches before upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformedProject = await GET(request(), context(["projects", "not-a-uuid", "workspace"]));
    const malformedSession = await GET(
      request(),
      context(["projects", ids.project, "design-consultations", "not-a-uuid"]),
    );
    const authority = await POST(
      request("POST", {
        expectedRevision: brief.revision,
        idempotencyKey: "c1100000-0000-4000-8000-000000000099",
        operations: proposal.operations,
        role: "owner",
      }),
      context(["projects", ids.project, "design-brief"]),
    );
    const mismatch = await POST(
      request("POST", {
        expectedRevision: brief.revision,
        idempotencyKey: "c1100000-0000-4000-8000-000000000098",
        operations: proposal.operations,
      }),
      context(["projects", ids.project, "design-brief"]),
    );
    expect([
      malformedProject.status,
      malformedSession.status,
      authority.status,
      mismatch.status,
    ]).toEqual([404, 404, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only a validated proposal confirmation with no browser role or token", async () => {
    const key = "c1100000-0000-4000-8000-000000000099";
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...brief, revision: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      request("POST", { expectedBriefRevision: brief.revision, idempotencyKey: key }, key),
      context([
        "projects",
        ids.project,
        "design-consultations",
        ids.session,
        "proposals",
        ids.proposal,
        "confirm",
      ]),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      `/v1/projects/${ids.project}/design-consultations/${ids.session}/proposals/${ids.proposal}/confirm`,
    );
    expect(url).not.toMatch(/\/models|snapshots|operation/u);
    expect(init.body).not.toContain("role");
    expect(init.body).not.toContain("token");
    expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
    expect(init.method).toBe("POST");
  });

  it("preserves viewer/IDOR denial status while redacting hostile upstream diagnostics", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            accessToken: "must-not-leak",
            code: "BRIEF_REVISION_CONFLICT",
            detail: "Bearer secret-token at private locator /tenant/a",
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ detail: "foreign tenant" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const stale = await POST(
      request("POST", {
        expectedRevision: brief.revision,
        idempotencyKey: "c1100000-0000-4000-8000-000000000099",
        operations: proposal.operations,
      }),
      context(["projects", ids.project, "design-brief"]),
    );
    const foreign = await GET(
      request(),
      context(["projects", ids.project, "design-consultations", ids.session]),
    );
    const text = await stale.text();
    expect([stale.status, foreign.status]).toEqual([409, 404]);
    expect(text).toContain("BRIEF_REVISION_CONFLICT");
    expect(text).not.toMatch(/must-not-leak|secret-token|private locator|tenant\/a/iu);
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("fails closed when valid-shaped upstream resources belong to another identity", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...consultation, projectId: "c1100000-0000-4000-8000-000000000088" }),
      )
      .mockResolvedValueOnce(
        Response.json({ ...proposal, id: "c1100000-0000-4000-8000-000000000087" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const wrongSession = await GET(
      request(),
      context(["projects", ids.project, "design-consultations", ids.session]),
    );
    const wrongProposal = await GET(
      request(),
      context([
        "projects",
        ids.project,
        "design-consultations",
        ids.session,
        "proposals",
        ids.proposal,
      ]),
    );
    expect([wrongSession.status, wrongProposal.status]).toEqual([502, 502]);
  });
});
