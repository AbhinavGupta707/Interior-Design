import { designBriefSchema } from "@interior-design/contracts";
import { randomUUID } from "node:crypto";

import { notFound } from "../identity/http.js";
import { briefConflict, briefRevisionConflict, translateBriefDomainFailure } from "./errors.js";
import type {
  AcceptBriefCommand,
  BriefAcceptanceRecord,
  BriefAuditRecord,
  BriefClock,
  BriefDomainKernel,
  BriefMutationResult,
  BriefRepository,
  BriefRevisionRecord,
  BriefUuidFactory,
  UpdateBriefCommand,
} from "./types.js";
import { validateBriefRevisionRecord } from "./validation.js";

const systemClock: BriefClock = { now: () => new Date() };
const systemUuid: BriefUuidFactory = { randomUUID };

interface StoredEffect {
  readonly actorUserId: string;
  readonly operation: "accept" | "update";
  readonly projectId: string;
  readonly requestSha256: string;
  readonly result: BriefRevisionRecord;
}

function scope(tenantId: string, projectId: string): string {
  return `${tenantId}:${projectId}`;
}

function cloneRecord(record: BriefRevisionRecord): BriefRevisionRecord {
  return {
    ...record,
    brief: designBriefSchema.parse(structuredClone(record.brief)),
  };
}

export class InMemoryBriefRepository implements BriefRepository {
  readonly #acceptances = new Map<string, BriefAcceptanceRecord[]>();
  readonly #audit = new Map<string, BriefAuditRecord[]>();
  readonly #clock: BriefClock;
  readonly #current = new Map<string, BriefRevisionRecord>();
  readonly #domain: BriefDomainKernel;
  readonly #effects = new Map<string, StoredEffect>();
  readonly #history = new Map<string, BriefRevisionRecord[]>();
  readonly #uuid: BriefUuidFactory;

  constructor(
    domain: BriefDomainKernel,
    options: { readonly clock?: BriefClock; readonly uuid?: BriefUuidFactory } = {},
  ) {
    this.#domain = domain;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  findCurrent(tenantId: string, projectId: string) {
    const record = this.#current.get(scope(tenantId, projectId));
    return Promise.resolve(record === undefined ? undefined : cloneRecord(record));
  }

  listHistory(tenantId: string, projectId: string) {
    return Promise.resolve(
      (this.#history.get(scope(tenantId, projectId)) ?? []).map((record) => cloneRecord(record)),
    );
  }

  listAcceptances(tenantId: string, projectId: string) {
    return Promise.resolve(
      structuredClone(this.#acceptances.get(scope(tenantId, projectId)) ?? []),
    );
  }

  listAudit(tenantId: string, projectId: string) {
    return Promise.resolve(structuredClone(this.#audit.get(scope(tenantId, projectId)) ?? []));
  }

  update(command: UpdateBriefCommand): Promise<BriefMutationResult> {
    const replay = this.#claim(command, "update");
    if (replay !== undefined)
      return Promise.resolve({ record: cloneRecord(replay), replayed: true });
    const key = scope(command.actor.tenantId, command.projectId);
    const current = this.#current.get(key);
    const currentRevision = current?.brief.revision ?? 0;
    if (command.expectedRevision !== currentRevision) throw briefRevisionConflict(currentRevision);
    let record: BriefRevisionRecord;
    try {
      record = validateBriefRevisionRecord(
        current === undefined
          ? this.#domain.create({
              actor: command.actor,
              at: this.#clock.now().toISOString(),
              briefId: this.#uuid.randomUUID(),
              operations: command.operations,
              projectId: command.projectId,
            })
          : this.#domain.revise({
              actor: command.actor,
              at: this.#clock.now().toISOString(),
              current: current.brief,
              operations: command.operations,
            }),
      );
    } catch (error) {
      translateBriefDomainFailure(error);
    }
    this.#assertNext(record, current, command.projectId);
    this.#persist(command, "update", record);
    return Promise.resolve({ record: cloneRecord(record), replayed: false });
  }

