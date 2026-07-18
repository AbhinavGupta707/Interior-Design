import type { Actor, CreateSceneJobRequest } from "@interior-design/contracts";
import { describe, expect, it, vi } from "vitest";

import { C10SpecificationSceneJobPort } from "../../src/c13.js";
import type { RequestCorrelation } from "../../src/correlation.js";
import type { SceneService } from "../../src/modules/scenes/service.js";
import type { SpecificationSceneRequest } from "../../src/modules/specifications/types.js";

const ids = {
  branch: "13000000-0000-4000-8000-000000000001",
  job: "13000000-0000-4000-8000-000000000002",
  model: "13000000-0000-4000-8000-000000000003",
  project: "13000000-0000-4000-8000-000000000004",
  snapshot: "13000000-0000-4000-8000-000000000005",
  specification: "13000000-0000-4000-8000-000000000006",
  tenant: "13000000-0000-4000-8000-000000000007",
  user: "13000000-0000-4000-8000-000000000008",
} as const;

const actor: Actor = {
  displayName: "C13 owner",
  role: "owner",
  subject: "fixture|c13-owner",
  tenantId: ids.tenant,
  userId: ids.user,
};
const correlation: RequestCorrelation = {
  requestId: "c13-scene-request-0001",
  spanId: "a".repeat(16),
  traceId: "b".repeat(32),
  traceParent: `00-${"b".repeat(32)}-${"a".repeat(16)}-01`,
};
const request: SpecificationSceneRequest = {
  branchId: ids.branch,
  branchRevision: 2,
  modelId: ids.model,
  modelSnapshotId: ids.snapshot,
  modelSnapshotSha256: "1".repeat(64),
  projectId: ids.project,
  sceneJobId: ids.job,
  specificationId: ids.specification,
  specificationRevision: 2,
  specificationRevisionSha256: "2".repeat(64),
};

interface RecordedSceneCommand {
  readonly actor: Actor;
  readonly cacheContextSha256: string;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly request: CreateSceneJobRequest;
  readonly requestedJobId?: string;
}

describe("C13 root scene composition", () => {
  it("dispatches the preallocated exact job through C10 with the specification hash in cache identity", async () => {
    const createJob = vi.fn((command: RecordedSceneCommand) =>
      Promise.resolve({ job: { id: command.requestedJobId }, replayed: false }),
    );
    const port = new C10SpecificationSceneJobPort({ createJob } as unknown as SceneService);

    await expect(port.requestExactRevision(request, actor, correlation)).resolves.toBeUndefined();
    expect(createJob).toHaveBeenCalledTimes(1);
    const dispatched = createJob.mock.calls[0]?.[0];
    if (dispatched === undefined) throw new Error("C13 scene dispatch was not recorded.");
    expect(dispatched).toMatchObject({
      actor,
      cacheContextSha256: request.specificationRevisionSha256,
      correlation,
      idempotencyKey: `c13-scene-${ids.job}`,
      projectId: ids.project,
      requestedJobId: ids.job,
    });
    expect(dispatched.request.sourceSnapshot).toMatchObject({
      modelId: ids.model,
      profile: "proposed",
      snapshotId: ids.snapshot,
      snapshotSha256: request.modelSnapshotSha256,
    });
  });

  it("fails closed when C10 reuses a different job identity", async () => {
    const createJob = vi.fn(() =>
      Promise.resolve({
        job: { id: "13000000-0000-4000-8000-000000000099" },
        replayed: true,
      }),
    );
    const port = new C10SpecificationSceneJobPort({ createJob } as unknown as SceneService);
    await expect(port.requestExactRevision(request, actor, correlation)).rejects.toThrow(
      "different exact scene job identity",
    );
  });
});
