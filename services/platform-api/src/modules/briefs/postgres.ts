import {
  briefPatchProposalSchema,
  consultationSessionSchema,
  designBriefSchema,
  updateBriefRequestSchema,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import {
  briefConflict,
  briefInvalid,
  briefRevisionConflict,
  translateBriefDomainFailure,
} from "./errors.js";
import type {
  AcceptBriefCommand,
  BriefAcceptanceRecord,
  BriefAuditRecord,
  BriefClock,
  BriefDomainKernel,
  BriefMutationResult,
  BriefProposalConfirmationCommand,
  BriefProposalConfirmationPort,
  BriefProposalConfirmationResult,
  BriefRepository,
  BriefRevisionRecord,
  BriefUuidFactory,
  UpdateBriefCommand,
} from "./types.js";
import { validateBriefRevisionRecord } from "./validation.js";

interface RevisionRow {
  readonly brief_payload: unknown;
  readonly canonical_byte_length: number;
  readonly content_sha256: string;
  readonly reason: string;
  readonly snapshot_sha256: string;
}

interface EffectRow {
  readonly actor_user_id: string;
  readonly operation: string;
  readonly project_id: string;
  readonly request_sha256: string;
  readonly response_payload: unknown;
  readonly response_status: number | null;
}

interface EffectCommand {
  readonly actor: UpdateBriefCommand["actor"];
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly requestSha256: string;
}

type EffectOperation = "brief.accept" | "brief.update" | "consultation.proposal.confirm";

interface ConsultationSessionRow {
  readonly base_brief_id: string;
  readonly base_brief_revision: number;
  readonly cancelled_at: Date | string | null;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly project_id: string;
  readonly provider_mode: string;
  readonly schema_version: string;
  readonly state: string;
  readonly turn_count: number;
  readonly updated_at: Date | string;
}

interface ConsultationProposalRow {
  readonly base_brief_id: string;
  readonly base_brief_revision: number;
  readonly created_at: Date | string;
  readonly current_ordinal: number;
  readonly current_status: string;
  readonly expires_at: Date | string;
  readonly id: string;
  readonly message_created_at: Date | string;
  readonly message_created_by: string | null;
  readonly message_session_id: string;
  readonly proposal_payload: unknown;
  readonly proposal_sha256: string;
  readonly session_id: string;
  readonly source_message_id: string;
  readonly updated_at: Date | string;
}

interface PendingSiblingRow {
  readonly current_ordinal: number;
  readonly proposal_id: string;
  readonly updated_at: Date | string;
}

const systemClock: BriefClock = { now: () => new Date() };
const systemUuid: BriefUuidFactory = { randomUUID };

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapRevision(row: RevisionRow): BriefRevisionRecord {
  return validateBriefRevisionRecord({
    brief: designBriefSchema.parse(row.brief_payload),
    canonicalByteLength: row.canonical_byte_length,
    contentSha256: row.content_sha256,
    reason: row.reason as BriefRevisionRecord["reason"],
    snapshotSha256: row.snapshot_sha256,
  });
}

function parseStoredRecord(value: unknown): BriefRevisionRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("A completed brief idempotency effect has no revision record.");
  }
  return validateBriefRevisionRecord(value as BriefRevisionRecord);
}

function mapSession(row: ConsultationSessionRow) {
  return consultationSessionSchema.parse({
    baseBriefId: row.base_brief_id,
    baseBriefRevision: row.base_brief_revision,
    ...(row.cancelled_at === null ? {} : { cancelledAt: iso(row.cancelled_at) }),
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    projectId: row.project_id,
    providerMode: row.provider_mode,
    schemaVersion: row.schema_version,
    state: row.state,
    turnCount: row.turn_count,
    updatedAt: iso(row.updated_at),
  });
}