  accept(command: AcceptBriefCommand): Promise<BriefMutationResult> {
    const replay = this.#claim(command, "accept");
    if (replay !== undefined)
      return Promise.resolve({ record: cloneRecord(replay), replayed: true });
    const key = scope(command.actor.tenantId, command.projectId);
    const current = this.#current.get(key);
    if (current === undefined) throw notFound();
    if (command.expectedRevision !== current.brief.revision) {
      throw briefRevisionConflict(current.brief.revision);
    }
    let record: BriefRevisionRecord;
    try {
      record = validateBriefRevisionRecord(
        this.#domain.accept({
          actor: command.actor,
          at: this.#clock.now().toISOString(),
          current: current.brief,
        }),
      );
    } catch (error) {
      translateBriefDomainFailure(error);
    }
    this.#assertNext(record, current, command.projectId);
    this.#persist(command, "accept", record);
    return Promise.resolve({ record: cloneRecord(record), replayed: false });
  }

  #claim(
    command: UpdateBriefCommand | AcceptBriefCommand,
    operation: StoredEffect["operation"],
  ): BriefRevisionRecord | undefined {
    const stored = this.#effects.get(`${command.actor.tenantId}:${command.idempotencyKey}`);
    if (stored === undefined) return undefined;
    if (
      stored.actorUserId !== command.actor.userId ||
      stored.operation !== operation ||
      stored.projectId !== command.projectId ||
      stored.requestSha256 !== command.requestSha256
    ) {
      throw briefConflict(
        "IDEMPOTENCY_CONFLICT",
        "The Idempotency-Key was already used for a different brief mutation.",
      );
    }
    return stored.result;
  }

  #assertNext(
    record: BriefRevisionRecord,
    current: BriefRevisionRecord | undefined,
    projectId: string,
  ): void {
    if (
      record.brief.projectId !== projectId ||
      record.brief.revision !== (current?.brief.revision ?? 0) + 1 ||
      (current !== undefined && record.brief.id !== current.brief.id) ||
      (current === undefined && record.reason !== "created") ||
      (record.reason === "accepted" && record.brief.status !== "accepted") ||
      (record.reason !== "accepted" && record.brief.status !== "draft")
    ) {
      throw briefConflict(
        "BRIEF_KERNEL_SEQUENCE_INVALID",
        "The deterministic brief kernel violated revision or lifecycle ordering.",
      );
    }
  }

  #persist(
    command: UpdateBriefCommand | AcceptBriefCommand,
    operation: StoredEffect["operation"],
    record: BriefRevisionRecord,
  ): void {
    const key = scope(command.actor.tenantId, command.projectId);
    this.#current.set(key, cloneRecord(record));
    const history = this.#history.get(key) ?? [];
    history.push(cloneRecord(record));
    this.#history.set(key, history);
    if (record.reason === "accepted") {
      const acceptances = this.#acceptances.get(key) ?? [];
      acceptances.push({
        acceptedAt: record.brief.acceptedAt as string,
        acceptedBy: record.brief.acceptedBy as string,
        briefId: record.brief.id,
        revision: record.brief.revision,
      });
      this.#acceptances.set(key, acceptances);
    }
    const audit = this.#audit.get(key) ?? [];
    audit.push({
      action:
        record.reason === "created"
          ? "brief.create"
          : record.reason === "reopened"
            ? "brief.reopen"
            : record.reason === "accepted"
              ? "brief.accept"
              : "brief.update",
      actorUserId: command.actor.userId,
      contentSha256: record.contentSha256,
      occurredAt: record.brief.updatedAt,
      projectId: command.projectId,
      requestId: command.correlation.requestId,
      revision: record.brief.revision,
      tenantId: command.actor.tenantId,
      traceId: command.correlation.traceId,
    });
    this.#audit.set(key, audit);
    this.#effects.set(`${command.actor.tenantId}:${command.idempotencyKey}`, {
      actorUserId: command.actor.userId,
      operation,
      projectId: command.projectId,
      requestSha256: command.requestSha256,
      result: cloneRecord(record),
    });
  }
}
