import {
  briefPatchProposalSchema,
  consultationSessionSchema,
  designBriefSchema,
  type BriefPatchProposal,
  type ConsultationSession,
  type DesignBrief,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { JSONValue, Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../../src/c1.js";
import { applyC2Migration } from "../../../src/c2.js";
import { applyC3Migration } from "../../../src/c3.js";
import { applyC4Migration } from "../../../src/c4.js";
import { applyC5Migration } from "../../../src/c5.js";
import { applyC6Migration } from "../../../src/c6.js";
import { applyC7Migration } from "../../../src/c7.js";
import { applyC8Migration } from "../../../src/c8.js";
import { applyC9Migration } from "../../../src/c9.js";
import { applyC10Migration } from "../../../src/c10.js";
import { PostgresDesignAgentRepository } from "../../../src/modules/design-agent/postgres.js";
import { requestHash } from "../../../src/modules/projects/idempotency.js";
import { alphaTenantId, betaTenantId, editorUserId, ownerUserId } from "../../c4/fixtures.js";

const databaseUrl = process.env.C11_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const baseTime = new Date("2026-07-18T12:00:00.000Z");
function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function at(seconds: number): string {
  return new Date(baseTime.getTime() + seconds * 1_000).toISOString();
}

async function c11MigrationPath(): Promise<string> {
  const candidates = [
    process.env.C11_TEST_MIGRATION_PATH,
    path.resolve(process.cwd(), "migrations/0011_design_briefs.sql"),
    path.resolve(process.cwd(), "services/platform-api/migrations/0011_design_briefs.sql"),
  ].filter((candidate): candidate is string => candidate !== undefined);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next explicit or repository-relative candidate.
    }
  }
  throw new Error("C11_TEST_MIGRATION_PATH must identify migration 0011 before this suite runs.");
}

async function seedBrief(
  sql: Sql,
  options: { readonly briefId?: string; readonly projectId?: string } = {},
) {
  const projectId = options.projectId ?? randomUUID();
  const briefId = options.briefId ?? randomUUID();
  const brief = designBriefSchema.parse({
    createdAt: at(0),
    entries: [],
    id: briefId,
    projectId,
    referenceBoard: [],
    revision: 1,
    schemaVersion: "c11-design-brief-v1",
    status: "draft",
    updatedAt: at(0),
    updatedBy: ownerUserId,
  });
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO projects (id, tenant_id, name, status, created_at, updated_at)
      VALUES (
        ${projectId}::uuid, ${alphaTenantId}::uuid, 'Synthetic C11 repository project',
        'active', ${baseTime}, ${baseTime}
      )
    `;
    await transaction`
      INSERT INTO design_briefs (
        tenant_id, project_id, id, current_revision, current_status,
        latest_accepted_revision, created_by, created_at, updated_by, updated_at
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${briefId}::uuid, 1, 'draft',
        NULL, ${ownerUserId}::uuid, ${baseTime}, ${ownerUserId}::uuid, ${baseTime}
      )
    `;
    await transaction`
      INSERT INTO design_brief_revisions (
        tenant_id, project_id, brief_id, revision, schema_version, status, reason,
        previous_revision, brief_payload, canonical_byte_length, content_sha256,
        snapshot_sha256, entry_count, reference_count, updated_by, updated_at,
        accepted_by, accepted_at
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${briefId}::uuid, 1,
        'c11-design-brief-v1', 'draft', 'created', NULL,
        ${transaction.json(json(brief))}, ${Buffer.byteLength(JSON.stringify(brief))},
        ${"a".repeat(64)}, ${"b".repeat(64)}, 0, 0, ${ownerUserId}::uuid,
        ${baseTime}, NULL, NULL
      )
    `;
  });
  return { brief, briefId, projectId };
}

async function seedSecondBriefRevision(sql: Sql, current: DesignBrief): Promise<DesignBrief> {
  const brief = designBriefSchema.parse({
    ...current,
    revision: 2,
    updatedAt: at(10),
  });
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO design_brief_revisions (
        tenant_id, project_id, brief_id, revision, schema_version, status, reason,
        previous_revision, brief_payload, canonical_byte_length, content_sha256,
        snapshot_sha256, entry_count, reference_count, updated_by, updated_at,
        accepted_by, accepted_at
      ) VALUES (
        ${alphaTenantId}::uuid, ${brief.projectId}::uuid, ${brief.id}::uuid, 2,
        'c11-design-brief-v1', 'draft', 'updated', 1,
        ${transaction.json(json(brief))}, ${Buffer.byteLength(JSON.stringify(brief))},
        ${"c".repeat(64)}, ${"d".repeat(64)}, 0, 0, ${ownerUserId}::uuid,
        ${new Date(brief.updatedAt)}, NULL, NULL
      )
    `;
    await transaction`
      UPDATE design_briefs
      SET current_revision = 2, current_status = 'draft', updated_by = ${ownerUserId}::uuid,
          updated_at = ${new Date(brief.updatedAt)}
      WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${brief.projectId}::uuid
        AND id = ${brief.id}::uuid AND current_revision = 1
    `;
  });
  return brief;
}

