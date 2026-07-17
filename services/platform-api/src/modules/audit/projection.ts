import {
  immutableModelAuditEventSchema,
  modelAuditAccessSchema,
  modelAuditPageRequestSchema,
  modelAuditPublicSchemaVersion,
  type ImmutableModelAuditEvent,
  type ImmutableModelAuditProjectionPort,
  type ModelAuditAccess,
  type ModelAuditScope,
  type PublicModelAuditPage,
  type PublicModelAuditRecord,
} from "./types.js";
import type { ModelAuditCursorCodec } from "./cursor.js";

export class ModelAuditProjectionError extends Error {
  readonly code:
    "AUDIT_ACCESS_EXPIRED" | "AUDIT_PROJECTION_INVALID" | "AUDIT_PROJECTION_OUT_OF_SCOPE";

  constructor(
    code: "AUDIT_ACCESS_EXPIRED" | "AUDIT_PROJECTION_INVALID" | "AUDIT_PROJECTION_OUT_OF_SCOPE",
  ) {
    super("The bounded model audit projection could not be produced safely.");
    this.code = code;
    this.name = "ModelAuditProjectionError";
  }
}

function sameScope(event: ImmutableModelAuditEvent, scope: ModelAuditScope): boolean {
  return (
    event.branchId === scope.branchId &&
    event.modelId === scope.modelId &&
    event.profile === scope.profile &&
    event.projectId === scope.projectId &&
    event.tenantId === scope.tenantId
  );
}

function isStrictlyOlder(
  event: ImmutableModelAuditEvent,
  previous: ImmutableModelAuditEvent,
): boolean {
  return (
    event.occurredAt < previous.occurredAt ||
    (event.occurredAt === previous.occurredAt && event.eventId < previous.eventId)
  );
}

function publicRecord(
  event: ImmutableModelAuditEvent,
  access: ModelAuditAccess,
): PublicModelAuditRecord {
  return {
    action: event.action,
    actor:
      access.visibility === "member"
        ? { id: event.actor.id, kind: event.actor.kind }
        : { kind: event.actor.kind },
    ...(event.code === undefined ? {} : { code: event.code }),
    ...(event.commitId === undefined ? {} : { commitId: event.commitId }),
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    ...(event.operationTypes === undefined ? {} : { operationTypes: event.operationTypes }),
    outcome: event.outcome,
    resource: {
      branchId: event.branchId,
      modelId: event.modelId,
      profile: event.profile,
      projectId: event.projectId,
    },
    ...(event.revision === undefined ? {} : { revision: event.revision }),
    schemaVersion: modelAuditPublicSchemaVersion,
    ...(event.snapshotId === undefined ? {} : { snapshotId: event.snapshotId }),
    traceId: event.traceId,
    visibility: access.visibility,
  };
}

export class ModelAuditProjection {
  readonly #clock: () => Date;
  readonly #cursor: ModelAuditCursorCodec;
  readonly #port: ImmutableModelAuditProjectionPort;

  constructor(
    port: ImmutableModelAuditProjectionPort,
    cursor: ModelAuditCursorCodec,
    options: { readonly clock?: () => Date } = {},
  ) {
    this.#port = port;
    this.#cursor = cursor;
    this.#clock = options.clock ?? (() => new Date());
  }

  async list(
    untrustedAccess: ModelAuditAccess,
    untrustedRequest: { readonly cursor?: string; readonly limit?: number },
  ): Promise<PublicModelAuditPage> {
    const accessResult = modelAuditAccessSchema.safeParse(untrustedAccess);
    const requestResult = modelAuditPageRequestSchema.safeParse(untrustedRequest);
    if (!accessResult.success || !requestResult.success) {
      throw new ModelAuditProjectionError("AUDIT_PROJECTION_INVALID");
    }
    const access = accessResult.data;
    const request = requestResult.data;
    const now = this.#clock();
    if (Number.isNaN(now.valueOf())) {
      throw new ModelAuditProjectionError("AUDIT_PROJECTION_INVALID");
    }
    if (access.expiresAt !== undefined && new Date(access.expiresAt) <= now) {
      throw new ModelAuditProjectionError("AUDIT_ACCESS_EXPIRED");
    }
    const before =
      request.cursor === undefined ? undefined : this.#cursor.decode(access.scope, request.cursor);
    const rows = await this.#port.listNewest({
      ...(before === undefined ? {} : { before }),
      limit: request.limit + 1,
      scope: access.scope,
    });
    if (rows.length > request.limit + 1) {
      throw new ModelAuditProjectionError("AUDIT_PROJECTION_INVALID");
    }
    const parsedRows: ImmutableModelAuditEvent[] = [];
    for (const row of rows) {
      const parsed = immutableModelAuditEventSchema.safeParse(row);
      if (!parsed.success) {
        throw new ModelAuditProjectionError("AUDIT_PROJECTION_INVALID");
      }
      if (!sameScope(parsed.data, access.scope)) {
        throw new ModelAuditProjectionError("AUDIT_PROJECTION_OUT_OF_SCOPE");
      }
      const previous = parsedRows.at(-1);
      if (previous !== undefined && !isStrictlyOlder(parsed.data, previous)) {
        throw new ModelAuditProjectionError("AUDIT_PROJECTION_INVALID");
      }
      parsedRows.push(parsed.data);
    }
    const hasMore = parsedRows.length > request.limit;
    const pageRows = parsedRows.slice(0, request.limit);
    const last = pageRows.at(-1);
    return {
      ...(hasMore && last !== undefined
        ? {
            nextCursor: this.#cursor.encode(access.scope, {
              eventId: last.eventId,
              occurredAt: last.occurredAt,
            }),
          }
        : {}),
      records: pageRows.map((event) => publicRecord(event, access)),
    };
  }
}
