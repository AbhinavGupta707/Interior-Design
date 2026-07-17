import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c9/[...segments]/route";
import {
  branch,
  decision,
  draft,
  fusionRequest,
  job,
  planJob,
  planProposal,
  proposal,
  project,
  reconstructionJob,
  reconstructionResult,
  session,
  snapshotRecord,
} from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, key = "c9-test-key") {
  return new NextRequest("http://localhost:3000/api/c9/test", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: "hds_c1_session=server-owned-token",
      ...(method === "GET" ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    method,
  });
}

describe("C9 same-origin BFF", () => {
  it("composes exact C4/C5/C6/C7/C8 state and exposes bounded source descriptors only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(project))
      .mockResolvedValueOnce(Response.json({ jobs: [] }))
      .mockResolvedValueOnce(Response.json(snapshotRecord))
      .mockResolvedValueOnce(
        Response.json({ branches: [branch], profile: "existing", projectId: project.id }),
      )
      .mockResolvedValueOnce(Response.json({ jobs: [planJob] }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ jobs: [reconstructionJob] }))
      .mockResolvedValueOnce(Response.json(planProposal))
      .mockResolvedValueOnce(Response.json(reconstructionResult));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(), context(["projects", project.id, "workspace"]));
    const payload = (await response.json()) as {
      readonly capabilities: Record<string, string>;
      readonly sources: readonly {
        readonly label: string;
        readonly source: { readonly kind: string; readonly sha256: string };
      }[];
    };
    expect(response.status).toBe(200);
    expect(payload.sources.map(({ source }) => source.kind)).toEqual([
      "plan-proposal",
      "reconstruction-result",
    ]);
    expect(payload.sources.every(({ source }) => /^[a-f0-9]{64}$/u.test(source.sha256))).toBe(true);
    expect(payload.capabilities).toEqual({
      geometryProducer: "unavailable",
      semanticProducer: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(10);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-token");
    }
    expect(JSON.stringify(payload)).not.toMatch(/objectKey|signedUrl|credential|accessToken/u);
  });

  it("rejects malformed IDs, browser authority and short keys before any upstream request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await GET(request(), context(["projects", "not-a-uuid", "workspace"]));
    const authority = await POST(
      request("POST", { ...fusionRequest, role: "owner" }),
      context(["projects", project.id, "fusion-jobs"]),
    );
    const short = await POST(
      request("POST", fusionRequest, "short"),
      context(["projects", project.id, "fusion-jobs"]),
    );
    expect([malformed.status, authority.status, short.status]).toEqual([404, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards optimistic cancellation and strips unsafe upstream diagnostic fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...job, state: "cancelled", version: 2 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "FUSION_PRODUCER_UNAVAILABLE",
            detail: "No local producer is configured.",
            objectKey: "must-not-leak",
            stderr: "must-not-leak",
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const cancelled = await POST(
      request("POST", { expectedVersion: job.version }, "c9-cancel-key-0001"),
      context(["projects", project.id, "fusion-jobs", job.id, "cancel"]),
    );
    const [, cancelInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(cancelled.status).toBe(200);
    expect(new Headers(cancelInit.headers).get("idempotency-key")).toBe("c9-cancel-key-0001");
    const failed = await GET(request(), context(["projects", project.id, "fusion-jobs", job.id]));
    const body = await failed.text();
    expect(failed.status).toBe(503);
    expect(body).toContain("FUSION_PRODUCER_UNAVAILABLE");
    expect(body).not.toMatch(/objectKey|stderr|must-not-leak/u);
  });

  it("proxies attributed review and operation-draft routes without any C5 preview or commit call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ decisions: [decision], proposal: { ...proposal, version: 2 } }),
      )
      .mockResolvedValueOnce(Response.json(draft, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const reviewBody = {
      decisions: [
        {
          choice: "mark-unknown",
          correctedOperations: [],
          discrepancyId: decision.discrepancyId,
          reason: decision.reason,
        },
      ],
      expectedProposalVersion: 1,
    };
    const review = await POST(
      request("POST", reviewBody, "c9-review-key-0001"),
      context(["projects", project.id, "fusion-jobs", job.id, "proposal", "discrepancy-decisions"]),
    );
    expect(review.status).toBe(200);
    const draftResponse = await POST(
      request(
        "POST",
        {
          branchId: branch.id,
          decisionIds: [decision.id],
          expectedBranchRevision: branch.revision,
          expectedHeadSnapshotSha256: branch.headSnapshotSha256,
          expectedProposalVersion: 2,
        },
        "c9-draft-key-0001",
      ),
      context(["projects", project.id, "fusion-jobs", job.id, "proposal", "operation-drafts"]),
    );
    expect(draftResponse.status).toBe(201);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      expect.stringContaining("/proposal/discrepancy-decisions"),
      expect.stringContaining("/proposal/operation-drafts"),
    ]);
    expect(urls.join(" ")).not.toMatch(/previews|commits/u);
  });
});