function sessionFor(
  scope: { readonly briefId: string; readonly projectId: string },
  id = randomUUID(),
) {
  return consultationSessionSchema.parse({
    baseBriefId: scope.briefId,
    baseBriefRevision: 1,
    createdAt: at(1),
    createdBy: ownerUserId,
    id,
    projectId: scope.projectId,
    providerMode: "deterministic-local",
    schemaVersion: "c11-consultation-session-v1",
    state: "active",
    turnCount: 0,
    updatedAt: at(1),
  });
}

function proposalFor(
  session: ConsultationSession,
  messageId: string,
  options: { readonly id?: string; readonly seconds?: number } = {},
): BriefPatchProposal {
  const seconds = options.seconds ?? 2;
  return briefPatchProposalSchema.parse({
    baseBriefId: session.baseBriefId,
    baseBriefRevision: session.baseBriefRevision,
    clarifyingQuestions: [],
    createdAt: at(seconds),
    expiresAt: at(seconds + 1_800),
    id: options.id ?? randomUUID(),
    operations: [
      {
        entry: {
          category: "material-colour",
          classification: "preference",
          id: randomUUID(),
          priority: 3,
          provenance: {
            capturedAt: at(seconds),
            method: "assistant-extracted",
            sourceMessageId: messageId,
          },
          roomOrLevelElementIds: [],
          statement: "Household preference: deterministic synthetic warm oak.",
          status: "active",
        },
        kind: "entry.add",
      },
    ],
    professionalReview: [],
    projectId: session.projectId,
    providerManifest: {
      adapter: "deterministic-local-v1",
      externalNetworkUsed: false,
      promptRegistryVersion: "c11-brief-consultation-prompts-v1",
      toolRegistryVersion: "c11-brief-tools-v1",
    },
    schemaVersion: "c11-brief-patch-proposal-v1",
    sessionId: session.id,
    sourceMessageId: messageId,
    status: "pending",
    summary: "One synthetic preference requires explicit confirmation.",
  });
}

function createCommand(session: ConsultationSession, key = randomUUID()) {
  const request = {
    baseBriefId: session.baseBriefId,
    baseBriefRevision: session.baseBriefRevision,
    idempotencyKey: key,
    providerMode: session.providerMode,
  };
  return {
    idempotencyKey: key,
    requestSha256: requestHash(request),
    session,
    tenantId: alphaTenantId,
  };
}

function turnCommand(session: ConsultationSession, messageId: string, seconds = 2) {
  const body = `Synthetic local consultation message ${messageId}.`;
  return {
    actorUserId: ownerUserId,
    expectedTurnCount: session.turnCount,
    message: {
      body,
      createdAt: at(seconds),
      id: messageId,
      projectId: session.projectId,
      sender: "household" as const,
      sessionId: session.id,
    },
    messageSha256: requestHash({ message: body }),
    proposal: proposalFor(session, messageId, { seconds }),
    tenantId: alphaTenantId,
  };
}