function parseStoredConfirmation(
  value: unknown,
): Omit<BriefProposalConfirmationResult, "replayed"> {
  if (typeof value !== "object" || value === null) {
    throw new Error("A completed proposal confirmation has no response record.");
  }
  const stored = value as Record<string, unknown>;
  return {
    brief: designBriefSchema.parse(stored.brief),
    proposal: briefPatchProposalSchema.parse(stored.proposal),
    session: consultationSessionSchema.parse(stored.session),
  };
}

async function lockProject(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const rows = await transaction<{ readonly id: string }[]>`
    SELECT id FROM projects
    WHERE tenant_id = ${tenantId}::uuid AND id = ${projectId}::uuid
    LIMIT 1 FOR UPDATE
  `;
  if (rows.length !== 1) throw notFound();
}

async function currentRevision(
  transaction: Sql | TransactionSql,
  tenantId: string,
  projectId: string,
): Promise<BriefRevisionRecord | undefined> {
  const rows = await transaction<RevisionRow[]>`
    SELECT
      r.brief_payload, r.canonical_byte_length, r.content_sha256,
      r.snapshot_sha256, r.reason
    FROM design_briefs b
    JOIN design_brief_revisions r
      ON r.tenant_id = b.tenant_id AND r.project_id = b.project_id
      AND r.brief_id = b.id AND r.revision = b.current_revision
    WHERE b.tenant_id = ${tenantId}::uuid AND b.project_id = ${projectId}::uuid
    LIMIT 1
  `;
  return rows[0] === undefined ? undefined : mapRevision(rows[0]);
}

