import { createHash } from "node:crypto";

import {
  commitModelOperationsRequestSchema,
  createModelBranchRequestSchema,
  previewModelOperationsRequestSchema,
  restoreModelBranchRequestSchema,
  type CanonicalHomeSnapshot,
  type ModelOperationRequest,
  type ModelProfile,
} from "../../../packages/contracts/src/index.js";
import {
  canonicalizeHomeSnapshot,
  canonicalizeIJson,
} from "../../../packages/domain-model/src/index.js";
import { reduceWithReference } from "../../geometry/operations/reference-reducer.js";

export type ReferenceRole = "owner" | "editor" | "viewer";

export interface ReferenceActor {
  readonly projectId: string;
  readonly role: ReferenceRole;
  readonly tenantId: string;
  readonly userId: string;
}

export interface ReferenceBranch {
  readonly headSnapshotId: string;
  readonly headSnapshotSha256: string;
  readonly id: string;
  readonly modelId: string;
  readonly name: string;
  readonly profile: ModelProfile;
  readonly projectId: string;
  readonly revision: number;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotSha256: string;
  readonly tenantId: string;
}

interface StoredSnapshot {
  readonly branchId?: string;
  readonly id: string;
  readonly modelId: string;
  readonly profile: ModelProfile;
  readonly projectId: string;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
  readonly tenantId: string;
}

interface StoredPreview {
  readonly actorUserId: string;
  readonly baseHeadSnapshotSha256: string;
  readonly baseRevision: number;
  readonly branchId: string;
  readonly expiresAtMs: number;
  readonly findings: ReturnType<typeof reduceWithReference>["findings"];
  readonly id: string;
  readonly operations: readonly ModelOperationRequest[];
  readonly result: ReturnType<typeof reduceWithReference>;
}

interface StoredOperation {
  ordinal: number;
  readonly branchId: string;
  readonly clientOperationId: string;
  readonly commitId: string;
  readonly id: string;
  readonly operation?: ModelOperationRequest;
  readonly reason: string;
  readonly restoreSnapshotId?: string;
  readonly revision: number;
  readonly type: string;
}

interface StoredCommit {
  snapshotSha256: string;
  readonly branchId: string;
  readonly id: string;
  readonly operationIds: readonly string[];
  readonly parentSnapshotSha256: string;
  readonly revision: number;
  readonly snapshotId: string;
}

interface IdempotencyRecord {
  readonly action: string;
  readonly actorUserId: string;
  readonly fingerprint: string;
  readonly response: unknown;
}

export type AtomicFailureStage = "snapshot" | "operations" | "audit" | "outbox";

export type ReferenceStoreErrorCode =
  | "BLOCKING_FINDINGS"
  | "FORBIDDEN"
  | "HISTORY_INTEGRITY"
  | "IDEMPOTENCY_CONFLICT"
  | "INJECTED_FAILURE"
  | "INVALID_CURSOR"
  | "NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_FOREIGN"
  | "REVISION_CONFLICT";

export class ReferenceStoreError extends Error {
  readonly code: ReferenceStoreErrorCode;
  readonly recovery:
    | Readonly<{
        currentHeadSnapshotSha256: string;
        currentRevision: number;
        actions: readonly string[];
      }>
    | undefined;

  constructor(
    code: ReferenceStoreErrorCode,
    message: string,
    recovery?: ReferenceStoreError["recovery"],
  ) {
    super(message);
    this.name = "ReferenceStoreError";
    this.code = code;
    this.recovery = recovery;
  }
}

