import { randomUUID } from "node:crypto";

import {
  commitModelOperationsResponseSchema,
  listModelBranchesResponseSchema,
  modelBranchSchema,
  modelOperationHistoryResponseSchema,
  modelOperationsPreviewSchema,
  type ModelBranch,
} from "../../../packages/contracts/src/index.js";
import { describe, expect, it } from "vitest";

import {
  generatedRenameSequence,
  publicOperationCatalog,
} from "../../geometry/operations/operation-fixtures.js";

interface LivePersona {
  readonly projectId: string;
  readonly token: string;
}

const requiredEnvironment = [
  "C5_LIVE_API_URL",
  "C5_LIVE_PROJECT_ID",
  "C5_LIVE_PROFILE",
  "C5_LIVE_SOURCE_SNAPSHOT_ID",
  "C5_LIVE_SOURCE_SNAPSHOT_SHA256",
  "C5_LIVE_OWNER_TOKEN",
  "C5_LIVE_EDITOR_TOKEN",
  "C5_LIVE_VIEWER_TOKEN",
  "C5_LIVE_FOREIGN_PROJECT_ID",
  "C5_LIVE_FOREIGN_TOKEN",
] as const;
const missingEnvironment = requiredEnvironment.filter(
  (name) => (process.env[name] ?? "").length === 0,
);
const explicitLive = process.env.C5_RUN_LIVE_API === "1";
const fixtureSource = process.env.C5_LIVE_SOURCE_IS_C4_FIXTURE === "1";
const liveEnabled = explicitLive && missingEnvironment.length === 0;
const mutationEnabled = liveEnabled && fixtureSource;
const baseUrl = (process.env.C5_LIVE_API_URL ?? "http://127.0.0.1:0").replace(/\/$/u, "");
const profile = process.env.C5_LIVE_PROFILE ?? "existing";
const owner: LivePersona = {
  projectId: process.env.C5_LIVE_PROJECT_ID ?? randomUUID(),
  token: process.env.C5_LIVE_OWNER_TOKEN ?? "disabled",
};
const editor: LivePersona = {
  projectId: owner.projectId,
  token: process.env.C5_LIVE_EDITOR_TOKEN ?? "disabled",
};
const viewer: LivePersona = {
  projectId: owner.projectId,
  token: process.env.C5_LIVE_VIEWER_TOKEN ?? "disabled",
};
const foreign: LivePersona = {
  projectId: process.env.C5_LIVE_FOREIGN_PROJECT_ID ?? randomUUID(),
  token: process.env.C5_LIVE_FOREIGN_TOKEN ?? "disabled",
};

function branchCollectionPath(persona: LivePersona): string {
  return `/v1/projects/${persona.projectId}/models/${profile}/branches`;
}

function branchPath(persona: LivePersona, branchId: string): string {
  return `${branchCollectionPath(persona)}/${branchId}`;
}

async function apiRequest(
  persona: LivePersona,
  pathname: string,
  init: RequestInit,
  idempotencyKey?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${persona.token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (idempotencyKey !== undefined) headers.set("idempotency-key", idempotencyKey);
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers,
    redirect: "manual",
  });
}

async function json(response: Response): Promise<unknown> {
  const body = await response.text();
  return body.length === 0 ? undefined : (JSON.parse(body) as unknown);
}

function expectSuccess(response: Response): void {
  expect([200, 201]).toContain(response.status);
}

async function createBranch(
  persona: LivePersona,
  label: string,
  key = `c5-branch-${randomUUID()}`,
): Promise<ModelBranch> {
  const response = await apiRequest(
    persona,
    branchCollectionPath(persona),
    {
      body: JSON.stringify({
        name: label,
        sourceSnapshotId: process.env.C5_LIVE_SOURCE_SNAPSHOT_ID,
        sourceSnapshotSha256: process.env.C5_LIVE_SOURCE_SNAPSHOT_SHA256,
      }),
      method: "POST",
    },
    key,
  );
  expectSuccess(response);
  return modelBranchSchema.parse(await json(response));
}

async function preview(
  persona: LivePersona,
  branch: ModelBranch,
  operations: readonly unknown[],
  key = `c5-preview-${randomUUID()}`,
) {
  const response = await apiRequest(
    persona,
    `${branchPath(persona, branch.id)}/previews`,
    {
      body: JSON.stringify({
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedRevision: branch.revision,
        operations,
      }),
      method: "POST",
    },
    key,
  );
  expectSuccess(response);
  return modelOperationsPreviewSchema.parse(await json(response));
}