async function claimEffect(
  transaction: TransactionSql,
  command: EffectCommand,
  operation: EffectOperation,
): Promise<object | undefined> {
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO design_brief_idempotency_effects (
      tenant_id, project_id, idempotency_key, actor_user_id, operation, request_sha256, created_at
    ) VALUES (
      ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
      ${command.idempotencyKey}, ${command.actor.userId}::uuid,
      ${operation}, ${command.requestSha256}, clock_timestamp()
    ) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) return undefined;
  const rows = await transaction<EffectRow[]>`
    SELECT actor_user_id, operation, project_id, request_sha256,
      response_payload, response_status
    FROM design_brief_idempotency_effects
    WHERE tenant_id = ${command.actor.tenantId}::uuid
      AND idempotency_key = ${command.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (stored === undefined) throw new Error("The brief idempotency effect disappeared.");
  if (
    stored.actor_user_id !== command.actor.userId ||
    stored.operation !== operation ||
    stored.project_id !== command.projectId ||
    stored.request_sha256 !== command.requestSha256
  ) {
    throw briefConflict(
      "IDEMPOTENCY_CONFLICT",
      "The Idempotency-Key was already used for a different brief mutation.",
    );
  }
  if (stored.response_status !== 200 || stored.response_payload === null) {
    throw new Error("A committed brief idempotency effect is incomplete.");
  }
  if (typeof stored.response_payload !== "object") {
    throw new Error("A committed brief idempotency effect response is not an object.");
  }
  return stored.response_payload;
}

async function completeEffect(
  transaction: TransactionSql,
  command: EffectCommand,
  response: object,
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE design_brief_idempotency_effects
    SET response_status = 200,
        response_payload = ${transaction.json(json(response))},
        completed_at = clock_timestamp()
    WHERE tenant_id = ${command.actor.tenantId}::uuid
      AND idempotency_key = ${command.idempotencyKey}
      AND actor_user_id = ${command.actor.userId}::uuid
      AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (rows.length !== 1) {
    throw new Error("Brief idempotency completion did not update exactly one effect.");
  }
}

function assertNext(
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

function validateConfirmationCommand(command: BriefProposalConfirmationCommand) {
  const proposal = briefPatchProposalSchema.safeParse(command.proposal);
  const update = updateBriefRequestSchema.safeParse(command.update);
  const confirmedAt = Date.parse(command.confirmation.confirmedAt);
  if (
    !proposal.success ||
    !update.success ||
    !Number.isInteger(command.expectedTurnCount) ||
    command.expectedTurnCount < 0 ||
    command.expectedTurnCount > 100 ||
    !Number.isFinite(confirmedAt)
  ) {
    throw briefInvalid(
      "CONSULTATION_CONFIRMATION_INVALID",
      "The proposal confirmation command is invalid or exceeds a C11 resource boundary.",
    );
  }
  if (
    command.actor.userId !== command.confirmation.actorUserId ||
    command.projectId !== command.confirmation.projectId ||
    command.projectId !== proposal.data.projectId ||
    command.confirmation.proposalId !== proposal.data.id ||
    command.confirmation.sessionId !== proposal.data.sessionId ||
    command.confirmation.briefId !== proposal.data.baseBriefId ||
    command.confirmation.briefRevision !== proposal.data.baseBriefRevision + 1 ||
    command.confirmation.idempotencyKey !== update.data.idempotencyKey ||
    update.data.expectedRevision !== proposal.data.baseBriefRevision ||
    proposal.data.status !== "pending" ||
    requestHash(update.data.operations) !== requestHash(proposal.data.operations)
  ) {
    throw briefConflict(
      "CONSULTATION_CONFIRMATION_MISMATCH",
      "The confirmation, proposal and exact ordered brief patch do not identify one effect.",
    );
  }
  return { confirmedAt: new Date(confirmedAt), proposal: proposal.data, update: update.data };
}

async function insertRevision(
  transaction: TransactionSql,
  command: Pick<UpdateBriefCommand, "actor" | "correlation" | "projectId">,
  record: BriefRevisionRecord,
  current: BriefRevisionRecord | undefined,
): Promise<void> {
  const brief = record.brief;
  if (current === undefined) {
    await transaction`
      INSERT INTO design_briefs (
        tenant_id, project_id, id, current_revision, current_status,
        latest_accepted_revision, created_by, created_at, updated_by, updated_at
      ) VALUES (
        ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${brief.id}::uuid,
        ${brief.revision}, ${brief.status}, NULL, ${command.actor.userId}::uuid,
        ${new Date(brief.createdAt)}, ${brief.updatedBy}::uuid, ${new Date(brief.updatedAt)}
      )
    `;
  }
  await transaction`
    INSERT INTO design_brief_revisions (
      tenant_id, project_id, brief_id, revision, schema_version, status, reason,
      previous_revision, brief_payload, canonical_byte_length, content_sha256,
      snapshot_sha256, entry_count, reference_count, updated_by, updated_at,
      accepted_by, accepted_at
    ) VALUES (
      ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${brief.id}::uuid,
      ${brief.revision}, ${brief.schemaVersion}, ${brief.status}, ${record.reason},
      ${current?.brief.revision ?? null}, ${transaction.json(json(brief))},
      ${record.canonicalByteLength}, ${record.contentSha256}, ${record.snapshotSha256},
      ${brief.entries.length}, ${brief.referenceBoard.length}, ${brief.updatedBy}::uuid,
      ${new Date(brief.updatedAt)}, ${brief.acceptedBy ?? null}::uuid,
      ${brief.acceptedAt === undefined ? null : new Date(brief.acceptedAt)}
    )
  `;
  await transaction`
    WITH payload AS (SELECT ${transaction.json(json(brief))}::jsonb AS value)
    INSERT INTO design_brief_entry_projections (
      tenant_id, project_id, brief_id, revision, entry_id, ordinal, classification,
      category, priority, status, statement, provenance_method, captured_at,
      asset_id, source_message_id, source_snapshot_id, stated_by_user_id,
      room_or_level_element_ids, entry_payload
    )
    SELECT
      ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${brief.id}::uuid,
      ${brief.revision}, (entry ->> 'id')::uuid, ordinal::integer - 1,
      entry ->> 'classification', entry ->> 'category', (entry ->> 'priority')::integer,
      entry ->> 'status', entry ->> 'statement', entry -> 'provenance' ->> 'method',
      (entry -> 'provenance' ->> 'capturedAt')::timestamptz,
      (entry -> 'provenance' ->> 'assetId')::uuid,
      (entry -> 'provenance' ->> 'sourceMessageId')::uuid,
      (entry -> 'provenance' ->> 'sourceSnapshotId')::uuid,
      (entry -> 'provenance' ->> 'statedByUserId')::uuid,
      entry -> 'roomOrLevelElementIds', entry
    FROM payload, jsonb_array_elements(value -> 'entries') WITH ORDINALITY AS items(entry, ordinal)
  `;
  await transaction`
    WITH payload AS (SELECT ${transaction.json(json(brief))}::jsonb AS value)
    INSERT INTO design_brief_reference_projections (
      tenant_id, project_id, brief_id, revision, item_id, ordinal, asset_id,
      rights_record_sha256, sentiment, note, item_payload
    )
    SELECT
      ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${brief.id}::uuid,
      ${brief.revision}, (item ->> 'id')::uuid, ordinal::integer - 1,
      (item ->> 'assetId')::uuid, item ->> 'rightsRecordSha256',
      item ->> 'sentiment', item ->> 'note', item
    FROM payload,
      jsonb_array_elements(value -> 'referenceBoard') WITH ORDINALITY AS items(item, ordinal)
  `;
  if (current !== undefined) {
    const updated = await transaction<{ readonly id: string }[]>`
      UPDATE design_briefs
      SET current_revision = ${brief.revision}, current_status = ${brief.status},
          latest_accepted_revision = CASE
            WHEN ${record.reason} = 'accepted' THEN ${brief.revision}
            ELSE latest_accepted_revision
          END,
          updated_by = ${brief.updatedBy}::uuid, updated_at = ${new Date(brief.updatedAt)}
      WHERE tenant_id = ${command.actor.tenantId}::uuid
        AND project_id = ${command.projectId}::uuid AND id = ${brief.id}::uuid
        AND current_revision = ${current.brief.revision}
      RETURNING id
    `;
    if (updated.length !== 1) throw briefRevisionConflict(current.brief.revision);
  }
  if (record.reason === "accepted") {
    await transaction`
      INSERT INTO design_brief_acceptance_events (
        id, tenant_id, project_id, brief_id, accepted_revision,
        accepted_by, accepted_at, request_id, trace_id
      ) VALUES (
        ${randomUUID()}::uuid, ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
        ${brief.id}::uuid, ${brief.revision}, ${brief.acceptedBy as string}::uuid,
        ${new Date(brief.acceptedAt as string)}, ${command.correlation.requestId},
        ${command.correlation.traceId}
      )
    `;
  }
  const action =
    record.reason === "created"
      ? "brief.create"
      : record.reason === "reopened"
        ? "brief.reopen"
        : record.reason === "accepted"
          ? "brief.accept"
          : "brief.update";
  await transaction`
    INSERT INTO design_brief_audit_events (
      id, tenant_id, project_id, brief_id, revision, action, actor_user_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
      ${brief.id}::uuid, ${brief.revision}, ${action}, ${command.actor.userId}::uuid,
      ${command.correlation.requestId}, ${command.correlation.traceId},
      ${transaction.json(
        json({
          contentSha256: record.contentSha256,
          entryCount: brief.entries.length,
          referenceCount: brief.referenceBoard.length,
          revision: brief.revision,
          snapshotSha256: record.snapshotSha256,
        }),
      )},
      ${new Date(brief.updatedAt)}
    )
  `;
}

export class PostgresBriefRepository implements BriefRepository, BriefProposalConfirmationPort {
  readonly #clock: BriefClock;
  readonly #domain: BriefDomainKernel;
  readonly #sql: Sql;
  readonly #uuid: BriefUuidFactory;

  constructor(
    sql: Sql,
    domain: BriefDomainKernel,
    options: { readonly clock?: BriefClock; readonly uuid?: BriefUuidFactory } = {},
  ) {
    this.#sql = sql;
    this.#domain = domain;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  async findCurrent(tenantId: string, projectId: string) {
    return currentRevision(this.#sql, tenantId, projectId);
  }

  async listHistory(tenantId: string, projectId: string) {
    const rows = await this.#sql<RevisionRow[]>`
      SELECT r.brief_payload, r.canonical_byte_length, r.content_sha256,
        r.snapshot_sha256, r.reason
      FROM design_brief_revisions r
      JOIN design_briefs b
        ON b.tenant_id = r.tenant_id AND b.project_id = r.project_id AND b.id = r.brief_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.project_id = ${projectId}::uuid
      ORDER BY r.revision
    `;
    return rows.map(mapRevision);
  }

  async listAcceptances(tenantId: string, projectId: string) {
    const rows = await this.#sql<
      Array<{
        readonly accepted_at: Date | string;
        readonly accepted_by: string;
        readonly accepted_revision: number;
        readonly brief_id: string;
      }>
    >`
      SELECT brief_id, accepted_revision, accepted_by, accepted_at
      FROM design_brief_acceptance_events
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      ORDER BY accepted_revision
    `;
    return rows.map((row): BriefAcceptanceRecord => ({
      acceptedAt: iso(row.accepted_at),
      acceptedBy: row.accepted_by,
      briefId: row.brief_id,
      revision: row.accepted_revision,
    }));
  }

  async listAudit(tenantId: string, projectId: string) {
    const rows = await this.#sql<
      Array<{
        readonly action: BriefAuditRecord["action"];
        readonly actor_user_id: string;
        readonly content_sha256: string;
        readonly occurred_at: Date | string;
        readonly project_id: string;
        readonly request_id: string;
        readonly revision: number;
        readonly tenant_id: string;
        readonly trace_id: string;
      }>
    >`
      SELECT a.tenant_id, a.project_id, a.revision, a.action, a.actor_user_id,
        a.request_id, a.trace_id, a.occurred_at,
        a.metadata ->> 'contentSha256' AS content_sha256
      FROM design_brief_audit_events a
      WHERE a.tenant_id = ${tenantId}::uuid AND a.project_id = ${projectId}::uuid
      ORDER BY a.occurred_at, a.id
    `;
    return rows.map((row): BriefAuditRecord => ({
      action: row.action,
      actorUserId: row.actor_user_id,
      contentSha256: row.content_sha256,
      occurredAt: iso(row.occurred_at),
      projectId: row.project_id,
      requestId: row.request_id,
      revision: row.revision,
      tenantId: row.tenant_id,
      traceId: row.trace_id,
    }));
  }

  confirmProposal(
    command: BriefProposalConfirmationCommand,
  ): Promise<BriefProposalConfirmationResult> {
    const validated = validateConfirmationCommand(command);
    const effectCommand: EffectCommand = {
      actor: command.actor,
      idempotencyKey: validated.update.idempotencyKey,
      projectId: command.projectId,
      requestSha256: requestHash({
        briefId: command.confirmation.briefId,
        expectedBriefRevision: validated.update.expectedRevision,
        idempotencyKey: validated.update.idempotencyKey,
        operations: validated.update.operations,
        projectId: command.projectId,
        proposalId: command.confirmation.proposalId,
        sessionId: command.confirmation.sessionId,
      }),
    };
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, effectCommand, "consultation.proposal.confirm");
      if (replay !== undefined) {
        return { ...parseStoredConfirmation(replay), replayed: true };
      }

      const sessionRows = await transaction<ConsultationSessionRow[]>`
        SELECT tenant_id, project_id, id, schema_version, base_brief_id,
          base_brief_revision, provider_mode, state, turn_count, created_by,
          created_at, updated_at, cancelled_at
        FROM consultation_sessions
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.confirmation.sessionId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const sessionRow = sessionRows[0];
      if (sessionRow === undefined) throw notFound();
      const session = mapSession(sessionRow);

      const proposalRows = await transaction<ConsultationProposalRow[]>`
        SELECT p.session_id, p.id, p.base_brief_id, p.base_brief_revision,
          p.source_message_id, p.proposal_payload, p.proposal_sha256,
          p.created_at, p.expires_at, m.session_id AS message_session_id,
          m.created_at AS message_created_at, m.created_by AS message_created_by,
          h.current_ordinal, h.current_status, h.updated_at
        FROM consultation_patch_proposals p
        JOIN consultation_messages m
          ON m.tenant_id = p.tenant_id AND m.project_id = p.project_id
          AND m.id = p.source_message_id
        JOIN consultation_proposal_heads h
          ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id
          AND h.proposal_id = p.id
        WHERE p.tenant_id = ${command.actor.tenantId}::uuid
          AND p.project_id = ${command.projectId}::uuid
          AND p.session_id = ${command.confirmation.sessionId}::uuid
          AND p.id = ${command.confirmation.proposalId}::uuid
        LIMIT 1 FOR UPDATE OF p, h
      `;
      const proposalRow = proposalRows[0];
      if (proposalRow === undefined) throw notFound();
      const storedProposal = briefPatchProposalSchema.parse(proposalRow.proposal_payload);
      if (
        requestHash(storedProposal) !== proposalRow.proposal_sha256 ||
        requestHash(validated.proposal) !== proposalRow.proposal_sha256
      ) {
        throw briefConflict(
          "CONSULTATION_PROPOSAL_MISMATCH",
          "The immutable proposal payload does not match the confirmation command.",
        );
      }
      const messageCreatedAt = iso(proposalRow.message_created_at);
      for (const operation of validated.proposal.operations) {
        if (!("entry" in operation)) continue;
        const provenance = operation.entry.provenance;
        const assistantDerived =
          provenance.method === "assistant-extracted" ||
          provenance.method === "assistant-suggested";
        const userStated = provenance.method === "user-stated";
        if (
          (assistantDerived &&
            (provenance.sourceMessageId !== validated.proposal.sourceMessageId ||
              provenance.capturedAt !== messageCreatedAt)) ||
          (userStated &&
            (provenance.statedByUserId !== proposalRow.message_created_by ||
              provenance.capturedAt !== messageCreatedAt))
        ) {
          throw briefConflict(
            "CONSULTATION_PROPOSAL_PROVENANCE_MISMATCH",
            "The proposal patch is not attributable to its exact immutable source message.",
          );
        }
      }
      if (
        session.state !== command.expectedSessionState ||
        session.turnCount !== command.expectedTurnCount
      ) {
        throw briefConflict(
          "CONSULTATION_SESSION_STATE_CONFLICT",
          "The consultation session changed before the proposal could be confirmed.",
        );
      }
      if (
        proposalRow.current_status !== command.expectedProposalStatus ||
        proposalRow.current_ordinal !== 1
      ) {
        throw briefConflict(
          "CONSULTATION_PROPOSAL_STATE_CONFLICT",
          "The proposal is no longer pending confirmation.",
        );
      }
      if (
        session.baseBriefId !== validated.proposal.baseBriefId ||
        session.baseBriefRevision !== validated.proposal.baseBriefRevision ||
        proposalRow.base_brief_id !== validated.proposal.baseBriefId ||
        proposalRow.base_brief_revision !== validated.proposal.baseBriefRevision ||
        proposalRow.session_id !== validated.proposal.sessionId ||
        proposalRow.id !== validated.proposal.id ||
        proposalRow.source_message_id !== validated.proposal.sourceMessageId ||
        proposalRow.message_session_id !== validated.proposal.sessionId
      ) {
        throw briefConflict(
          "CONSULTATION_BASE_BRIEF_CONFLICT",
          "The consultation session and proposal no longer share the exact base brief.",
        );
      }
      const now = this.#clock.now();
      if (
        now.getTime() >= new Date(proposalRow.expires_at).getTime() ||
        validated.confirmedAt.getTime() >= new Date(proposalRow.expires_at).getTime()
      ) {
        throw briefConflict(
          "CONSULTATION_PROPOSAL_EXPIRED",
          "The proposal expired before confirmation completed.",
        );
      }
      if (
        validated.confirmedAt.getTime() > now.getTime() + 1_000 ||
        validated.confirmedAt.getTime() < new Date(proposalRow.created_at).getTime() ||
        validated.confirmedAt.getTime() <= new Date(proposalRow.updated_at).getTime() ||
        validated.confirmedAt.getTime() <= new Date(sessionRow.updated_at).getTime()
      ) {
        throw briefConflict(
          "CONSULTATION_CONFIRMATION_TIME_CONFLICT",
          "The confirmation timestamp is outside the session and proposal ordering boundary.",
        );
      }

      const pendingSiblings = await transaction<PendingSiblingRow[]>`
        SELECT h.proposal_id, h.current_ordinal, h.updated_at
        FROM consultation_proposal_heads h
        JOIN consultation_patch_proposals p
          ON p.tenant_id = h.tenant_id AND p.project_id = h.project_id
          AND p.id = h.proposal_id
        WHERE h.tenant_id = ${command.actor.tenantId}::uuid
          AND h.project_id = ${command.projectId}::uuid
          AND p.session_id = ${validated.proposal.sessionId}::uuid
          AND h.proposal_id <> ${validated.proposal.id}::uuid
          AND h.current_status = 'pending'
        ORDER BY h.proposal_id
        LIMIT 101 FOR UPDATE OF h
      `;
      if (pendingSiblings.length > 100) {
        throw briefInvalid(
          "CONSULTATION_RESOURCE_LIMIT",
          "The consultation has too many pending proposal heads to complete safely.",
        );
      }
      const completionAt = new Date(
        pendingSiblings.reduce(
          (latest, sibling) => Math.max(latest, new Date(sibling.updated_at).getTime() + 1),
          validated.confirmedAt.getTime(),
        ),
      );
      if (
        completionAt.getTime() > now.getTime() + 1_000 ||
        completionAt.getTime() >= new Date(proposalRow.expires_at).getTime()
      ) {
        throw briefConflict(
          "CONSULTATION_CONFIRMATION_TIME_CONFLICT",
          "Sibling proposal ordering exceeds the bounded confirmation time window.",
        );
      }

      const current = await currentRevision(transaction, command.actor.tenantId, command.projectId);
      if (current === undefined) throw notFound();
      if (
        current.brief.id !== command.confirmation.briefId ||
        current.brief.revision !== validated.update.expectedRevision
      ) {
        throw briefRevisionConflict(current.brief.revision);
      }
      let record: BriefRevisionRecord;
      try {
        record = validateBriefRevisionRecord(
          this.#domain.revise({
            actor: command.actor,
            at: validated.confirmedAt.toISOString(),
            current: current.brief,
            operations: validated.update.operations,
          }),
        );
      } catch (error) {
        translateBriefDomainFailure(error);
      }
      assertNext(record, current, command.projectId);
      if (record.brief.revision !== command.confirmation.briefRevision) {
        throw briefConflict(
          "CONSULTATION_APPLIED_REVISION_MISMATCH",
          "The proposal did not produce the declared successor brief revision.",
        );
      }
      await insertRevision(transaction, command, record, current);
      await transaction`
        INSERT INTO consultation_proposal_state_events (
          tenant_id, project_id, proposal_id, ordinal, status, changed_by,
          reason_code, occurred_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${validated.proposal.id}::uuid, 2, 'confirmed',
          ${command.actor.userId}::uuid, 'confirmed', ${validated.confirmedAt}
        )
      `;
      const head = await transaction<{ readonly proposal_id: string }[]>`
        UPDATE consultation_proposal_heads
        SET current_ordinal = 2, current_status = 'confirmed',
          updated_at = ${validated.confirmedAt}
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND proposal_id = ${validated.proposal.id}::uuid
          AND current_ordinal = 1 AND current_status = 'pending'
        RETURNING proposal_id
      `;
      if (head.length !== 1) {
        throw briefConflict(
          "CONSULTATION_PROPOSAL_STATE_CONFLICT",
          "The proposal is no longer pending confirmation.",
        );
      }
      for (const sibling of pendingSiblings) {
        await transaction`
          INSERT INTO consultation_proposal_state_events (
            tenant_id, project_id, proposal_id, ordinal, status, changed_by,
            reason_code, occurred_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${sibling.proposal_id}::uuid, ${sibling.current_ordinal + 1}, 'rejected',
            ${command.actor.userId}::uuid, 'session-completed', ${completionAt}
          )
        `;
        const terminalSibling = await transaction<{ readonly proposal_id: string }[]>`
          UPDATE consultation_proposal_heads
          SET current_ordinal = ${sibling.current_ordinal + 1}, current_status = 'rejected',
            updated_at = ${completionAt}
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND proposal_id = ${sibling.proposal_id}::uuid
            AND current_ordinal = ${sibling.current_ordinal}
            AND current_status = 'pending'
          RETURNING proposal_id
        `;
        if (terminalSibling.length !== 1) {
          throw briefConflict(
            "CONSULTATION_PROPOSAL_STATE_CONFLICT",
            "A sibling proposal changed before the session could complete.",
          );
        }
      }
      await transaction`
        INSERT INTO consultation_proposal_confirmations (
          id, tenant_id, project_id, session_id, proposal_id, brief_id,
          base_brief_revision, applied_brief_revision, confirmed_by,
          idempotency_key, confirmed_at, request_id, trace_id
        ) VALUES (
          ${randomUUID()}::uuid, ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${validated.proposal.sessionId}::uuid, ${validated.proposal.id}::uuid,
          ${validated.proposal.baseBriefId}::uuid, ${validated.proposal.baseBriefRevision},
          ${record.brief.revision}, ${command.actor.userId}::uuid,
          ${validated.update.idempotencyKey}, ${validated.confirmedAt},
          ${command.correlation.requestId}, ${command.correlation.traceId}
        )
      `;
      const completedRows = await transaction<ConsultationSessionRow[]>`
        UPDATE consultation_sessions
        SET state = 'completed', updated_at = ${completionAt}
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${validated.proposal.sessionId}::uuid
          AND state = 'active' AND turn_count = ${command.expectedTurnCount}
        RETURNING tenant_id, project_id, id, schema_version, base_brief_id,
          base_brief_revision, provider_mode, state, turn_count, created_by,
          created_at, updated_at, cancelled_at
      `;
      const completedRow = completedRows[0];
      if (completedRows.length !== 1 || completedRow === undefined) {
        throw briefConflict(
          "CONSULTATION_SESSION_STATE_CONFLICT",
          "The consultation session changed before completion.",
        );
      }
      const result = {
        brief: record.brief,
        proposal: briefPatchProposalSchema.parse({
          ...validated.proposal,
          status: "confirmed",
        }),
        session: mapSession(completedRow),
      };
      await completeEffect(transaction, effectCommand, result);
      return { ...result, replayed: false };
    });
  }

  update(command: UpdateBriefCommand): Promise<BriefMutationResult> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, command, "brief.update");
      if (replay !== undefined) return { record: parseStoredRecord(replay), replayed: true };
      const current = await currentRevision(transaction, command.actor.tenantId, command.projectId);
      const currentNumber = current?.brief.revision ?? 0;
      if (command.expectedRevision !== currentNumber) throw briefRevisionConflict(currentNumber);
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
      assertNext(record, current, command.projectId);
      await insertRevision(transaction, command, record, current);
      await completeEffect(transaction, command, record);
      return { record, replayed: false };
    });
  }

  accept(command: AcceptBriefCommand): Promise<BriefMutationResult> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, command, "brief.accept");
      if (replay !== undefined) return { record: parseStoredRecord(replay), replayed: true };
      const current = await currentRevision(transaction, command.actor.tenantId, command.projectId);
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
      assertNext(record, current, command.projectId);
      await insertRevision(transaction, command, record, current);
      await completeEffect(transaction, command, record);
      return { record, replayed: false };
    });
  }
}
