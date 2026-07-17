import { randomUUID } from "node:crypto";

import {
  canonicalFixtureIds,
  existingHomeSnapshot,
} from "../../../packages/test-fixtures/src/models/index.js";
import { describe, expect, it } from "vitest";

import { generatedRenameSequence } from "../../geometry/operations/operation-fixtures.js";
import {
  ReferenceOperationStore,
  ReferenceStoreError,
  type ReferenceActor,
} from "./reference-store.js";

const tenantId = "c5300000-0000-4000-8000-000000000001";
const projectId = canonicalFixtureIds.project;
const modelId = canonicalFixtureIds.model;
const sourceSnapshotId = "c5300000-0000-4000-8000-000000000002";

const owner: ReferenceActor = {
  projectId,
  role: "owner",
  tenantId,
  userId: canonicalFixtureIds.actor,
};
const editor: ReferenceActor = { ...owner, role: "editor", userId: randomUUID() };
const viewer: ReferenceActor = { ...owner, role: "viewer", userId: randomUUID() };
const foreign: ReferenceActor = {
  ...owner,
  projectId: randomUUID(),
  tenantId: randomUUID(),
  userId: randomUUID(),
};

function store(): ReferenceOperationStore {
  return new ReferenceOperationStore({
    modelId,
    profile: "existing",
    projectId,
    snapshot: existingHomeSnapshot,
    sourceSnapshotId,
    tenantId,
  });
}

function branchRequest(reference: ReferenceOperationStore, name = "Main evaluation branch") {
  return {
    name,
    sourceSnapshotId: reference.sourceSnapshotId,
    sourceSnapshotSha256: reference.sourceSnapshotSha256,
  };
}

function previewRequest(
  branch: ReturnType<ReferenceOperationStore["getBranch"]>,
  operations = generatedRenameSequence(1),
) {
  return {
    expectedHeadSnapshotSha256: branch.headSnapshotSha256,
    expectedRevision: branch.revision,
    operations,
  };
}

function commitRequest(
  branch: ReturnType<ReferenceOperationStore["getBranch"]>,
  previewId: string,
  message = "Commit evaluation operations",
) {
  return {
    commitMessage: message,
    expectedHeadSnapshotSha256: branch.headSnapshotSha256,
    expectedRevision: branch.revision,
    previewId,
  };
}

function commitSafeRename(
  reference: ReferenceOperationStore,
  actor: ReferenceActor,
  branchId: string,
  sequence: number,
) {
  const branch = reference.getBranch(actor, branchId);
  const preview = reference.preview(
    actor,
    branchId,
    previewRequest(branch, generatedRenameSequence(1, 0x5c5 + sequence, sequence)),
    `preview-${String(sequence).padStart(8, "0")}`,
  );
  return reference.commit(
    actor,
    branchId,
    commitRequest(branch, preview.id),
    `commit-${String(sequence).padStart(9, "0")}`,
  );
}