const suiteName = liveEnabled
  ? "live C5 authenticated API acceptance"
  : `live C5 authenticated API acceptance (skipped: set C5_RUN_LIVE_API=1; missing ${missingEnvironment.join(", ") || "no credentials"})`;

describe.skipIf(!liveEnabled)(suiteName, () => {
  it("exposes the frozen branch inventory without restoring raw snapshot mutation", async () => {
    const branch = await createBranch(owner, `Live inventory ${randomUUID()}`);
    const get = await apiRequest(owner, branchPath(owner, branch.id), { method: "GET" });
    expect(get.status).toBe(200);
    expect(modelBranchSchema.parse(await json(get))).toEqual(branch);

    const list = await apiRequest(owner, branchCollectionPath(owner), { method: "GET" });
    expect(list.status).toBe(200);
    expect(
      listModelBranchesResponseSchema
        .parse(await json(list))
        .branches.some(({ id }) => id === branch.id),
    ).toBe(true);

    const rawMutation = await apiRequest(
      owner,
      `/v1/projects/${owner.projectId}/models/${profile}/snapshots`,
      { body: JSON.stringify({ snapshot: {} }), method: "POST" },
      `c5-raw-snapshot-${randomUUID()}`,
    );
    expect([404, 405]).toContain(rawMutation.status);
  });

  it("keeps viewer and foreign-tenant behavior non-mutating and non-disclosing", async () => {
    const branch = await createBranch(owner, `Live authz ${randomUUID()}`);
    const viewerRead = await apiRequest(viewer, branchPath(viewer, branch.id), { method: "GET" });
    expect(viewerRead.status).toBe(200);
    const viewerWrite = await apiRequest(
      viewer,
      `${branchPath(viewer, branch.id)}/previews`,
      {
        body: JSON.stringify({
          expectedHeadSnapshotSha256: branch.headSnapshotSha256,
          expectedRevision: branch.revision,
          operations: generatedRenameSequence(1, 1, 900),
        }),
        method: "POST",
      },
      `c5-viewer-${randomUUID()}`,
    );
    expect(viewerWrite.status).toBe(403);

    const foreignRead = await apiRequest(foreign, branchPath(foreign, branch.id), {
      method: "GET",
    });
    const unknownRead = await apiRequest(foreign, branchPath(foreign, randomUUID()), {
      method: "GET",
    });
    expect(foreignRead.status).toBe(404);
    expect(unknownRead.status).toBe(404);
  });
});

const mutationSuiteName = mutationEnabled
  ? "live C5 C4-fixture mutation, replay and race acceptance"
  : "live C5 C4-fixture mutation, replay and race acceptance (skipped: set C5_LIVE_SOURCE_IS_C4_FIXTURE=1 after seeding the retained C4 source)";

