import { describe, expect, it } from "vitest";

import {
  InMemoryImmutableModelAuditPort,
  ModelAuditCursorCodec,
  ModelAuditCursorError,
  ModelAuditProjection,
  ModelAuditProjectionError,
  type ImmutableModelAuditEvent,
  type ImmutableModelAuditProjectionPort,
  type ModelAuditAccess,
  type ModelAuditScope,
} from "../../src/modules/audit/index.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const clock = () => NOW;
const cursorSecret = "c5-audit-cursor-fixture-secret-32-bytes-minimum";
const tenantId = "10000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const modelId = "40000000-0000-4000-8000-000000000001";
const branchId = "50000000-0000-4000-8000-000000000001";
const actorUserId = "20000000-0000-4000-8000-000000000001";

const scope: ModelAuditScope = {
  branchId,
  modelId,
  profile: "existing",
  projectId,
  tenantId,
};
const memberAccess: ModelAuditAccess = {
  scope,
  subjectId: actorUserId,
  visibility: "member",
};
const supportAccess: ModelAuditAccess = {
  expiresAt: "2026-07-17T12:05:00.000Z",
  scope,
  subjectId: "support.agent-1",
  visibility: "support-redacted",
};

function event(
  ordinal: number,
  overrides: Partial<ImmutableModelAuditEvent> = {},
): ImmutableModelAuditEvent {
  return {
    action: "model:operation:commit",
    actor: { id: actorUserId, kind: "human" },
    branchId,
    code: "MODEL_OPERATION_COMMITTED",
    commitId: `60000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    eventId: `70000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    modelId,
    occurredAt: `2026-07-17T11:${String(ordinal).padStart(2, "0")}:00.000Z`,
    operationTypes: ["wall.translate.v1"],
    outcome: "accepted",
    profile: "existing",
    projectId,
    requestId: `request-audit-${String(ordinal).padStart(2, "0")}`,
    revision: ordinal,
    snapshotId: `80000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    tenantId,
    traceId: String(ordinal).padStart(32, "0"),
    ...overrides,
  };
}

describe("signed model audit cursors", () => {
  it("round-trips an expiring cursor only for the exact scope", () => {
    const codec = new ModelAuditCursorCodec(cursorSecret, { clock, ttlSeconds: 300 });
    const position = {
      eventId: event(1).eventId,
      occurredAt: event(1).occurredAt,
    };
    const cursor = codec.encode(scope, position);
    expect(cursor.length).toBeLessThanOrEqual(500);
    expect(codec.decode(scope, cursor)).toEqual(position);
    expect(() => codec.decode({ ...scope, branchId: event(99).eventId }, cursor)).toThrow(
      ModelAuditCursorError,
    );
    expect(() => codec.decode({ ...scope, projectId: event(98).eventId }, cursor)).toThrow(
      ModelAuditCursorError,
    );
  });

  it("rejects signature tampering, truncation, extra segments, and malformed base64", () => {
    const codec = new ModelAuditCursorCodec(cursorSecret, { clock });
    const cursor = codec.encode(scope, {
      eventId: event(1).eventId,
      occurredAt: event(1).occurredAt,
    });
    const candidates = [
      `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`,
      cursor.slice(0, -12),
      `${cursor}.extra`,
      "not-base64url.%%%",
      "x".repeat(501),
    ];
    for (const candidate of candidates) {
      expect(() => codec.decode(scope, candidate)).toThrow(ModelAuditCursorError);
    }
  });

  it("rejects expired cursors and unsafe codec configuration", () => {
    let current = NOW;
    const codec = new ModelAuditCursorCodec(cursorSecret, {
      clock: () => current,
      ttlSeconds: 60,
    });
    const cursor = codec.encode(scope, {
      eventId: event(1).eventId,
      occurredAt: event(1).occurredAt,
    });
    current = new Date("2026-07-17T12:01:00.000Z");
    expect(() => codec.decode(scope, cursor)).toThrow(ModelAuditCursorError);
    expect(() => new ModelAuditCursorCodec("too-short")).toThrow(/32 bytes/u);
    expect(() => new ModelAuditCursorCodec(cursorSecret, { ttlSeconds: 59 })).toThrow(/60/u);
    expect(() => new ModelAuditCursorCodec(cursorSecret, { ttlSeconds: 3_601 })).toThrow(/3600/u);
  });
});

describe("immutable bounded model audit projection", () => {
  it("pages newest-first with an exclusive signed cursor and no duplicate records", async () => {
    const port = new InMemoryImmutableModelAuditPort();
    await Promise.all([port.append(event(1)), port.append(event(2)), port.append(event(3))]);
    const projection = new ModelAuditProjection(
      port,
      new ModelAuditCursorCodec(cursorSecret, { clock }),
      { clock },
    );

    const first = await projection.list(memberAccess, { limit: 2 });
    expect(first.records.map(({ revision }) => revision)).toEqual([3, 2]);
    expect(first.nextCursor).toBeDefined();
    const nextCursor = first.nextCursor;
    if (nextCursor === undefined) {
      throw new Error("Expected the first bounded audit page to have a cursor.");
    }
    const second = await projection.list(memberAccess, { cursor: nextCursor, limit: 2 });
    expect(second.records.map(({ revision }) => revision)).toEqual([1]);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.records, ...second.records].map(({ eventId }) => eventId)).size).toBe(
      3,
    );
  });

  it("emits only bounded redaction-safe public fields", async () => {
    const port = new InMemoryImmutableModelAuditPort();
    await port.append(event(1));
    const projection = new ModelAuditProjection(
      port,
      new ModelAuditCursorCodec(cursorSecret, { clock }),
      { clock },
    );
    const page = await projection.list(memberAccess, { limit: 100 });
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toEqual({
      action: "model:operation:commit",
      actor: { id: actorUserId, kind: "human" },
      code: "MODEL_OPERATION_COMMITTED",
      commitId: event(1).commitId,
      eventId: event(1).eventId,
      occurredAt: event(1).occurredAt,
      operationTypes: ["wall.translate.v1"],
      outcome: "accepted",
      resource: { branchId, modelId, profile: "existing", projectId },
      revision: 1,
      schemaVersion: "c5-model-audit-public-v1",
      snapshotId: event(1).snapshotId,
      traceId: "00000000000000000000000000000001",
      visibility: "member",
    });
    const serialized = JSON.stringify(page);
    for (const forbidden of [
      tenantId,
      "previewId",
      "previewSecret",
      "canonicalSnapshot",
      "databaseLocator",
      "commitMessage",
      "reason",
      "request-audit-01",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("redacts actor identifiers for time-bounded support visibility", async () => {
    const port = new InMemoryImmutableModelAuditPort();
    await port.append(event(1));
    const projection = new ModelAuditProjection(
      port,
      new ModelAuditCursorCodec(cursorSecret, { clock }),
      { clock },
    );
    const page = await projection.list(supportAccess, {});
    expect(page.records[0]?.actor).toEqual({ kind: "human" });
    expect(JSON.stringify(page)).not.toContain(actorUserId);
    expect(page.records[0]?.visibility).toBe("support-redacted");
  });

  it("rejects expired support access on every page read", async () => {
    const projection = new ModelAuditProjection(
      new InMemoryImmutableModelAuditPort(),
      new ModelAuditCursorCodec(cursorSecret, { clock }),
      { clock },
    );
    await expect(
      projection.list({ ...supportAccess, expiresAt: NOW.toISOString() }, {}),
    ).rejects.toMatchObject({ code: "AUDIT_ACCESS_EXPIRED" });
  });

  it("rejects malformed access, broad limits, cursor reuse, and unrecognised fields", async () => {
    const projection = new ModelAuditProjection(
      new InMemoryImmutableModelAuditPort(),
      new ModelAuditCursorCodec(cursorSecret, { clock }),
      { clock },
    );
    const invalidRequests = [{ limit: 0 }, { limit: 101 }, { limit: 2, rawSqlOffset: 42 }];
    for (const request of invalidRequests) {
      await expect(projection.list(memberAccess, request as never)).rejects.toBeInstanceOf(
        ModelAuditProjectionError,
      );
    }
    await expect(
      projection.list({ ...memberAccess, visibility: "support-redacted" } as never, {}),
    ).rejects.toBeInstanceOf(ModelAuditProjectionError);
  });

  it("fails closed if an adapter returns a foreign tenant, project, model, profile, or branch", async () => {
    const foreignRows = [
      event(1, { tenantId: "10000000-0000-4000-8000-000000000002" }),
      event(1, { projectId: "30000000-0000-4000-8000-000000000002" }),
      event(1, { modelId: "40000000-0000-4000-8000-000000000002" }),
      event(1, { profile: "proposed" }),
      event(1, { branchId: "50000000-0000-4000-8000-000000000002" }),
    ];
    for (const row of foreignRows) {
      const port: ImmutableModelAuditProjectionPort = { listNewest: () => Promise.resolve([row]) };
      const projection = new ModelAuditProjection(
        port,
        new ModelAuditCursorCodec(cursorSecret, { clock }),
        { clock },
      );
      await expect(projection.list(memberAccess, {})).rejects.toMatchObject({
        code: "AUDIT_PROJECTION_OUT_OF_SCOPE",
      });
    }
  });

  it("fails closed for malformed, excessive, duplicate, or incorrectly ordered adapter rows", async () => {
    const invalidPorts: ImmutableModelAuditProjectionPort[] = [
      { listNewest: () => Promise.resolve([event(1, { requestId: "secret with spaces" })]) },
      {
        listNewest: () =>
          Promise.resolve(Array.from({ length: 52 }, (_, index) => event(index + 1))),
      },
      { listNewest: () => Promise.resolve([event(1), event(1)]) },
      { listNewest: () => Promise.resolve([event(1), event(2)]) },
    ];
    for (const port of invalidPorts) {
      const projection = new ModelAuditProjection(
        port,
        new ModelAuditCursorCodec(cursorSecret, { clock }),
        { clock },
      );
      await expect(projection.list(memberAccess, { limit: 50 })).rejects.toMatchObject({
        code: "AUDIT_PROJECTION_INVALID",
      });
    }
  });

  it("exposes append and read only, rejects duplicates, and bounds adapter reads", async () => {
    const port = new InMemoryImmutableModelAuditPort();
    await port.append(event(1));
    await expect(port.append(event(1))).rejects.toThrow(/already exists/u);
    expect("update" in port).toBe(false);
    expect("delete" in port).toBe(false);
    expect(() => port.listNewest({ limit: 102, scope })).toThrow(/bounded/u);
  });
});