describe("C5 independent branch, replay and concurrency reference model", () => {
  it("makes preview non-mutating except for bounded preview metadata", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-key-0001");
    const before = reference.evidence(owner, branch.id);
    const preview = reference.preview(owner, branch.id, previewRequest(branch), "preview-key-0001");
    const after = reference.evidence(owner, branch.id);

    expect(after.branch).toEqual(before.branch);
    expect(after.commitCount).toBe(0);
    expect(after.committedSnapshotCount).toBe(0);
    expect(after.operationCount).toBe(0);
    expect(after.audit).toEqual([]);
    expect(after.outbox).toEqual([]);
    expect(after.previewCount).toBe(1);
    expect(preview.resultSnapshotSha256).not.toBe(branch.headSnapshotSha256);
  });

  it("replays identical idempotent bodies and rejects body, action and actor conflicts", () => {
    const reference = store();
    const key = "branch-replay-key";
    const first = reference.createBranch(owner, branchRequest(reference), key);
    const replay = reference.createBranch(owner, branchRequest(reference), key);
    expect(replay).toEqual(first);
    expect(reference.listBranches(owner)).toHaveLength(1);

    expect(() =>
      reference.createBranch(owner, branchRequest(reference, "Different body"), key),
    ).toThrow(ReferenceStoreError);
    expect(() => reference.createBranch(editor, branchRequest(reference), key)).toThrow(
      /another actor/u,
    );
    expect(() => reference.preview(owner, first.id, previewRequest(first), key)).toThrow(
      /another actor, operation or body/u,
    );
  });

  it("allows only one racing commit and returns bounded conflict recovery", async () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-race-key");
    const firstPreview = reference.preview(
      owner,
      branch.id,
      previewRequest(branch, generatedRenameSequence(1, 11, 10)),
      "race-preview-0001",
    );
    const secondPreview = reference.preview(
      editor,
      branch.id,
      previewRequest(branch, generatedRenameSequence(1, 12, 20)),
      "race-preview-0002",
    );

    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        reference.commit(
          owner,
          branch.id,
          commitRequest(branch, firstPreview.id),
          "race-commit-0001",
        ),
      ),
      Promise.resolve().then(() =>
        reference.commit(
          editor,
          branch.id,
          commitRequest(branch, secondPreview.id),
          "race-commit-0002",
        ),
      ),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ReferenceStoreError);
      expect((rejected.reason as ReferenceStoreError).code).toBe("REVISION_CONFLICT");
      expect((rejected.reason as ReferenceStoreError).recovery?.actions).toEqual([
        "reload",
        "compare",
        "discard-local-session",
        "rebuild-and-repreview",
      ]);
    }
    expect(reference.evidence(owner, branch.id)).toMatchObject({
      audit: [{ type: "model.operations.committed.v1" }],
      commitCount: 1,
      committedSnapshotCount: 1,
      operationCount: 1,
      outbox: [{ eventType: "model.operations.committed.v1" }],
    });
  });

  it("keeps branches isolated and compares exact stable element content", () => {
    const reference = store();
    const left = reference.createBranch(owner, branchRequest(reference, "Left"), "branch-left-key");
    const right = reference.createBranch(
      owner,
      branchRequest(reference, "Right"),
      "branch-right-key",
    );
    commitSafeRename(reference, owner, left.id, 1);

    expect(reference.getBranch(owner, right.id)).toMatchObject({
      headSnapshotSha256: reference.sourceSnapshotSha256,
      revision: 0,
    });
    const comparison = reference.compare(viewer, left.id, right.id);
    expect(comparison.changes).toEqual([
      { elementId: canonicalFixtureIds.elements.spaceLiving, kind: "modified" },
    ]);
    expect(comparison.truncated).toBe(false);
  });

  it("persists exactly one snapshot per commit and replay reaches every pinned hash", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-replay-0001");
    for (let index = 0; index < 8; index += 1) {
      commitSafeRename(reference, owner, branch.id, index + 1);
      expect(reference.replay(owner, branch.id)).toBe(
        reference.getBranch(owner, branch.id).headSnapshotSha256,
      );
    }
    const evidence = reference.evidence(owner, branch.id);
    expect(evidence).toMatchObject({
      commitCount: 8,
      committedSnapshotCount: 8,
      operationCount: 8,
    });
    expect(evidence.audit.every((event) => event.type === "model.operations.committed.v1")).toBe(
      true,
    );
    expect(
      evidence.outbox.every((event) => event.eventType === "model.operations.committed.v1"),
    ).toBe(true);
  });

  it("restores a historical snapshot as a new revision and registered internal operation", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-restore-001");
    commitSafeRename(reference, owner, branch.id, 1);
    const current = reference.getBranch(owner, branch.id);
    const restored = reference.restore(
      owner,
      branch.id,
      {
        expectedHeadSnapshotSha256: current.headSnapshotSha256,
        expectedRevision: current.revision,
        reason: "Restore the exact source snapshot as new history",
        sourceSnapshotId: reference.sourceSnapshotId,
        sourceSnapshotSha256: reference.sourceSnapshotSha256,
      },
      "restore-idempotency-key",
    );

    expect(restored.branch).toMatchObject({
      headSnapshotSha256: reference.sourceSnapshotSha256,
      revision: 2,
    });
    expect(restored.operation.type).toBe("snapshot.restore.v1");
    expect(reference.evidence(owner, branch.id)).toMatchObject({
      commitCount: 2,
      committedSnapshotCount: 2,
      operationCount: 2,
    });
    expect(reference.replay(owner, branch.id)).toBe(reference.sourceSnapshotSha256);
  });

  it.each(["snapshot", "operations", "audit", "outbox"] as const)(
    "rolls back domain, audit and outbox evidence on an injected %s failure",
    (failAt) => {
      const reference = store();
      const branch = reference.createBranch(
        owner,
        branchRequest(reference),
        `branch-atomic-${failAt}`,
      );
      const preview = reference.preview(
        owner,
        branch.id,
        previewRequest(branch),
        `preview-atomic-${failAt}`,
      );
      const before = reference.evidence(owner, branch.id);
      expect(() =>
        reference.commit(
          owner,
          branch.id,
          commitRequest(branch, preview.id),
          `commit-atomic-${failAt}`,
          { failAt },
        ),
      ).toThrow(/Injected failure/u);
      expect(reference.evidence(owner, branch.id)).toEqual(before);
    },
  );

  it("expires previews and binds confirmation to the preview actor", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-expiry-key");
    const preview = reference.preview(
      owner,
      branch.id,
      previewRequest(branch),
      "preview-expiry-key",
    );
    expect(() =>
      reference.commit(editor, branch.id, commitRequest(branch, preview.id), "commit-foreign-key"),
    ).toThrow(/Another actor/u);
    reference.advanceClock(15 * 60 * 1_000 + 1);
    expect(() =>
      reference.commit(owner, branch.id, commitRequest(branch, preview.id), "commit-expired-key"),
    ).toThrow(/expired/u);
  });

  it("paginates deterministic history at a hard maximum of 100 records", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-page-key");
    for (let commitIndex = 0; commitIndex < 3; commitIndex += 1) {
      const current = reference.getBranch(owner, branch.id);
      const operations = generatedRenameSequence(50, 0x900 + commitIndex, commitIndex * 50);
      const preview = reference.preview(
        owner,
        branch.id,
        previewRequest(current, operations),
        `preview-page-${String(commitIndex).padStart(4, "0")}`,
      );
      reference.commit(
        owner,
        branch.id,
        commitRequest(current, preview.id),
        `commit-page-${String(commitIndex).padStart(5, "0")}`,
      );
    }

    const first = reference.history(viewer, branch.id, { limit: 100 });
    expect(first.operations).toHaveLength(100);
    expect(first.nextCursor).toBe("offset:100");
    if (first.nextCursor === undefined) throw new Error("Expected a second history page.");
    const second = reference.history(viewer, branch.id, { cursor: first.nextCursor, limit: 100 });
    expect(second.operations).toHaveLength(50);
    expect(second.nextCursor).toBeUndefined();
    expect(() => reference.history(viewer, branch.id, { limit: 101 })).toThrow(/1 to 100/u);
    expect(() => reference.history(viewer, branch.id, { cursor: "../../unsafe" })).toThrow(
      /malformed/u,
    );
  });

  it("enforces tenant and role isolation without resource disclosure", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-authz-key");
    expect(reference.getBranch(viewer, branch.id)).toEqual(branch);
    expect(() =>
      reference.preview(viewer, branch.id, previewRequest(branch), "viewer-preview-key"),
    ).toThrow(/Viewer/u);
    expect(() => reference.getBranch(foreign, branch.id)).toThrow(/not found/u);
    expect(() => reference.listBranches(foreign)).toThrow(/not found/u);
  });

  it("fails replay closed on ordinal gaps and altered commit hashes", () => {
    const ordinalStore = store();
    const ordinalBranch = ordinalStore.createBranch(
      owner,
      branchRequest(ordinalStore),
      "branch-tamper-ord",
    );
    commitSafeRename(ordinalStore, owner, ordinalBranch.id, 1);
    ordinalStore.tamperOrdinalForTest(ordinalBranch.id, 0, 2);
    expect(() => ordinalStore.replay(owner, ordinalBranch.id)).toThrow(/ordinal gap/u);

    const hashStore = store();
    const hashBranch = hashStore.createBranch(
      owner,
      branchRequest(hashStore),
      "branch-tamper-hash",
    );
    commitSafeRename(hashStore, owner, hashBranch.id, 2);
    hashStore.tamperCommitHashForTest(hashBranch.id);
    expect(() => hashStore.replay(owner, hashBranch.id)).toThrow(/hash mismatch/u);
  });

  it("keeps the reference reducer responsive for representative local batches", () => {
    const reference = store();
    const branch = reference.createBranch(owner, branchRequest(reference), "branch-latency-key");
    const start = performance.now();
    for (let commitIndex = 0; commitIndex < 10; commitIndex += 1) {
      const current = reference.getBranch(owner, branch.id);
      const operations = generatedRenameSequence(20, 0xa00 + commitIndex, commitIndex * 20);
      const preview = reference.preview(
        owner,
        branch.id,
        previewRequest(current, operations),
        `preview-latency-${String(commitIndex).padStart(3, "0")}`,
      );
      reference.commit(
        owner,
        branch.id,
        commitRequest(current, preview.id),
        `commit-latency-${String(commitIndex).padStart(4, "0")}`,
      );
    }
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(reference.evidence(owner, branch.id)).toMatchObject({
      commitCount: 10,
      operationCount: 200,
    });
  });
});