describe.skipIf(!mutationEnabled)(mutationSuiteName, () => {
  it("previews every public registry operation and rejects malformed schemas, units, IDs and paths", async () => {
    for (const operation of publicOperationCatalog()) {
      const branch = await createBranch(owner, `Live ${operation.type} ${randomUUID()}`);
      const result = await preview(owner, branch, [operation]);
      expect(result.operations.map(({ type }) => type)).toEqual([operation.type]);
      expect(result.baseRevision).toBe(0);
      expect(result.baseHeadSnapshotSha256).toBe(branch.headSnapshotSha256);
    }

    const branch = await createBranch(owner, `Live invalid inputs ${randomUUID()}`);
    const source = publicOperationCatalog()[2];
    if (source?.type !== "wall.translate.v1") throw new Error("Operation catalog changed.");
    const invalidOperations = [
      { ...source, schemaVersion: "c5-model-operation-v2" },
      { ...source, translation: { xMm: 0, yMm: 0 } },
      { ...source, translation: { xMm: 1.25, yMm: 0 } },
      { ...source, wallId: "../../foreign" },
      {
        ...publicOperationCatalog()[6],
        target: { collection: "__proto__", elementId: randomUUID(), field: "constructor" },
      },
    ];
    for (const operation of invalidOperations) {
      const response = await apiRequest(
        owner,
        `${branchPath(owner, branch.id)}/previews`,
        {
          body: JSON.stringify({
            expectedHeadSnapshotSha256: branch.headSnapshotSha256,
            expectedRevision: branch.revision,
            operations: [operation],
          }),
          method: "POST",
        },
        `c5-invalid-${randomUUID()}`,
      );
      expect(response.status).toBe(400);
    }
  });

  it("replays exact commit idempotency and rejects a same-key body conflict", async () => {
    const branch = await createBranch(owner, `Live idempotency ${randomUUID()}`);
    const operationPreview = await preview(owner, branch, generatedRenameSequence(1, 10, 1_000));
    const key = `c5-commit-replay-${randomUUID()}`;
    const body = {
      commitMessage: "Commit one deterministic rename",
      expectedHeadSnapshotSha256: branch.headSnapshotSha256,
      expectedRevision: branch.revision,
      previewId: operationPreview.id,
    };
    const first = await apiRequest(
      owner,
      `${branchPath(owner, branch.id)}/commits`,
      { body: JSON.stringify(body), method: "POST" },
      key,
    );
    expectSuccess(first);
    const firstBody = commitModelOperationsResponseSchema.parse(await json(first));
    const replay = await apiRequest(
      owner,
      `${branchPath(owner, branch.id)}/commits`,
      { body: JSON.stringify(body), method: "POST" },
      key,
    );
    expectSuccess(replay);
    expect(commitModelOperationsResponseSchema.parse(await json(replay))).toEqual(firstBody);

    const conflict = await apiRequest(
      owner,
      `${branchPath(owner, branch.id)}/commits`,
      { body: JSON.stringify({ ...body, commitMessage: "Changed body" }), method: "POST" },
      key,
    );
    expect(conflict.status).toBe(409);
  });

  it("allows one racing commit and returns the current branch for stale recovery", async () => {
    const branch = await createBranch(owner, `Live race ${randomUUID()}`);
    const ownerPreview = await preview(owner, branch, generatedRenameSequence(1, 20, 1_100));
    const editorPreview = await preview(editor, branch, generatedRenameSequence(1, 21, 1_200));
    const requestBody = (previewId: string) => ({
      commitMessage: `Race ${previewId}`,
      expectedHeadSnapshotSha256: branch.headSnapshotSha256,
      expectedRevision: branch.revision,
      previewId,
    });
    const [first, second] = await Promise.all([
      apiRequest(
        owner,
        `${branchPath(owner, branch.id)}/commits`,
        { body: JSON.stringify(requestBody(ownerPreview.id)), method: "POST" },
        `c5-race-owner-${randomUUID()}`,
      ),
      apiRequest(
        editor,
        `${branchPath(editor, branch.id)}/commits`,
        { body: JSON.stringify(requestBody(editorPreview.id)), method: "POST" },
        `c5-race-editor-${randomUUID()}`,
      ),
    ]);
    expect(
      [first.status, second.status].filter((status) => [200, 201].includes(status)),
    ).toHaveLength(1);
    expect([first.status, second.status].filter((status) => status === 409)).toHaveLength(1);
    const current = await apiRequest(owner, branchPath(owner, branch.id), { method: "GET" });
    expect(modelBranchSchema.parse(await json(current)).revision).toBe(1);
  });

  it("paginates operation history with no page above 100 records", async () => {
    const branch = await createBranch(owner, `Live pagination ${randomUUID()}`);
    const operationPreview = await preview(owner, branch, generatedRenameSequence(50, 30, 1_300));
    const commit = await apiRequest(
      owner,
      `${branchPath(owner, branch.id)}/commits`,
      {
        body: JSON.stringify({
          commitMessage: "Commit 50 ordered operations for cursor evaluation",
          expectedHeadSnapshotSha256: branch.headSnapshotSha256,
          expectedRevision: branch.revision,
          previewId: operationPreview.id,
        }),
        method: "POST",
      },
      `c5-page-commit-${randomUUID()}`,
    );
    expectSuccess(commit);
    const history = await apiRequest(
      viewer,
      `${branchPath(viewer, branch.id)}/operations?limit=25`,
      { method: "GET" },
    );
    expect(history.status).toBe(200);
    const firstPage = modelOperationHistoryResponseSchema.parse(await json(history));
    expect(firstPage.operations).toHaveLength(25);
    expect(firstPage.nextCursor).toBeDefined();
    const oversized = await apiRequest(
      viewer,
      `${branchPath(viewer, branch.id)}/operations?limit=101`,
      { method: "GET" },
    );
    expect(oversized.status).toBe(400);
  });
});
