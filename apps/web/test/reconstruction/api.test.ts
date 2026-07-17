import { describe, expect, it, vi } from "vitest";

import {
  ReconstructionProblem,
  createReconstructionClient,
} from "../../src/features/reconstruction/api";
import { job, workspace } from "./fixtures";

describe("C8 browser client", () => {
  it("validates a workspace and sends exact optimistic mutation state", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(workspace))
      .mockResolvedValueOnce(
        Response.json({ ...job, state: "cancelled", retryable: true, version: 2 }),
      );
    const client = createReconstructionClient(transport);
    expect((await client.loadWorkspace(workspace.project.id)).assets).toHaveLength(1);
    await client.cancel(workspace.project.id, job);
    const [, init] = transport.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 1 });
    expect(new Headers(init.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("distinguishes offline recovery from an invalid service contract", async () => {
    const offline = createReconstructionClient(vi.fn().mockRejectedValue(new Error("offline")));
    await expect(offline.loadWorkspace(workspace.project.id)).rejects.toMatchObject({
      kind: "offline",
    });
    const invalid = createReconstructionClient(
      vi.fn().mockResolvedValue(Response.json({ jobs: "not-an-array" })),
    );
    await expect(invalid.loadWorkspace(workspace.project.id)).rejects.toBeInstanceOf(
      ReconstructionProblem,
    );
    await expect(invalid.loadWorkspace(workspace.project.id)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });
});
