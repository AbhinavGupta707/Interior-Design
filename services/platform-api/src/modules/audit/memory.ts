import {
  immutableModelAuditEventSchema,
  type AppendOnlyModelAuditPort,
  type ImmutableModelAuditEvent,
  type ImmutableModelAuditProjectionPort,
  type ReadImmutableModelAuditPage,
} from "./types.js";

function isBefore(event: ImmutableModelAuditEvent, occurredAt: string, eventId: string): boolean {
  return (
    event.occurredAt < occurredAt || (event.occurredAt === occurredAt && event.eventId < eventId)
  );
}

/** Deterministic provider-free adapter for module and composition tests; production uses C5 SQL. */
export class InMemoryImmutableModelAuditPort
  implements AppendOnlyModelAuditPort, ImmutableModelAuditProjectionPort
{
  readonly #events: ImmutableModelAuditEvent[] = [];

  append(untrustedEvent: ImmutableModelAuditEvent): Promise<void> {
    try {
      const event = immutableModelAuditEventSchema.parse(untrustedEvent);
      if (this.#events.some(({ eventId }) => eventId === event.eventId)) {
        throw new Error("An immutable model audit event with this ID already exists.");
      }
      this.#events.push(Object.freeze(event));
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error("Invalid audit event."));
    }
  }

  listNewest(input: ReadImmutableModelAuditPage): Promise<readonly ImmutableModelAuditEvent[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101) {
      throw new Error("Immutable audit reads are bounded to 101 rows including look-ahead.");
    }
    const rows = this.#events
      .filter(
        (event) =>
          event.tenantId === input.scope.tenantId &&
          event.projectId === input.scope.projectId &&
          event.modelId === input.scope.modelId &&
          event.profile === input.scope.profile &&
          event.branchId === input.scope.branchId &&
          (input.before === undefined ||
            isBefore(event, input.before.occurredAt, input.before.eventId)),
      )
      .toSorted((left, right) =>
        left.occurredAt === right.occurredAt
          ? right.eventId.localeCompare(left.eventId)
          : right.occurredAt.localeCompare(left.occurredAt),
      )
      .slice(0, input.limit)
      .map((event) => immutableModelAuditEventSchema.parse(event));
    return Promise.resolve(Object.freeze(rows));
  }
}
