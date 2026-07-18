import {
  briefPatchProposalSchema,
  consultationSessionSchema,
  type BriefPatchProposal,
  type ConsultationSession,
} from "@interior-design/contracts";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { designAgentConflict, designAgentUnavailable } from "./errors.js";
import type {
  AppendTurnRepositoryCommand,
  CancelSessionRepositoryCommand,
  ConsultationMessage,
  ConsultationTurn,
  CreateSessionRepositoryCommand,
  DesignAgentRepository,
  ExpireProposalRepositoryCommand,
  FindCreateSessionReplayCommand,
  ProposalConfirmation,
  StoredConsultationTurn,
} from "./types.js";

type Database = Sql | TransactionSql;
type ConsultationOperation = "consultation.session.cancel" | "consultation.session.create";

interface SessionRow {
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

interface ProposalRow {
  readonly current_ordinal: number;
  readonly current_status: string;
  readonly expires_at: Date | string;
  readonly proposal_payload: unknown;
  readonly proposal_sha256: string;
  readonly updated_at: Date | string;
}

interface MessageRow extends SessionRow {
  readonly content: string;
  readonly content_sha256: string;
  readonly message_created_at: Date | string;
  readonly message_created_by: string;
  readonly message_id: string;
  readonly ordinal: number;
}

interface EffectRow {
  readonly actor_user_id: string;
  readonly operation: string;
  readonly project_id: string;
  readonly request_sha256: string;
  readonly response_payload: unknown;
  readonly response_status: number | null;
}

interface EffectClaim {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly operation: ConsultationOperation;
  readonly projectId: string;
  readonly requestSha256: string;
  readonly tenantId: string;
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapSession(row: SessionRow): ConsultationSession {
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

function mapProposal(row: ProposalRow, current = true): BriefPatchProposal {
  const payload = briefPatchProposalSchema.parse(row.proposal_payload);
  return briefPatchProposalSchema.parse({
    ...payload,
    status: current ? row.current_status : payload.status,
  });
}

async function findSessionRow(
  database: Database,
  tenantId: string,
  projectId: string,
  sessionId: string,
): Promise<SessionRow | undefined> {
  const rows = await database<SessionRow[]>`
    SELECT base_brief_id, base_brief_revision, cancelled_at, created_at, created_by,
      id, project_id, provider_mode, schema_version, state, turn_count, updated_at
    FROM consultation_sessions
    WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      AND id = ${sessionId}::uuid
    LIMIT 1
  `;
  return rows[0];
}

async function findProposalRow(
  database: Database,
  tenantId: string,
  projectId: string,
  sessionId: string,
  proposalId: string,
): Promise<ProposalRow | undefined> {
  const rows = await database<ProposalRow[]>`
    SELECT p.proposal_payload, p.proposal_sha256, p.expires_at,
      h.current_ordinal, h.current_status, h.updated_at
    FROM consultation_patch_proposals p
    JOIN consultation_proposal_heads h
      ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id
      AND h.proposal_id = p.id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.project_id = ${projectId}::uuid
      AND p.session_id = ${sessionId}::uuid AND p.id = ${proposalId}::uuid
    LIMIT 1
  `;
  return rows[0];
}

async function findStoredTurn(
  database: Database,
  tenantId: string,
  projectId: string,
  sessionId: string,
  clientMessageId: string,
): Promise<StoredConsultationTurn | undefined> {
  const messages = await database<MessageRow[]>`
    SELECT
      s.base_brief_id, s.base_brief_revision, s.cancelled_at, s.created_at,
      s.created_by, s.id, s.project_id, s.provider_mode, s.schema_version,
      s.state, s.turn_count, s.updated_at,
      m.id AS message_id, m.ordinal, m.content, m.content_sha256,
      m.created_at AS message_created_at, m.created_by AS message_created_by
    FROM consultation_messages m
    JOIN consultation_sessions s
      ON s.tenant_id = m.tenant_id AND s.project_id = m.project_id
      AND s.id = m.session_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.project_id = ${projectId}::uuid
      AND m.session_id = ${sessionId}::uuid
      AND m.client_message_id = ${clientMessageId}::uuid AND m.role = 'user'
    LIMIT 1
  `;
  const row = messages[0];
  if (row === undefined) return undefined;
  if (row.content_sha256 !== requestHash({ message: row.content })) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_TURN_STORAGE_INVALID",
      "A persisted consultation message failed its integrity check.",
    );
  }
  const proposals = await database<ProposalRow[]>`
    SELECT p.proposal_payload, p.proposal_sha256, p.expires_at,
      h.current_ordinal, h.current_status, h.updated_at
    FROM consultation_patch_proposals p
    JOIN consultation_proposal_heads h
      ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id
      AND h.proposal_id = p.id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.project_id = ${projectId}::uuid
      AND p.session_id = ${sessionId}::uuid AND p.source_message_id = ${row.message_id}::uuid
    ORDER BY p.created_at, p.id
    LIMIT 2
  `;
  if (proposals.length !== 1 || proposals[0] === undefined) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_TURN_STORAGE_INVALID",
      "A persisted consultation turn has an invalid proposal linkage.",
    );
  }
  const messageCreatedAt = iso(row.message_created_at);
  const session = consultationSessionSchema.parse({
    ...mapSession(row),
    cancelledAt: undefined,
    state: "active",
    turnCount: row.ordinal,
    updatedAt: messageCreatedAt,
  });
  const message: ConsultationMessage = {
    body: row.content,
    createdAt: messageCreatedAt,
    id: row.message_id,
    projectId,
    sender: "household",
    sessionId,
  };
  return {
    createdByUserId: row.message_created_by,
    messageSha256: row.content_sha256,
    turn: { message, proposal: mapProposal(proposals[0], false), session },
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

async function claimEffect(transaction: TransactionSql, claim: EffectClaim): Promise<unknown> {
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO design_brief_idempotency_effects (
      tenant_id, project_id, idempotency_key, actor_user_id, operation,
      request_sha256, created_at
    ) VALUES (
      ${claim.tenantId}::uuid, ${claim.projectId}::uuid, ${claim.idempotencyKey},
      ${claim.actorUserId}::uuid, ${claim.operation}, ${claim.requestSha256},
      clock_timestamp()
    ) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) return undefined;
  const rows = await transaction<EffectRow[]>`
    SELECT actor_user_id, operation, project_id, request_sha256,
      response_payload, response_status
    FROM design_brief_idempotency_effects
    WHERE tenant_id = ${claim.tenantId}::uuid AND idempotency_key = ${claim.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (stored === undefined) throw new Error("The consultation idempotency effect disappeared.");
  if (
    stored.actor_user_id !== claim.actorUserId ||
    stored.operation !== claim.operation ||
    stored.project_id !== claim.projectId ||
    stored.request_sha256 !== claim.requestSha256
  ) {
    throw designAgentConflict(
      "IDEMPOTENCY_CONFLICT",
      "The Idempotency-Key was already used for a different consultation mutation.",
    );
  }
  const expectedStatus = claim.operation === "consultation.session.create" ? 201 : 200;
  if (stored.response_status !== expectedStatus || stored.response_payload === null) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_IDEMPOTENCY_INCOMPLETE",
      "A consultation idempotency effect is incomplete.",
    );
  }
  return stored.response_payload;
}

async function completeEffect(
  transaction: TransactionSql,
  claim: EffectClaim,
  status: 200 | 201,
  body: object,
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE design_brief_idempotency_effects
    SET response_status = ${status}, response_payload = ${transaction.json(json(body))},
        completed_at = clock_timestamp()
    WHERE tenant_id = ${claim.tenantId}::uuid AND idempotency_key = ${claim.idempotencyKey}
      AND actor_user_id = ${claim.actorUserId}::uuid AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (rows.length !== 1) {
    throw new Error("Consultation idempotency completion did not update exactly one effect.");
  }
}

function createClaim(command: CreateSessionRepositoryCommand): EffectClaim {
  return {
    actorUserId: command.session.createdBy,
    idempotencyKey: command.idempotencyKey,
    operation: "consultation.session.create",
    projectId: command.session.projectId,
    requestSha256: command.requestSha256,
    tenantId: command.tenantId,
  };
}

function cancelClaim(command: CancelSessionRepositoryCommand): EffectClaim {
  return {
    actorUserId: command.actorUserId,
    idempotencyKey: command.idempotencyKey,
    operation: "consultation.session.cancel",
    projectId: command.projectId,
    requestSha256: requestHash({
      expectedTurnCount: command.expectedTurnCount,
      projectId: command.projectId,
      sessionId: command.sessionId,
    }),
    tenantId: command.tenantId,
  };
}

export class PostgresDesignAgentRepository implements DesignAgentRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findCreateSessionReplay(
    command: FindCreateSessionReplayCommand,
  ): Promise<ConsultationSession | undefined> {
    const rows = await this.#sql<EffectRow[]>`
      SELECT actor_user_id, operation, project_id, request_sha256,
        response_payload, response_status
      FROM design_brief_idempotency_effects
      WHERE tenant_id = ${command.tenantId}::uuid
        AND idempotency_key = ${command.idempotencyKey}
      LIMIT 1
    `;
    const stored = rows[0];
    if (stored === undefined) return undefined;
    if (
      stored.actor_user_id !== command.actorUserId ||
      stored.operation !== "consultation.session.create" ||
      stored.project_id !== command.projectId ||
      stored.request_sha256 !== command.requestSha256
    ) {
      throw designAgentConflict(
        "IDEMPOTENCY_CONFLICT",
        "The Idempotency-Key was already used for a different consultation mutation.",
      );
    }
    if (stored.response_status === null && stored.response_payload === null) return undefined;
    if (stored.response_status !== 201 || stored.response_payload === null) {
      throw designAgentUnavailable(
        "DESIGN_AGENT_IDEMPOTENCY_INCOMPLETE",
        "A consultation create idempotency effect is incomplete.",
      );
    }
    return consultationSessionSchema.parse(stored.response_payload);
  }

  async createSession(
    command: CreateSessionRepositoryCommand,
  ): Promise<{ readonly replayed: boolean; readonly session: ConsultationSession }> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.tenantId, command.session.projectId);
      const claim = createClaim(command);
      const replay = await claimEffect(transaction, claim);
      if (replay !== undefined) {
        return { replayed: true, session: consultationSessionSchema.parse(replay) };
      }
      const session = consultationSessionSchema.parse(command.session);
      await transaction`
        INSERT INTO consultation_sessions (
          tenant_id, project_id, id, schema_version, base_brief_id, base_brief_revision,
          provider_mode, state, turn_count, created_by, created_at, updated_at, cancelled_at
        ) VALUES (
          ${command.tenantId}::uuid, ${session.projectId}::uuid, ${session.id}::uuid,
          ${session.schemaVersion}, ${session.baseBriefId}::uuid, ${session.baseBriefRevision},
          ${session.providerMode}, ${session.state}, ${session.turnCount},
          ${session.createdBy}::uuid, ${new Date(session.createdAt)},
          ${new Date(session.updatedAt)}, NULL
        )
      `;
      await completeEffect(transaction, claim, 201, session);
      return { replayed: false, session };
    });
  }

  async findSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ConsultationSession | undefined> {
    const row = await findSessionRow(this.#sql, tenantId, projectId, sessionId);
    return row === undefined ? undefined : mapSession(row);
  }

  async cancelSession(
    command: CancelSessionRepositoryCommand,
  ): Promise<{ readonly replayed: boolean; readonly session: ConsultationSession }> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.tenantId, command.projectId);
      const claim = cancelClaim(command);
      const replay = await claimEffect(transaction, claim);
      if (replay !== undefined) {
        return { replayed: true, session: consultationSessionSchema.parse(replay) };
      }
      const rows = await transaction<SessionRow[]>`
        SELECT base_brief_id, base_brief_revision, cancelled_at, created_at, created_by,
          id, project_id, provider_mode, schema_version, state, turn_count, updated_at
        FROM consultation_sessions
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.sessionId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) throw notFound();
      if (
        row.state !== command.expectedSessionState ||
        row.turn_count !== command.expectedTurnCount
      ) {
        throw designAgentConflict(
          "DESIGN_AGENT_SESSION_CONFLICT",
          "The consultation session changed before cancellation.",
        );
      }
      const pending = await transaction<
        Array<{ readonly current_ordinal: number; readonly proposal_id: string }>
      >`
        SELECT h.proposal_id, h.current_ordinal
        FROM consultation_proposal_heads h
        JOIN consultation_patch_proposals p
          ON p.tenant_id = h.tenant_id AND p.project_id = h.project_id
          AND p.id = h.proposal_id
        WHERE h.tenant_id = ${command.tenantId}::uuid
          AND h.project_id = ${command.projectId}::uuid
          AND p.session_id = ${command.sessionId}::uuid AND h.current_status = 'pending'
        ORDER BY h.proposal_id
        FOR UPDATE OF h
      `;
      for (const proposal of pending) {
        await transaction`
          INSERT INTO consultation_proposal_state_events (
            tenant_id, project_id, proposal_id, ordinal, status, changed_by,
            reason_code, occurred_at
          ) VALUES (
            ${command.tenantId}::uuid, ${command.projectId}::uuid,
            ${proposal.proposal_id}::uuid, ${proposal.current_ordinal + 1}, 'rejected',
            ${command.actorUserId}::uuid, 'session-cancelled', ${new Date(command.cancelledAt)}
          )
        `;
        const rejected = await transaction<{ readonly proposal_id: string }[]>`
          UPDATE consultation_proposal_heads
          SET current_ordinal = ${proposal.current_ordinal + 1}, current_status = 'rejected',
              updated_at = ${new Date(command.cancelledAt)}
          WHERE tenant_id = ${command.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND proposal_id = ${proposal.proposal_id}::uuid
            AND current_ordinal = ${proposal.current_ordinal} AND current_status = 'pending'
          RETURNING proposal_id
        `;
        if (rejected.length !== 1) {
          throw designAgentConflict(
            "DESIGN_AGENT_SESSION_CONFLICT",
            "A proposal changed before cancellation completed.",
          );
        }
      }
      const updated = await transaction<SessionRow[]>`
        UPDATE consultation_sessions
        SET state = 'cancelled', cancelled_at = ${new Date(command.cancelledAt)},
            updated_at = ${new Date(command.cancelledAt)}
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.sessionId}::uuid AND state = ${command.expectedSessionState}
          AND turn_count = ${command.expectedTurnCount}
        RETURNING base_brief_id, base_brief_revision, cancelled_at, created_at, created_by,
          id, project_id, provider_mode, schema_version, state, turn_count, updated_at
      `;
      if (updated.length !== 1 || updated[0] === undefined) {
        throw designAgentConflict(
          "DESIGN_AGENT_SESSION_CONFLICT",
          "The consultation session changed before cancellation.",
        );
      }
      const session = mapSession(updated[0]);
      await completeEffect(transaction, claim, 200, session);
      return { replayed: false, session };
    });
  }

  async appendTurn(
    command: AppendTurnRepositoryCommand,
  ): Promise<{ readonly replayed: boolean; readonly turn: ConsultationTurn }> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<SessionRow[]>`
        SELECT base_brief_id, base_brief_revision, cancelled_at, created_at, created_by,
          id, project_id, provider_mode, schema_version, state, turn_count, updated_at
        FROM consultation_sessions
        WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.message.projectId}::uuid
          AND id = ${command.message.sessionId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) throw notFound();
      const prior = await findStoredTurn(
        transaction,
        command.tenantId,
        command.message.projectId,
        command.message.sessionId,
        command.message.id,
      );
      if (prior !== undefined) {
        if (
          prior.createdByUserId !== command.actorUserId ||
          prior.messageSha256 !== command.messageSha256
        ) {
          throw designAgentConflict(
            "DESIGN_AGENT_MESSAGE_ID_CONFLICT",
            "The client message ID was already used by another message command.",
          );
        }
        return { replayed: true, turn: prior.turn };
      }
      if (
        row.state !== "active" ||
        row.turn_count !== command.expectedTurnCount ||
        row.provider_mode !== "deterministic-local"
      ) {
        throw designAgentConflict(
          "DESIGN_AGENT_TURN_CONFLICT",
          "The consultation session changed before the message was stored.",
        );
      }
      const proposal = briefPatchProposalSchema.parse(command.proposal);
      if (
        proposal.status !== "pending" ||
        proposal.projectId !== command.message.projectId ||
        proposal.sessionId !== command.message.sessionId ||
        proposal.sourceMessageId !== command.message.id ||
        proposal.baseBriefId !== row.base_brief_id ||
        proposal.baseBriefRevision !== row.base_brief_revision
      ) {
        throw designAgentConflict(
          "DESIGN_AGENT_TURN_SCOPE_INVALID",
          "The proposed patch does not match the locked consultation session.",
        );
      }
      const priorPending = await transaction<
        Array<{ readonly current_ordinal: number; readonly proposal_id: string }>
      >`
        SELECT h.proposal_id, h.current_ordinal
        FROM consultation_proposal_heads h
        JOIN consultation_patch_proposals p
          ON p.tenant_id = h.tenant_id AND p.project_id = h.project_id
          AND p.id = h.proposal_id
        WHERE h.tenant_id = ${command.tenantId}::uuid
          AND h.project_id = ${command.message.projectId}::uuid
          AND p.session_id = ${command.message.sessionId}::uuid
          AND h.current_status = 'pending'
        ORDER BY h.proposal_id
        FOR UPDATE OF h
      `;
      for (const priorProposal of priorPending) {
        const nextOrdinal = priorProposal.current_ordinal + 1;
        await transaction`
          INSERT INTO consultation_proposal_state_events (
            tenant_id, project_id, proposal_id, ordinal, status, changed_by,
            reason_code, occurred_at
          ) VALUES (
            ${command.tenantId}::uuid, ${command.message.projectId}::uuid,
            ${priorProposal.proposal_id}::uuid, ${nextOrdinal}, 'rejected',
            ${command.actorUserId}::uuid, 'superseded-by-new-turn',
            ${new Date(command.message.createdAt)}
          )
        `;
        const superseded = await transaction<{ readonly proposal_id: string }[]>`
          UPDATE consultation_proposal_heads
          SET current_ordinal = ${nextOrdinal}, current_status = 'rejected',
              updated_at = ${new Date(command.message.createdAt)}
          WHERE tenant_id = ${command.tenantId}::uuid
            AND project_id = ${command.message.projectId}::uuid
            AND proposal_id = ${priorProposal.proposal_id}::uuid
            AND current_ordinal = ${priorProposal.current_ordinal}
            AND current_status = 'pending'
          RETURNING proposal_id
        `;
        if (superseded.length !== 1) {
          throw designAgentConflict(
            "DESIGN_AGENT_TURN_CONFLICT",
            "A prior proposal changed before the new turn was stored.",
          );
        }
      }
      const ordinal = command.expectedTurnCount + 1;
      await transaction`
        INSERT INTO consultation_messages (
          tenant_id, project_id, session_id, id, ordinal, role, client_message_id,
          content, content_sha256, created_by, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.message.projectId}::uuid,
          ${command.message.sessionId}::uuid, ${command.message.id}::uuid, ${ordinal},
          'user', ${command.message.id}::uuid, ${command.message.body},
          ${command.messageSha256}, ${command.actorUserId}::uuid,
          ${new Date(command.message.createdAt)}
        )
      `;
      await transaction`
        INSERT INTO consultation_patch_proposals (
          tenant_id, project_id, session_id, id, schema_version, base_brief_id,
          base_brief_revision, source_message_id, proposal_payload, proposal_sha256,
          created_at, expires_at
        ) VALUES (
          ${command.tenantId}::uuid, ${proposal.projectId}::uuid, ${proposal.sessionId}::uuid,
          ${proposal.id}::uuid, ${proposal.schemaVersion}, ${proposal.baseBriefId}::uuid,
          ${proposal.baseBriefRevision}, ${proposal.sourceMessageId}::uuid,
          ${transaction.json(json(proposal))}, ${requestHash(proposal)},
          ${new Date(proposal.createdAt)}, ${new Date(proposal.expiresAt)}
        )
      `;
      await transaction`
        INSERT INTO consultation_proposal_state_events (
          tenant_id, project_id, proposal_id, ordinal, status, occurred_at
        ) VALUES (
          ${command.tenantId}::uuid, ${proposal.projectId}::uuid, ${proposal.id}::uuid,
          1, 'pending', ${new Date(proposal.createdAt)}
        )
      `;
      await transaction`
        INSERT INTO consultation_proposal_heads (
          tenant_id, project_id, proposal_id, current_ordinal, current_status, updated_at
        ) VALUES (
          ${command.tenantId}::uuid, ${proposal.projectId}::uuid, ${proposal.id}::uuid,
          1, 'pending', ${new Date(proposal.createdAt)}
        )
      `;
      const updated = await transaction<SessionRow[]>`
        UPDATE consultation_sessions
        SET turn_count = ${ordinal}, updated_at = ${new Date(command.message.createdAt)}
        WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.message.projectId}::uuid
          AND id = ${command.message.sessionId}::uuid AND state = 'active'
          AND turn_count = ${command.expectedTurnCount}
        RETURNING base_brief_id, base_brief_revision, cancelled_at, created_at, created_by,
          id, project_id, provider_mode, schema_version, state, turn_count, updated_at
      `;
      if (updated.length !== 1 || updated[0] === undefined) {
        throw designAgentConflict(
          "DESIGN_AGENT_TURN_CONFLICT",
          "The consultation session changed before the message was stored.",
        );
      }
      return {
        replayed: false,
        turn: { message: command.message, proposal, session: mapSession(updated[0]) },
      };
    });
  }

  findTurnByClientMessageId(
    tenantId: string,
    projectId: string,
    sessionId: string,
    clientMessageId: string,
  ): Promise<StoredConsultationTurn | undefined> {
    return findStoredTurn(this.#sql, tenantId, projectId, sessionId, clientMessageId);
  }

  async findProposal(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<BriefPatchProposal | undefined> {
    const row = await findProposalRow(this.#sql, tenantId, projectId, sessionId, proposalId);
    return row === undefined ? undefined : mapProposal(row);
  }

  async expireProposal(command: ExpireProposalRepositoryCommand): Promise<BriefPatchProposal> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<ProposalRow[]>`
        SELECT p.proposal_payload, p.proposal_sha256, p.expires_at,
          h.current_ordinal, h.current_status, h.updated_at
        FROM consultation_patch_proposals p
        JOIN consultation_proposal_heads h
          ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id
          AND h.proposal_id = p.id
        WHERE p.tenant_id = ${command.tenantId}::uuid
          AND p.project_id = ${command.projectId}::uuid
          AND p.session_id = ${command.sessionId}::uuid AND p.id = ${command.proposalId}::uuid
        LIMIT 1 FOR UPDATE OF h
      `;
      const row = rows[0];
      if (row === undefined) throw notFound();
      if (row.current_status === "expired") return mapProposal(row);
      if (
        row.current_status !== "pending" ||
        new Date(row.expires_at).getTime() > Date.parse(command.expiredAt)
      ) {
        throw designAgentConflict(
          "DESIGN_AGENT_PROPOSAL_EXPIRY_CONFLICT",
          "The consultation proposal is not eligible to expire.",
        );
      }
      const ordinal = row.current_ordinal + 1;
      await transaction`
        INSERT INTO consultation_proposal_state_events (
          tenant_id, project_id, proposal_id, ordinal, status, reason_code, occurred_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.proposalId}::uuid, ${ordinal}, 'expired', 'expired',
          ${new Date(command.expiredAt)}
        )
      `;
      const updated = await transaction<{ readonly proposal_id: string }[]>`
        UPDATE consultation_proposal_heads
        SET current_ordinal = ${ordinal}, current_status = 'expired',
            updated_at = ${new Date(command.expiredAt)}
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND proposal_id = ${command.proposalId}::uuid
          AND current_ordinal = ${row.current_ordinal} AND current_status = 'pending'
        RETURNING proposal_id
      `;
      if (updated.length !== 1) {
        throw designAgentConflict(
          "DESIGN_AGENT_PROPOSAL_EXPIRY_CONFLICT",
          "The consultation proposal changed before expiry completed.",
        );
      }
      return briefPatchProposalSchema.parse({ ...mapProposal(row, false), status: "expired" });
    });
  }

  async findConfirmation(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<ProposalConfirmation | undefined> {
    const rows = await this.#sql<
      Array<{
        readonly applied_brief_revision: number;
        readonly brief_id: string;
        readonly confirmed_at: Date | string;
        readonly confirmed_by: string;
        readonly idempotency_key: string;
        readonly project_id: string;
        readonly proposal_id: string;
        readonly session_id: string;
      }>
    >`
      SELECT applied_brief_revision, brief_id, confirmed_at, confirmed_by,
        idempotency_key, project_id, proposal_id, session_id
      FROM consultation_proposal_confirmations
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND session_id = ${sessionId}::uuid AND proposal_id = ${proposalId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          actorUserId: row.confirmed_by,
          briefId: row.brief_id,
          briefRevision: row.applied_brief_revision,
          confirmedAt: iso(row.confirmed_at),
          idempotencyKey: row.idempotency_key,
          projectId: row.project_id,
          proposalId: row.proposal_id,
          sessionId: row.session_id,
        };
  }
}
