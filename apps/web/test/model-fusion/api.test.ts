import { describe, expect, it, vi } from "vitest";

import { createFusionClient, FusionProblem } from "../../src/features/discrepancy-review/api";
import { branch, decision, draft, fusionRequest, job, proposal, workspace } from "./fixtures";

describe("C9 browser client", () => {
  it("validates the workspace and sends exact optimistic job transitions", async () => {
    const cancelled = { ...job, state: "cancelled" as const, version: 2 };
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(workspace))
      .mockResolvedValueOnce(Response.json(cancelled));
    const client = createFusionClient(transport);
    expect((await client.loadWorkspace(workspace.project.id)).sources).toHaveLength(2);
    await client.cancel(workspace.project.id, job);
    const [, init] = transport.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: job.version });
    expect(new Headers(init.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("sends only frozen C9 create/review/draft bodies and exact branch pins", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(
        Response.json({ decisions: [decision], proposal: { ...proposal, version: 2 } }),
      )
      .mockResolvedValueOnce(Response.json(draft));
    const client = createFusionClient(transport);
    await client.createJob(workspace.project.id, fusionRequest);
    await client.review(workspace.project.id, job.id, {
      decisions: [
        {
          choice: "mark-unknown",
          correctedOperations: [],
          discrepancyId: decision.discrepancyId,
          reason: decision.reason,
        },
      ],
      expectedProposalVersion: proposal.version,
    });
    await client.createDraft(workspace.project.id, job.id, {
      branchId: branch.id,
      decisionIds: [decision.id],
      expectedBranchRevision: branch.revision,
      expectedHeadSnapshotSha256: branch.headSnapshotSha256,
      expectedProposalVersion: 2,
    });
    const calls = transport.mock.calls as [string, RequestInit][];
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual(fusionRequest);
    expect(JSON.parse(calls[2]?.[1].body as string)).toMatchObject({
      branchId: branch.id,
      expectedBranchRevision: 0,
      expectedHeadSnapshotSha256: branch.headSnapshotSha256,
    });
    expect(JSON.stringify(calls)).not.toMatch(/preview|commit|role|accessToken/u);
  });

  it("distinguishes offline recovery, conflicts and invalid service contracts", async () => {
    await expect(
      createFusionClient(vi.fn().mockRejectedValue(new Error("offline"))).loadWorkspace(
        workspace.project.id,
      ),
    ).rejects.toMatchObject({ kind: "offline" });
    await expect(
      createFusionClient(
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { code: "FUSION_JOB_VERSION_CONFLICT", detail: "Reload." },
              { status: 409 },
            ),
          ),
      ).cancel(workspace.project.id, job),
    ).rejects.toMatchObject({ kind: "conflict", code: "FUSION_JOB_VERSION_CONFLICT" });
    await expect(
      createFusionClient(
        vi.fn().mockResolvedValue(Response.json({ jobs: "invalid" })),
      ).loadWorkspace(workspace.project.id),
    ).rejects.toBeInstanceOf(FusionProblem);
  });
});
