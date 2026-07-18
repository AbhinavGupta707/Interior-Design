import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c12/[...segments]/route";
import { confirmationA, ids, job, launchContext, optionA, optionsResponse } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });
const mutationKey = "c1200000-0000-4000-8000-000000000099";

function requestBody(init: RequestInit): string {
  if (typeof init.body !== "string") throw new Error("Expected a JSON string request body");
  return init.body;
}

function request(method = "GET", body?: unknown, key = mutationKey) {
  return new NextRequest("http://localhost:3000/api/c12/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-c12-token",
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C12 exact same-origin BFF", () => {
  it("proxies all four read routes with strict project/job/option response validation", async () => {
    const cases = [
      {
        payload: { jobs: [job], projectId: ids.project },
        segments: ["projects", ids.project, "design-option-jobs"],
        suffix: `/v1/projects/${ids.project}/design-option-jobs`,
      },
      {
        payload: job,
        segments: ["projects", ids.project, "design-option-jobs", ids.job],
        suffix: `/v1/projects/${ids.project}/design-option-jobs/${ids.job}`,
      },
      {
        payload: optionsResponse,
        segments: ["projects", ids.project, "design-option-jobs", ids.job, "options"],
        suffix: `/v1/projects/${ids.project}/design-option-jobs/${ids.job}/options`,
      },
      {
        payload: optionA,
        segments: ["projects", ids.project, "design-option-jobs", ids.job, "options", ids.optionA],
        suffix: `/v1/projects/${ids.project}/design-option-jobs/${ids.job}/options/${ids.optionA}`,
      },
    ];
    for (const testCase of cases) {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(testCase.payload));
      vi.stubGlobal("fetch", fetchMock);
      const response = await GET(request(), context(testCase.segments));
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(testCase.suffix);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-c12-token");
      expect(JSON.stringify(await response.json())).not.toMatch(
        /server-owned|authorization|token/iu,
      );
      vi.unstubAllGlobals();
    }
  });

  it("proxies create, cancel, retry, and confirmation with UUID idempotency", async () => {
    const mutations = [
      {
        body: launchContext,
        payload: job,
        segments: ["projects", ids.project, "design-option-jobs"],
        suffix: `/v1/projects/${ids.project}/design-option-jobs`,
      },
      {
        payload: {
          ...job,
          completedAt: undefined,
          optionCount: 0,
          stage: "publishing",
          state: "cancel-requested",
        },
        segments: ["projects", ids.project, "design-option-jobs", ids.job, "cancel"],
        suffix: `/v1/projects/${ids.project}/design-option-jobs/${ids.job}/cancel`,
      },
      {
        payload: {
          ...job,
          completedAt: undefined,
          optionCount: 0,
          stage: "generating",
          state: "running",
        },
        segments: ["projects", ids.project, "design-option-jobs", ids.job, "retry"],
        suffix: `/v1/projects/${ids.project}/design-option-jobs/${ids.job}/retry`,
      },
    ];
    for (const testCase of mutations) {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(testCase.payload));
      vi.stubGlobal("fetch", fetchMock);
      const response = await POST(request("POST", testCase.body), context(testCase.segments));
      expect(response.status).toBe(200);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(testCase.suffix);
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("idempotency-key")).toBe(mutationKey);
      vi.unstubAllGlobals();
    }

    const confirmationBody = {
      expectedBriefContentSha256: optionA.baseBrief.contentSha256,
      expectedBriefRevision: optionA.baseBrief.revision,
      expectedJobVersion: job.version,
      expectedOptionSetSha256: optionsResponse.optionSet?.setSha256,
      expectedOptionStatus: "pending",
      expectedSourceSnapshotSha256: job.sourceModel.snapshotSha256,
      idempotencyKey: mutationKey,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ...confirmationA, idempotencyKey: mutationKey }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      request("POST", confirmationBody),
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
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/options/${ids.optionA}/confirm`);
    expect(JSON.parse(requestBody(init))).toEqual(confirmationBody);
  });

  it("rejects forged authority, malformed paths, IDs, and key mismatch before upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const forged = await POST(
      request("POST", { ...launchContext, constraints: [{ passed: true }] }),
      context(["projects", ids.project, "design-option-jobs"]),
    );
    expect(forged.status).toBe(400);
    const malformed = await GET(
      request(),
      context(["projects", "not-a-uuid", "design-option-jobs"]),
    );
    expect(malformed.status).toBe(404);
    const unknown = await POST(
      request("POST"),
      context(["projects", ids.project, "design-option-jobs", ids.job, "delete"]),
    );
    expect(unknown.status).toBe(404);
    const mismatch = await POST(
      request(
        "POST",
        {
          expectedBriefContentSha256: optionA.baseBrief.contentSha256,
          expectedBriefRevision: optionA.baseBrief.revision,
          expectedJobVersion: job.version,
          expectedOptionSetSha256: optionsResponse.optionSet?.setSha256,
          expectedOptionStatus: "pending",
          expectedSourceSnapshotSha256: job.sourceModel.snapshotSha256,
          idempotencyKey: "c1200000-0000-4000-8000-000000000098",
        },
        mutationKey,
      ),
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
    expect(mismatch.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on foreign/malformed upstream data and redacts raw private errors", async () => {
    const foreign = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...job, projectId: "c1200000-0000-4000-8000-000000000097" }),
      );
    vi.stubGlobal("fetch", foreign);
    const mismatch = await GET(
      request(),
      context(["projects", ids.project, "design-option-jobs", ids.job]),
    );
    expect(mismatch.status).toBe(502);

    const privateMarker = "PRIVATE_ACCESSIBILITY_BRIEF_AND_TOKEN";
    const rejected = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { code: "SOURCE_CHANGED", detail: privateMarker, operations: [{ privateMarker }] },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", rejected);
    const response = await GET(
      request(),
      context(["projects", ids.project, "design-option-jobs", ids.job]),
    );
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(409);
    expect(serialized).toContain("SOURCE_CHANGED");
    expect(serialized).not.toContain(privateMarker);
    expect(serialized).not.toMatch(/operations|asset payload|credential/iu);
  });

  it("rejects oversized request bodies and mismatched option-set or confirmation identities", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const oversized = await POST(
      request("POST", { ...launchContext, padding: "x".repeat(17 * 1024) }),
      context(["projects", ids.project, "design-option-jobs"]),
    );
    expect(oversized.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...optionsResponse,
          options: [{ ...optionA, jobId: "c1200000-0000-4000-8000-000000000097" }],
        }),
      ),
    );
    const forgedSet = await GET(
      request(),
      context(["projects", ids.project, "design-option-jobs", ids.job, "options"]),
    );
    expect(forgedSet.status).toBe(502);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(confirmationA)));
    const forgedConfirmation = await POST(
      request("POST", {
        expectedBriefContentSha256: optionA.baseBrief.contentSha256,
        expectedBriefRevision: optionA.baseBrief.revision,
        expectedJobVersion: job.version,
        expectedOptionSetSha256: optionsResponse.optionSet?.setSha256,
        expectedOptionStatus: "pending",
        expectedSourceSnapshotSha256: job.sourceModel.snapshotSha256,
        idempotencyKey: mutationKey,
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
    expect(forgedConfirmation.status).toBe(502);
  });
});
