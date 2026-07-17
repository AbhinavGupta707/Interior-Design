import { describe, expect, it, vi } from "vitest";

import { createPlanImportClient, PlanImportProblem } from "../../src/features/plan-import/api";
import { asset, branch, job, project, session } from "./fixtures";

describe("C6 browser client", () => {
  it("validates the combined refresh-safe workspace response", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        Response.json({ assets: [asset], branches: [branch], jobs: [job], project, session }),
      );
    const workspace = await createPlanImportClient(transport).loadWorkspace(project.id);
    expect(workspace.jobs[0]?.id).toBe(job.id);
    expect(transport).toHaveBeenCalledWith(
      `/api/c6/projects/${project.id}/workspace`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fails closed on an invalid upstream response", async () => {
    const client = createPlanImportClient(vi.fn().mockResolvedValue(Response.json({ jobs: [] })));
    await expect(client.loadWorkspace(project.id)).rejects.toMatchObject({
      code: "INVALID_UPSTREAM_RESPONSE",
      kind: "invalid-response",
    });
  });

  it("surfaces offline and conflict recovery without accepting authority from the browser", async () => {
    const offline = createPlanImportClient(vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(offline.loadWorkspace(project.id)).rejects.toBeInstanceOf(PlanImportProblem);

    const conflict = createPlanImportClient(
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "BRANCH_REVISION_CONFLICT",
            currentHeadSnapshotSha256: "e".repeat(64),
            currentRevision: 7,
            detail: "Reload the exact current head.",
          },
          { status: 409 },
        ),
      ),
    );
    await expect(
      conflict.retry(project.id, { ...job, retryable: true, state: "failed" }),
    ).rejects.toMatchObject({
      currentRevision: 7,
      kind: "conflict",
    });
  });
});