const clone = <T>(value: T): T => structuredClone(value);

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalizeIJson(value)).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class ReferenceOperationStore {
  readonly modelId: string;
  readonly profile: ModelProfile;
  readonly projectId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotSha256: string;
  readonly tenantId: string;

  #nowMs = Date.parse("2026-07-17T00:00:00.000Z");
  #sequence = 1;
  #branches = new Map<string, ReferenceBranch>();
  #snapshots = new Map<string, StoredSnapshot>();
  #previews = new Map<string, StoredPreview>();
  #commits: StoredCommit[] = [];
  #operations: StoredOperation[] = [];
  #audit: Record<string, unknown>[] = [];
  #outbox: Record<string, unknown>[] = [];
  #idempotency = new Map<string, IdempotencyRecord>();

  constructor(options: {
    readonly modelId: string;
    readonly profile: ModelProfile;
    readonly projectId: string;
    readonly snapshot: CanonicalHomeSnapshot;
    readonly sourceSnapshotId: string;
    readonly tenantId: string;
  }) {
    const canonical = canonicalizeHomeSnapshot(options.snapshot);
    this.modelId = options.modelId;
    this.profile = options.profile;
    this.projectId = options.projectId;
    this.sourceSnapshotId = options.sourceSnapshotId;
    this.sourceSnapshotSha256 = canonical.snapshotSha256;
    this.tenantId = options.tenantId;
    this.#snapshots.set(options.sourceSnapshotId, {
      id: options.sourceSnapshotId,
      modelId: options.modelId,
      profile: options.profile,
      projectId: options.projectId,
      snapshot: canonical.snapshot,
      snapshotSha256: canonical.snapshotSha256,
      tenantId: options.tenantId,
    });
  }

  advanceClock(milliseconds: number): void {
    this.#nowMs += milliseconds;
  }

  #id(namespace: string): string {
    const value = `${namespace}-0000-4000-8000-${this.#sequence.toString(16).padStart(12, "0")}`;
    this.#sequence += 1;
    return value;
  }

  #assertProject(actor: ReferenceActor): void {
    if (actor.tenantId !== this.tenantId || actor.projectId !== this.projectId) {
      throw new ReferenceStoreError("NOT_FOUND", "The requested project resource was not found.");
    }
  }

  #assertMutation(actor: ReferenceActor): void {
    this.#assertProject(actor);
    if (actor.role === "viewer") {
      throw new ReferenceStoreError("FORBIDDEN", "Viewer membership cannot mutate model history.");
    }
  }

  #branch(actor: ReferenceActor, branchId: string): ReferenceBranch {
    this.#assertProject(actor);
    const branch = this.#branches.get(branchId);
    if (
      branch === undefined ||
      branch.tenantId !== actor.tenantId ||
      branch.projectId !== actor.projectId
    ) {
      throw new ReferenceStoreError("NOT_FOUND", "The requested branch was not found.");
    }
    return branch;
  }

  #assertPrecondition(
    branch: ReferenceBranch,
    expectedRevision: number,
    expectedHeadSnapshotSha256: string,
  ): void {
    if (
      branch.revision !== expectedRevision ||
      branch.headSnapshotSha256 !== expectedHeadSnapshotSha256
    ) {
      throw new ReferenceStoreError("REVISION_CONFLICT", "The branch head changed.", {
        actions: ["reload", "compare", "discard-local-session", "rebuild-and-repreview"],
        currentHeadSnapshotSha256: branch.headSnapshotSha256,
        currentRevision: branch.revision,
      });
    }
  }

  #idempotent<T>(
    actor: ReferenceActor,
    key: string,
    action: string,
    body: unknown,
    create: () => T,
  ): T {
    if (key.length < 8 || key.length > 128) {
      throw new ReferenceStoreError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency keys must contain 8 to 128 characters.",
      );
    }
    const scope = `${actor.tenantId}\u0000${actor.projectId}\u0000${key}`;
    const bodyFingerprint = fingerprint({ action, body });
    const retained = this.#idempotency.get(scope);
    if (retained !== undefined) {
      if (
        retained.actorUserId !== actor.userId ||
        retained.action !== action ||
        retained.fingerprint !== bodyFingerprint
      ) {
        throw new ReferenceStoreError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to another actor, operation or body.",
        );
      }
      return clone(retained.response as T);
    }
    const response = create();
    this.#idempotency.set(scope, {
      action,
      actorUserId: actor.userId,
      fingerprint: bodyFingerprint,
      response: clone(response),
    });
    return response;
  }

  createBranch(
    actor: ReferenceActor,
    unparsedRequest: unknown,
    idempotencyKey: string,
  ): ReferenceBranch {
    this.#assertMutation(actor);
    const request = createModelBranchRequestSchema.parse(unparsedRequest);
    return this.#idempotent(actor, idempotencyKey, "branch.create", request, () => {
      const source = this.#snapshots.get(request.sourceSnapshotId);
      if (
        source === undefined ||
        source.snapshotSha256 !== request.sourceSnapshotSha256 ||
        source.tenantId !== actor.tenantId ||
        source.projectId !== actor.projectId ||
        source.modelId !== this.modelId ||
        source.profile !== this.profile
      ) {
        throw new ReferenceStoreError("NOT_FOUND", "The exact source snapshot was not found.");
      }
      const branch: ReferenceBranch = {
        headSnapshotId: source.id,
        headSnapshotSha256: source.snapshotSha256,
        id: this.#id("c5210000"),
        modelId: this.modelId,
        name: request.name,
        profile: this.profile,
        projectId: this.projectId,
        revision: 0,
        sourceSnapshotId: source.id,
        sourceSnapshotSha256: source.snapshotSha256,
        tenantId: this.tenantId,
      };
      this.#branches.set(branch.id, branch);
      return clone(branch);
    });
  }

  listBranches(actor: ReferenceActor): readonly ReferenceBranch[] {
    this.#assertProject(actor);
    return [...this.#branches.values()]
      .filter(
        (branch) => branch.tenantId === actor.tenantId && branch.projectId === actor.projectId,
      )
      .toSorted((left, right) => compareText(left.id, right.id))
      .map(clone);
  }

  getBranch(actor: ReferenceActor, branchId: string): ReferenceBranch {
    return clone(this.#branch(actor, branchId));
  }

  preview(
    actor: ReferenceActor,
    branchId: string,
    unparsedRequest: unknown,
    idempotencyKey: string,
  ) {
    this.#assertMutation(actor);
    const branch = this.#branch(actor, branchId);
    const request = previewModelOperationsRequestSchema.parse(unparsedRequest);
    return this.#idempotent(actor, idempotencyKey, "operations.preview", request, () => {
      this.#assertPrecondition(
        branch,
        request.expectedRevision,
        request.expectedHeadSnapshotSha256,
      );
      const head = this.#snapshots.get(branch.headSnapshotId);
      if (head === undefined) throw new ReferenceStoreError("HISTORY_INTEGRITY", "Head missing.");
      const result = reduceWithReference(head.snapshot, request.operations);
      const preview: StoredPreview = {
        actorUserId: actor.userId,
        baseHeadSnapshotSha256: branch.headSnapshotSha256,
        baseRevision: branch.revision,
        branchId,
        expiresAtMs: this.#nowMs + 15 * 60 * 1_000,
        findings: result.findings,
        id: this.#id("c5220000"),
        operations: clone(request.operations),
        result,
      };
      this.#previews.set(preview.id, preview);
      return clone({
        baseHeadSnapshotSha256: preview.baseHeadSnapshotSha256,
        baseRevision: preview.baseRevision,
        branchId,
        expiresAt: new Date(preview.expiresAtMs).toISOString(),
        findings: preview.findings,
        hasBlockingFindings: preview.findings.some(({ severity }) => severity === "error"),
        id: preview.id,
        resultSnapshotSha256: result.snapshotSha256,
      });
    });
  }

  commit(
    actor: ReferenceActor,
    branchId: string,
    unparsedRequest: unknown,
    idempotencyKey: string,
    options: { readonly failAt?: AtomicFailureStage } = {},
  ) {
    this.#assertMutation(actor);
    const request = commitModelOperationsRequestSchema.parse(unparsedRequest);
    return this.#idempotent(actor, idempotencyKey, "operations.commit", request, () => {
      const branch = this.#branch(actor, branchId);
      this.#assertPrecondition(
        branch,
        request.expectedRevision,
        request.expectedHeadSnapshotSha256,
      );
      const preview = this.#previews.get(request.previewId);
      if (preview === undefined || preview.branchId !== branchId) {
        throw new ReferenceStoreError("NOT_FOUND", "The preview was not found.");
      }
      if (preview.actorUserId !== actor.userId) {
        throw new ReferenceStoreError("PREVIEW_FOREIGN", "Another actor cannot confirm a preview.");
      }
      if (preview.expiresAtMs <= this.#nowMs) {
        throw new ReferenceStoreError("PREVIEW_EXPIRED", "The preview expired before commit.");
      }
      this.#assertPrecondition(branch, preview.baseRevision, preview.baseHeadSnapshotSha256);
      if (preview.findings.some(({ severity }) => severity === "error")) {
        throw new ReferenceStoreError("BLOCKING_FINDINGS", "Blocking findings prevent commit.");
      }

      const snapshotId = this.#id("c5230000");
      const commitId = this.#id("c5240000");
      const revision = branch.revision + 1;
      const operationRows = preview.operations.map((operation, ordinal): StoredOperation => ({
        branchId,
        clientOperationId: operation.clientOperationId,
        commitId,
        id: this.#id("c5250000"),
        operation: clone(operation),
        ordinal,
        reason: operation.reason,
        revision,
        type: operation.type,
      }));
      const snapshot: StoredSnapshot = {
        branchId,
        id: snapshotId,
        modelId: this.modelId,
        profile: this.profile,
        projectId: this.projectId,
        snapshot: preview.result.snapshot,
        snapshotSha256: preview.result.snapshotSha256,
        tenantId: this.tenantId,
      };
      if (options.failAt === "snapshot") this.#injectedFailure("snapshot");
      const commit: StoredCommit = {
        branchId,
        id: commitId,
        operationIds: operationRows.map(({ id }) => id),
        parentSnapshotSha256: branch.headSnapshotSha256,
        revision,
        snapshotId,
        snapshotSha256: snapshot.snapshotSha256,
      };
      if (options.failAt === "operations") this.#injectedFailure("operations");
      const audit = {
        actorUserId: actor.userId,
        branchId,
        commitId,
        projectId: actor.projectId,
        revision,
        snapshotSha256: snapshot.snapshotSha256,
        tenantId: actor.tenantId,
        type: "model.operations.committed.v1",
      };
      if (options.failAt === "audit") this.#injectedFailure("audit");
      const outbox = {
        aggregateId: branchId,
        aggregateType: "model-branch",
        commitId,
        eventType: "model.operations.committed.v1",
        eventVersion: 1,
        projectId: actor.projectId,
        snapshotSha256: snapshot.snapshotSha256,
        tenantId: actor.tenantId,
      };
      if (options.failAt === "outbox") this.#injectedFailure("outbox");

      const nextBranch: ReferenceBranch = {
        ...branch,
        headSnapshotId: snapshotId,
        headSnapshotSha256: snapshot.snapshotSha256,
        revision,
      };
      this.#snapshots.set(snapshotId, snapshot);
      this.#operations.push(...operationRows);
      this.#commits.push(commit);
      this.#audit.push(audit);
      this.#outbox.push(outbox);
      this.#branches.set(branchId, nextBranch);
      return clone({ branch: nextBranch, commit, findings: preview.findings });
    });
  }

  restore(
    actor: ReferenceActor,
    branchId: string,
    unparsedRequest: unknown,
    idempotencyKey: string,
  ) {
    this.#assertMutation(actor);
    const request = restoreModelBranchRequestSchema.parse(unparsedRequest);
    return this.#idempotent(actor, idempotencyKey, "branch.restore", request, () => {
      const branch = this.#branch(actor, branchId);
      this.#assertPrecondition(
        branch,
        request.expectedRevision,
        request.expectedHeadSnapshotSha256,
      );
      const source = this.#snapshots.get(request.sourceSnapshotId);
      if (
        source === undefined ||
        source.snapshotSha256 !== request.sourceSnapshotSha256 ||
        source.tenantId !== actor.tenantId ||
        source.projectId !== actor.projectId ||
        source.modelId !== branch.modelId ||
        source.profile !== branch.profile
      ) {
        throw new ReferenceStoreError("NOT_FOUND", "The restore source was not found.");
      }
      const revision = branch.revision + 1;
      const snapshotId = this.#id("c5230000");
      const commitId = this.#id("c5240000");
      const operation: StoredOperation = {
        branchId,
        clientOperationId: this.#id("c5260000"),
        commitId,
        id: this.#id("c5250000"),
        ordinal: 0,
        reason: request.reason,
        restoreSnapshotId: source.id,
        revision,
        type: "snapshot.restore.v1",
      };
      const snapshot: StoredSnapshot = {
        ...source,
        branchId,
        id: snapshotId,
      };
      const commit: StoredCommit = {
        branchId,
        id: commitId,
        operationIds: [operation.id],
        parentSnapshotSha256: branch.headSnapshotSha256,
        revision,
        snapshotId,
        snapshotSha256: source.snapshotSha256,
      };
      const nextBranch = {
        ...branch,
        headSnapshotId: snapshotId,
        headSnapshotSha256: source.snapshotSha256,
        revision,
      };
      this.#snapshots.set(snapshotId, snapshot);
      this.#operations.push(operation);
      this.#commits.push(commit);
      this.#audit.push({
        actorUserId: actor.userId,
        branchId,
        commitId,
        revision,
        sourceSnapshotId: source.id,
        type: "model.branch.restored.v1",
      });
      this.#outbox.push({
        aggregateId: branchId,
        commitId,
        eventType: "model.branch.restored.v1",
        eventVersion: 1,
        snapshotSha256: source.snapshotSha256,
      });
      this.#branches.set(branchId, nextBranch);
      return clone({ branch: nextBranch, commit, operation });
    });
  }

  #injectedFailure(stage: AtomicFailureStage): never {
    throw new ReferenceStoreError("INJECTED_FAILURE", `Injected failure after ${stage}.`);
  }

  history(
    actor: ReferenceActor,
    branchId: string,
    options: { readonly cursor?: string; readonly limit?: number } = {},
  ) {
    this.#branch(actor, branchId);
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ReferenceStoreError("INVALID_CURSOR", "History limit must be 1 to 100.");
    }
    let offset = 0;
    if (options.cursor !== undefined) {
      const match = /^offset:([0-9]+)$/u.exec(options.cursor);
      if (match?.[1] === undefined) {
        throw new ReferenceStoreError("INVALID_CURSOR", "History cursor is malformed.");
      }
      offset = Number(match[1]);
    }
    const ordered = this.#operations
      .filter((operation) => operation.branchId === branchId)
      .toSorted((left, right) => right.revision - left.revision || left.ordinal - right.ordinal);
    const operations = ordered.slice(offset, offset + limit).map(clone);
    const nextOffset = offset + operations.length;
    return {
      ...(nextOffset < ordered.length ? { nextCursor: `offset:${String(nextOffset)}` } : {}),
      operations,
    };
  }

  compare(actor: ReferenceActor, baseBranchId: string, targetBranchId: string, limit = 100) {
    const base = this.#branch(actor, baseBranchId);
    const target = this.#branch(actor, targetBranchId);
    const baseSnapshot = this.#snapshots.get(base.headSnapshotId);
    const targetSnapshot = this.#snapshots.get(target.headSnapshotId);
    if (baseSnapshot === undefined || targetSnapshot === undefined) {
      throw new ReferenceStoreError("HISTORY_INTEGRITY", "Comparison head snapshot is missing.");
    }
    const elementMap = (snapshot: CanonicalHomeSnapshot): Map<string, unknown> =>
      new Map(
        Object.values(snapshot.elements)
          .flat()
          .map((element) => [element.id, element]),
      );
    const left = elementMap(baseSnapshot.snapshot);
    const right = elementMap(targetSnapshot.snapshot);
    const ids = new Set([...left.keys(), ...right.keys()]);
    const changes: { elementId: string; kind: "added" | "modified" | "removed" }[] = [];
    for (const elementId of [...ids].toSorted(compareText)) {
      const baseElement = left.get(elementId);
      const targetElement = right.get(elementId);
      if (baseElement === undefined) changes.push({ elementId, kind: "added" });
      else if (targetElement === undefined) changes.push({ elementId, kind: "removed" });
      else if (canonicalizeIJson(baseElement) !== canonicalizeIJson(targetElement)) {
        changes.push({ elementId, kind: "modified" });
      }
    }
    return {
      baseBranchId,
      baseHeadSnapshotSha256: base.headSnapshotSha256,
      changes: changes.slice(0, limit),
      targetBranchId,
      targetHeadSnapshotSha256: target.headSnapshotSha256,
      truncated: changes.length > limit,
    };
  }

  replay(actor: ReferenceActor, branchId: string): string {
    const branch = this.#branch(actor, branchId);
    const source = this.#snapshots.get(branch.sourceSnapshotId);
    if (source === undefined) throw new ReferenceStoreError("HISTORY_INTEGRITY", "Source missing.");
    let snapshot = source.snapshot;
    const commits = this.#commits
      .filter((commit) => commit.branchId === branchId)
      .toSorted((left, right) => left.revision - right.revision);
    for (const commit of commits) {
      const rows = this.#operations
        .filter((operation) => operation.commitId === commit.id)
        .toSorted((left, right) => left.ordinal - right.ordinal);
      if (
        rows.length !== commit.operationIds.length ||
        rows.some((operation, index) => operation.ordinal !== index)
      ) {
        throw new ReferenceStoreError("HISTORY_INTEGRITY", "Operation ordinal gap detected.");
      }
      const restore = rows.find(({ type }) => type === "snapshot.restore.v1");
      if (restore !== undefined) {
        if (rows.length !== 1 || restore.restoreSnapshotId === undefined) {
          throw new ReferenceStoreError("HISTORY_INTEGRITY", "Restore envelope is malformed.");
        }
        const restored = this.#snapshots.get(restore.restoreSnapshotId);
        if (restored === undefined) {
          throw new ReferenceStoreError("HISTORY_INTEGRITY", "Restore source is missing.");
        }
        snapshot = restored.snapshot;
      } else {
        const operations = rows.map(({ operation }) => {
          if (operation === undefined) {
            throw new ReferenceStoreError("HISTORY_INTEGRITY", "Operation payload is missing.");
          }
          return operation;
        });
        snapshot = reduceWithReference(snapshot, operations).snapshot;
      }
      if (canonicalizeHomeSnapshot(snapshot).snapshotSha256 !== commit.snapshotSha256) {
        throw new ReferenceStoreError("HISTORY_INTEGRITY", "Replay hash mismatch detected.");
      }
    }
    const replayedHash = canonicalizeHomeSnapshot(snapshot).snapshotSha256;
    if (replayedHash !== branch.headSnapshotSha256) {
      throw new ReferenceStoreError("HISTORY_INTEGRITY", "Replay does not match branch head.");
    }
    return replayedHash;
  }

  evidence(actor: ReferenceActor, branchId: string) {
    const branch = this.#branch(actor, branchId);
    return clone({
      audit: this.#audit.filter((event) => event.branchId === branchId),
      branch,
      commitCount: this.#commits.filter((commit) => commit.branchId === branchId).length,
      committedSnapshotCount: [...this.#snapshots.values()].filter(
        (snapshot) => snapshot.branchId === branchId,
      ).length,
      operationCount: this.#operations.filter((operation) => operation.branchId === branchId)
        .length,
      outbox: this.#outbox.filter((event) => event.aggregateId === branchId),
      previewCount: [...this.#previews.values()].filter((preview) => preview.branchId === branchId)
        .length,
    });
  }

  tamperOrdinalForTest(branchId: string, operationIndex: number, ordinal: number): void {
    const operation = this.#operations.filter((candidate) => candidate.branchId === branchId)[
      operationIndex
    ];
    if (operation === undefined)
      throw new Error("No operation exists at the requested test index.");
    operation.ordinal = ordinal;
  }

  tamperCommitHashForTest(branchId: string): void {
    const commit = this.#commits.find((candidate) => candidate.branchId === branchId);
    if (commit === undefined) throw new Error("No commit exists for tampering.");
    commit.snapshotSha256 = "0".repeat(64);
  }
}