describeWithPostgres("C11 durable design-agent repository", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    await applyC1Migration(sql);
    await bootstrapC1Fixtures(sql, "test");
    await applyC2Migration(sql);
    await applyC3Migration(sql);
    await applyC4Migration(sql);
    await applyC5Migration(sql);
    await applyC6Migration(sql);
    await applyC7Migration(sql);
    await applyC8Migration(sql);
    await applyC9Migration(sql);
    await applyC10Migration(sql);
    await sql.begin(async (transaction) => transaction.file(await c11MigrationPath()));
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("persists exact create replay and actor-bound, ordered concurrent turns", async () => {
    const scope = await seedBrief(sql);
    const repository = new PostgresDesignAgentRepository(sql);
    const session = sessionFor(scope);
    const command = createCommand(session);
    const created = await repository.createSession(command);
    const replay = await repository.createSession(command);
    expect(created).toEqual({ replayed: false, session });
    expect(replay).toEqual({ replayed: true, session });
    await expect(
      repository.findCreateSessionReplay({
        actorUserId: editorUserId,
        idempotencyKey: command.idempotencyKey,
        projectId: scope.projectId,
        requestSha256: command.requestSha256,
        tenantId: alphaTenantId,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const first = turnCommand(session, randomUUID());
    await expect(repository.appendTurn(first)).resolves.toMatchObject({ replayed: false });
    await expect(repository.appendTurn(first)).resolves.toMatchObject({ replayed: true });
    await expect(
      repository.appendTurn({ ...first, actorUserId: editorUserId }),
    ).rejects.toMatchObject({ code: "DESIGN_AGENT_MESSAGE_ID_CONFLICT" });

    const afterFirst = consultationSessionSchema.parse({
      ...session,
      turnCount: 1,
      updatedAt: at(2),
    });
    const concurrent = await Promise.allSettled([
      repository.appendTurn(turnCommand(afterFirst, randomUUID(), 3)),
      repository.appendTurn(turnCommand(afterFirst, randomUUID(), 4)),
    ]);
    expect(concurrent.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(
      repository.findProposal(alphaTenantId, scope.projectId, session.id, first.proposal.id),
    ).resolves.toMatchObject({ status: "rejected" });
    const pendingCount = await sql<{ readonly count: number }[]>`
      SELECT count(*)::integer AS count
      FROM consultation_proposal_heads h
      JOIN consultation_patch_proposals p
        ON p.tenant_id = h.tenant_id AND p.project_id = h.project_id
        AND p.id = h.proposal_id
      WHERE h.tenant_id = ${alphaTenantId}::uuid AND h.project_id = ${scope.projectId}::uuid
        AND p.session_id = ${session.id}::uuid AND h.current_status = 'pending'
    `;
    expect(pendingCount).toEqual([{ count: 1 }]);
    const supersededEvents = await sql<
      Array<{
        readonly changed_by: string | null;
        readonly ordinal: number;
        readonly reason_code: string | null;
        readonly status: string;
      }>
    >`
      SELECT changed_by, ordinal, reason_code, status
      FROM consultation_proposal_state_events
      WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${scope.projectId}::uuid
        AND proposal_id = ${first.proposal.id}::uuid
      ORDER BY ordinal
    `;
    expect(supersededEvents).toEqual([
      { changed_by: null, ordinal: 1, reason_code: null, status: "pending" },
      {
        changed_by: ownerUserId,
        ordinal: 2,
        reason_code: "superseded-by-new-turn",
        status: "rejected",
      },
    ]);
    await expect(
      repository.findSession(betaTenantId, scope.projectId, session.id),
    ).resolves.toBeUndefined();
    await expect(
      repository.findProposal(betaTenantId, scope.projectId, session.id, first.proposal.id),
    ).resolves.toBeUndefined();
  });

  it("rejects pending proposals on cancel, expires eligible proposals, and resists tampering", async () => {
    const repository = new PostgresDesignAgentRepository(sql);
    const cancelledScope = await seedBrief(sql);
    const cancelledSession = sessionFor(cancelledScope);
    await repository.createSession(createCommand(cancelledSession));
    const pending = turnCommand(cancelledSession, randomUUID());
    await repository.appendTurn(pending);
    const cancellation = await repository.cancelSession({
      actorUserId: ownerUserId,
      cancelledAt: at(5),
      correlation: {
        requestId: "c11-postgres-cancel",
        spanId: "1".repeat(16),
        traceId: "2".repeat(32),
        traceParent: `00-${"2".repeat(32)}-${"1".repeat(16)}-01`,
      },
      expectedSessionState: "active",
      expectedTurnCount: 1,
      idempotencyKey: randomUUID(),
      projectId: cancelledScope.projectId,
      sessionId: cancelledSession.id,
      tenantId: alphaTenantId,
    });
    expect(cancellation.session.state).toBe("cancelled");
    await expect(
      repository.findProposal(
        alphaTenantId,
        cancelledScope.projectId,
        cancelledSession.id,
        pending.proposal.id,
      ),
    ).resolves.toMatchObject({ status: "rejected" });

    const expiryScope = await seedBrief(sql);
    const expirySession = sessionFor(expiryScope);
    await repository.createSession(createCommand(expirySession));
    const expiring = turnCommand(expirySession, randomUUID());
    await repository.appendTurn(expiring);
    await expect(
      repository.expireProposal({
        expiredAt: expiring.proposal.expiresAt,
        projectId: expiryScope.projectId,
        proposalId: expiring.proposal.id,
        sessionId: expirySession.id,
        tenantId: alphaTenantId,
      }),
    ).resolves.toMatchObject({ status: "expired" });

    await expect(
      sql`
        UPDATE consultation_messages SET content = 'tampered'
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${expiryScope.projectId}::uuid
          AND id = ${expiring.message.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      sql`
        UPDATE consultation_patch_proposals SET proposal_sha256 = ${"e".repeat(64)}
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${expiryScope.projectId}::uuid
          AND id = ${expiring.proposal.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
  });

  it("looks up immutable confirmation linkage and rolls back a partially failed append", async () => {
    const repository = new PostgresDesignAgentRepository(sql);
    const scope = await seedBrief(sql);
    const session = sessionFor(scope);
    await repository.createSession(createCommand(session));
    const first = turnCommand(session, randomUUID());
    await repository.appendTurn(first);
    const revision = await seedSecondBriefRevision(sql, scope.brief);
    const confirmedAt = new Date(at(11));
    const confirmationKey = randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO consultation_proposal_state_events (
          tenant_id, project_id, proposal_id, ordinal, status, changed_by,
          reason_code, occurred_at
        ) VALUES (
          ${alphaTenantId}::uuid, ${scope.projectId}::uuid, ${first.proposal.id}::uuid,
          2, 'confirmed', ${ownerUserId}::uuid, 'confirmed', ${confirmedAt}
        )
      `;
      await transaction`
        UPDATE consultation_proposal_heads
        SET current_ordinal = 2, current_status = 'confirmed', updated_at = ${confirmedAt}
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${scope.projectId}::uuid
          AND proposal_id = ${first.proposal.id}::uuid
      `;
      await transaction`
        INSERT INTO consultation_proposal_confirmations (
          id, tenant_id, project_id, session_id, proposal_id, brief_id,
          base_brief_revision, applied_brief_revision, confirmed_by, idempotency_key,
          confirmed_at, request_id, trace_id
        ) VALUES (
          ${randomUUID()}::uuid, ${alphaTenantId}::uuid, ${scope.projectId}::uuid,
          ${session.id}::uuid, ${first.proposal.id}::uuid, ${revision.id}::uuid, 1, 2,
          ${ownerUserId}::uuid, ${confirmationKey}, ${confirmedAt},
          'c11-postgres-confirmation-lookup', ${"3".repeat(32)}
        )
      `;
      await transaction`
        UPDATE consultation_sessions SET state = 'completed', updated_at = ${confirmedAt}
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${scope.projectId}::uuid
          AND id = ${session.id}::uuid
      `;
    });
    await expect(
      repository.findConfirmation(alphaTenantId, scope.projectId, session.id, first.proposal.id),
    ).resolves.toMatchObject({
      actorUserId: ownerUserId,
      briefRevision: 2,
      idempotencyKey: confirmationKey,
    });

    const rollbackSession = sessionFor(scope);
    await repository.createSession(createCommand(rollbackSession));
    const collision = turnCommand(rollbackSession, randomUUID());
    collision.proposal = briefPatchProposalSchema.parse({
      ...collision.proposal,
      id: first.proposal.id,
    });
    await expect(repository.appendTurn(collision)).rejects.toThrow();
    await expect(
      repository.findTurnByClientMessageId(
        alphaTenantId,
        scope.projectId,
        rollbackSession.id,
        collision.message.id,
      ),
    ).resolves.toBeUndefined();
    await expect(
      repository.findSession(alphaTenantId, scope.projectId, rollbackSession.id),
    ).resolves.toMatchObject({ turnCount: 0 });
  });
});
