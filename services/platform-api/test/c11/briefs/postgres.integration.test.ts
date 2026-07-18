import { loadPlatformApiConfig } from "@interior-design/config";
import {
  briefPatchProposalSchema,
  type LocalPersona,
  type Project,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { JSONValue, Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../../src/c1.js";
import { applyC10Migration } from "../../../src/c10.js";
import { applyC2Migration } from "../../../src/c2.js";
import { applyC3Migration } from "../../../src/c3.js";
import { applyC4Migration } from "../../../src/c4.js";
import { applyC5Migration } from "../../../src/c5.js";
import { applyC6Migration } from "../../../src/c6.js";
import { applyC7Migration } from "../../../src/c7.js";
import { applyC8Migration } from "../../../src/c8.js";
import { applyC9Migration } from "../../../src/c9.js";
import { createServer } from "../../../src/app.js";
import { PostgresBriefRepository } from "../../../src/modules/briefs/postgres.js";
import { registerBriefRoutes } from "../../../src/modules/briefs/routes.js";
import { BriefService } from "../../../src/modules/briefs/service.js";
import {
  PostgresBriefSourceVerifier,
  evidenceRightsRecordSha256,
} from "../../../src/modules/briefs/sources.js";
import { LocalFixtureTokenProvider } from "../../../src/modules/identity/jwt.js";
import { PostgresIdentityStore } from "../../../src/modules/identity/postgres.js";
import { IdentityService } from "../../../src/modules/identity/service.js";
import { PostgresProjectRepository } from "../../../src/modules/projects/repository.js";
import { requestHash } from "../../../src/modules/projects/idempotency.js";
import {
  FixtureBriefKernel,
  c11Now,
  correlation,
  evidenceEntry,
  householdEntry,
  owner,
  referenceItem,
  secondEntryId,
} from "./support.js";

const databaseUrl = process.env.C11_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const sessionSecret = "c11-postgres-session-secret-with-at-least-thirty-two-bytes";
const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});
const activeServers = new Set<ReturnType<typeof createServer>>();

async function migrationPath(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "migrations/0011_design_briefs.sql"),
    path.resolve(process.cwd(), "services/platform-api/migrations/0011_design_briefs.sql"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the repository-relative fallback.
    }
  }
  throw new Error("The C11 migration could not be located.");
}

async function applyC11Migration(sql: Sql): Promise<void> {
  const file = await migrationPath();
  await sql.begin(async (transaction) => transaction.file(file));
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function signIn(server: ReturnType<typeof createServer>, persona: LocalPersona) {
  const response = await server.inject({
    method: "POST",
    payload: { persona },
    url: "/v1/auth/local/session",
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ readonly accessToken: string }>().accessToken;
}

async function createProject(server: ReturnType<typeof createServer>, token: string) {
  const response = await server.inject({
    headers: { ...authorization(token), "idempotency-key": `c11-project-${randomUUID()}` },
    method: "POST",
    payload: { name: `Synthetic C11 ${randomUUID()}` },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function updateRequest(
  token: string,
  projectId: string,
  expectedRevision: number,
  operations: readonly object[],
  idempotencyKey = randomUUID(),
) {
  return {
    headers: authorization(token),
    method: "PUT" as const,
    payload: { expectedRevision, idempotencyKey, operations },
    url: `/v1/projects/${projectId}/design-brief`,
  };
}

describeWithPostgres("C11 live Postgres brief workflow", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(databaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await applyC2Migration(administration);
    await applyC3Migration(administration);
    await applyC4Migration(administration);
    await applyC5Migration(administration);
    await applyC6Migration(administration);
    await applyC7Migration(administration);
    await applyC8Migration(administration);
    await applyC9Migration(administration);
    await applyC10Migration(administration);
    await applyC11Migration(administration);
  });

  afterAll(async () => administration.end({ timeout: 5 }));
  afterEach(async () => {
    await Promise.all(
      [...activeServers].map(async (server) => {
        await server.close();
        activeServers.delete(server);
      }),
    );
  });

  function liveServer() {
    let briefNow = c11Now;
    const server = createServer({
      c1: { closeDatabase: true, database: createC1Sql(databaseUrl) },
      config,
      environment: { C1_LOCAL_SESSION_SECRET: sessionSecret, NODE_ENV: "test" },
      logger: false,
    });
    const briefSql = createC1Sql(databaseUrl);
    const identity = new IdentityService(
      "test",
      new PostgresIdentityStore(briefSql),
      new LocalFixtureTokenProvider(sessionSecret),
    );
    const repository = new PostgresBriefRepository(briefSql, new FixtureBriefKernel(), {
      clock: { now: () => new Date(briefNow) },
    });
    const service = new BriefService({
      confirmation: repository,
      repository,
      sources: new PostgresBriefSourceVerifier(briefSql),
    });
    registerBriefRoutes(server, identity, new PostgresProjectRepository(briefSql), service);
    server.addHook("onClose", async () => briefSql.end({ timeout: 5 }));
    activeServers.add(server);
    return {
      repository,
      server,
      service,
      setNow: (value: string) => {
        briefNow = value;
      },
    };
  }

  it("applies all brief/consultation tables and defaults their histories to empty", async () => {
    const expected = [
      "consultation_messages",
      "consultation_patch_proposals",
      "consultation_proposal_confirmations",
      "consultation_proposal_heads",
      "consultation_proposal_state_events",
      "consultation_sessions",
      "design_brief_acceptance_events",
      "design_brief_audit_events",
      "design_brief_entry_projections",
      "design_brief_idempotency_effects",
      "design_brief_reference_projections",
      "design_brief_revisions",
      "design_briefs",
    ];
    const rows = await administration<{ readonly table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${administration.array(expected)}::text[])
      ORDER BY table_name
    `;
    expect(rows.map(({ table_name }) => table_name)).toEqual(expected);
  });

  it("proves exact replay, stale/concurrent writes, acceptance/reopen history, scope and immutability", async () => {
    const { repository, server } = liveServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const editorToken = await signIn(server, "editor-alpha");
    const viewerToken = await signIn(server, "viewer-alpha");
    const foreignToken = await signIn(server, "homeowner-beta");
    const project = await createProject(server, ownerToken);
    const liveAssetId = randomUUID();
    const assertedAt = new Date(c11Now).toISOString();
    const sourceObjectKey = `sources/${randomUUID()}`;
    await administration`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key,
        status, created_at, updated_at
      ) VALUES (
        ${liveAssetId}::uuid, ${project.tenantId}::uuid, ${project.id}::uuid,
        'photograph', 'synthetic-c11.jpg', 'image/jpeg', 'image/jpeg', 1024,
        ${"a".repeat(64)}, ${sourceObjectKey}, 'ready', ${new Date(assertedAt)},
        ${new Date(assertedAt)}
      )
    `;
    await administration`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis, service_processing_consent,
        training_use_consent, asserted_at
      ) VALUES (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${liveAssetId}::uuid,
        'owned-by-user', true, 'denied', ${new Date(assertedAt)}
      )
    `;
    const rightsSha256 = evidenceRightsRecordSha256({
      assertedAt,
      assetId: liveAssetId,
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    });
    const firstKey = randomUUID();
    const first = updateRequest(
      ownerToken,
      project.id,
      0,
      [
        {
          entry: {
            ...evidenceEntry(),
            provenance: {
              assetId: liveAssetId,
              capturedAt: c11Now,
              method: "evidence-linked",
            },
          },
          kind: "entry.add",
        },
        {
          item: { ...referenceItem(), assetId: liveAssetId, rightsRecordSha256: rightsSha256 },
          kind: "reference.add",
        },
      ],
      firstKey,
    );
    const [createdLeft, createdRight] = await Promise.all([
      server.inject(first),
      server.inject(first),
    ]);
    expect([createdLeft.statusCode, createdRight.statusCode]).toEqual([200, 200]);
    expect(createdRight.json()).toEqual(createdLeft.json());
    expect([
      createdLeft.headers["idempotent-replay"],
      createdRight.headers["idempotent-replay"],
    ]).toContain("true");
    const differentBody = await server.inject(
      updateRequest(
        ownerToken,
        project.id,
        0,
        [{ entry: householdEntry(), kind: "entry.add" }],
        firstKey,
      ),
    );
    expect(differentBody.statusCode).toBe(409);
    expect(differentBody.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const concurrent = await Promise.all([
      server.inject(
        updateRequest(ownerToken, project.id, 1, [
          {
            entry: householdEntry(secondEntryId),
            kind: "entry.add",
          },
        ]),
      ),
      server.inject(
        updateRequest(ownerToken, project.id, 1, [
          { entry: householdEntry(randomUUID()), kind: "entry.add" },
        ]),
      ),
    ]);
    expect(concurrent.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    const conflict = concurrent.find(({ statusCode }) => statusCode === 409);
    expect(conflict?.json<{ readonly code: string }>()).toMatchObject({
      code: "BRIEF_REVISION_CONFLICT",
    });
    const accepted = await server.inject({
      headers: authorization(editorToken),
      method: "POST",
      payload: { expectedRevision: 2, idempotencyKey: randomUUID() },
      url: `/v1/projects/${project.id}/design-brief/accept`,
    });
    expect(accepted.json()).toMatchObject({ revision: 3, status: "accepted" });
    const reopened = await server.inject(
      updateRequest(ownerToken, project.id, 3, [
        { entry: householdEntry(randomUUID()), kind: "entry.add" },
      ]),
    );
    expect(reopened.json()).toMatchObject({ revision: 4, status: "draft" });

    const viewerAcceptance = await server.inject({
      headers: authorization(viewerToken),
      method: "POST",
      payload: { expectedRevision: 4, idempotencyKey: randomUUID() },
      url: `/v1/projects/${project.id}/design-brief/accept`,
    });
    const foreignRead = await server.inject({
      headers: authorization(foreignToken),
      method: "GET",
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(viewerAcceptance.statusCode).toBe(403);
    expect(foreignRead.statusCode).toBe(404);
    expect(
      (await repository.listHistory(project.tenantId, project.id)).map(({ reason }) => reason),
    ).toEqual(["created", "updated", "accepted", "reopened"]);
    expect(await repository.listAcceptances(project.tenantId, project.id)).toHaveLength(1);
    const audit = await repository.listAudit(project.tenantId, project.id);
    expect(audit).toHaveLength(4);
    expect(JSON.stringify(audit)).not.toMatch(/synthetic household|statement|message|operations/iu);

    await expect(
      administration`
        UPDATE design_brief_revisions SET content_sha256 = ${"f".repeat(64)}
        WHERE project_id = ${project.id}::uuid AND revision = 1
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        DELETE FROM design_brief_acceptance_events WHERE project_id = ${project.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
  });

  it("rejects direct assistant provenance and accepts an actor-attributed correction", async () => {
    const { repository, server } = liveServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const project = await createProject(server, ownerToken);
    const foreignProject = await createProject(server, ownerToken);
    const withdrawnProject = await createProject(server, ownerToken);
    const created = await server.inject(
      updateRequest(ownerToken, project.id, 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    const foreignCreated = await server.inject(
      updateRequest(ownerToken, foreignProject.id, 0, [
        { entry: householdEntry(randomUUID()), kind: "entry.add" },
      ]),
    );
    await server.inject(
      updateRequest(ownerToken, withdrawnProject.id, 0, [
        {
          entry: { ...householdEntry(randomUUID()), status: "withdrawn" },
          kind: "entry.add",
        },
      ]),
    );
    const rejectedAcceptance = await server.inject({
      headers: authorization(ownerToken),
      method: "POST",
      payload: { expectedRevision: 1, idempotencyKey: randomUUID() },
      url: `/v1/projects/${withdrawnProject.id}/design-brief/accept`,
    });
    expect(rejectedAcceptance.statusCode).toBe(422);
    expect(rejectedAcceptance.json()).toMatchObject({ code: "BRIEF_ACCEPTANCE_EMPTY" });
    const brief = created.json<{ readonly id: string }>();
    const foreignBrief = foreignCreated.json<{ readonly id: string }>();
    const messageAt = new Date(new Date(c11Now).getTime() + 2);
    const sessionAt = new Date(messageAt.getTime() - 1);
    const sessionId = randomUUID();
    const foreignSessionId = randomUUID();
    const messageId = randomUUID();
    const foreignMessageId = randomUUID();
    const message = "Synthetic immutable consultation correction.";
    const messageSha256 = createHash("sha256").update(message).digest("hex");
    await administration`
      INSERT INTO consultation_sessions (
        tenant_id, project_id, id, schema_version, base_brief_id, base_brief_revision,
        provider_mode, state, turn_count, created_by, created_at, updated_at
      ) VALUES
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${sessionId}::uuid,
        'c11-consultation-session-v1', ${brief.id}::uuid, 1,
        'deterministic-local', 'active', 1, ${owner.userId}::uuid, ${sessionAt}, ${messageAt}
      ),
      (
        ${foreignProject.tenantId}::uuid, ${foreignProject.id}::uuid,
        ${foreignSessionId}::uuid, 'c11-consultation-session-v1',
        ${foreignBrief.id}::uuid, 1, 'deterministic-local', 'active', 1,
        ${owner.userId}::uuid, ${sessionAt}, ${messageAt}
      )
    `;
    await administration`
      INSERT INTO consultation_messages (
        tenant_id, project_id, session_id, id, ordinal, role, client_message_id,
        content, content_sha256, created_by, created_at
      ) VALUES
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${sessionId}::uuid,
        ${messageId}::uuid, 1, 'user', ${randomUUID()}::uuid, ${message},
        ${messageSha256}, ${owner.userId}::uuid, ${messageAt}
      ),
      (
        ${foreignProject.tenantId}::uuid, ${foreignProject.id}::uuid,
        ${foreignSessionId}::uuid, ${foreignMessageId}::uuid, 1, 'user',
        ${randomUUID()}::uuid, ${message}, ${messageSha256}, ${owner.userId}::uuid,
        ${messageAt}
      )
    `;
    const assistantEntry = (sourceMessageId: string, capturedAt = messageAt.toISOString()) => ({
      category: "style-aesthetic" as const,
      classification: "preference" as const,
      id: randomUUID(),
      priority: 3,
      provenance: {
        capturedAt,
        method: "assistant-extracted" as const,
        sourceMessageId,
      },
      roomOrLevelElementIds: [],
      statement: "The synthetic correction retains a restrained colour preference.",
      status: "active" as const,
    });
    const forged = await server.inject(
      updateRequest(ownerToken, project.id, 1, [
        {
          entry: {
            ...householdEntry(randomUUID()),
            provenance: {
              ...householdEntry().provenance,
              statedByUserId: randomUUID(),
            },
          },
          kind: "entry.add",
        },
      ]),
    );
    const missing = await server.inject(
      updateRequest(ownerToken, project.id, 1, [
        { entry: assistantEntry(randomUUID()), kind: "entry.add" },
      ]),
    );
    const foreign = await server.inject(
      updateRequest(ownerToken, project.id, 1, [
        { entry: assistantEntry(foreignMessageId), kind: "entry.add" },
      ]),
    );
    expect(forged.json()).toMatchObject({ code: "BRIEF_USER_PROVENANCE_FORGED" });
    expect(missing.json()).toMatchObject({
      code: "BRIEF_ASSISTANT_PROVENANCE_REQUIRES_PROPOSAL",
    });
    expect(foreign.json()).toMatchObject({
      code: "BRIEF_ASSISTANT_PROVENANCE_REQUIRES_PROPOSAL",
    });
    expect([forged.statusCode, missing.statusCode, foreign.statusCode]).toEqual([409, 409, 409]);
    expect(await repository.listHistory(project.tenantId, project.id)).toHaveLength(1);

    const corrected = await server.inject(
      updateRequest(ownerToken, project.id, 1, [
        { entry: householdEntry(randomUUID()), kind: "entry.add" },
      ]),
    );
    expect(corrected.statusCode).toBe(200);
    const correctedBody = corrected.json<{
      readonly entries: ReadonlyArray<{
        readonly provenance: { readonly method: string; readonly statedByUserId?: string };
      }>;
      readonly revision: number;
    }>();
    expect(correctedBody.revision).toBe(2);
    expect(
      correctedBody.entries.some(
        ({ provenance }) =>
          provenance.method === "user-stated" && provenance.statedByUserId === owner.userId,
      ),
    ).toBe(true);
  });

  it("atomically confirms one immutable proposal with rollback, concurrency and replay", async () => {
    const { server, service, setNow } = liveServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const project = await createProject(server, ownerToken);
    const created = await server.inject(
      updateRequest(ownerToken, project.id, 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    const brief = created.json<{ readonly id: string }>();

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const siblingProposalId = randomUUID();
    const createdAt = new Date(new Date(c11Now).getTime() + 1);
    const messageAt = new Date(createdAt.getTime() + 1);
    const proposalAt = new Date(createdAt.getTime() + 2);
    const firstConfirmedAt = new Date(createdAt.getTime() + 3);
    const secondConfirmedAt = new Date(createdAt.getTime() + 4);
    setNow(proposalAt.toISOString());
    const message = "Synthetic consultation message with no customer data.";
    const messageSha256 = createHash("sha256").update(message).digest("hex");
    const proposalEntry = {
      category: "style-aesthetic" as const,
      classification: "preference" as const,
      id: secondEntryId,
      priority: 3,
      provenance: {
        capturedAt: messageAt.toISOString(),
        method: "assistant-extracted" as const,
        sourceMessageId: messageId,
      },
      roomOrLevelElementIds: [],
      statement: "The synthetic proposal extracts a restrained colour preference.",
      status: "active" as const,
    };
    const proposal = briefPatchProposalSchema.parse({
      baseBriefId: brief.id,
      baseBriefRevision: 1,
      clarifyingQuestions: [],
      createdAt: proposalAt.toISOString(),
      expiresAt: new Date(proposalAt.getTime() + 1_800_000).toISOString(),
      id: proposalId,
      operations: [
        {
          entry: proposalEntry,
          kind: "entry.add",
        },
      ],
      professionalReview: [],
      projectId: project.id,
      providerManifest: {
        adapter: "deterministic-local-v1",
        externalNetworkUsed: false,
        promptRegistryVersion: "c11-prompt-v1",
        toolRegistryVersion: "c11-tools-v1",
      },
      schemaVersion: "c11-brief-patch-proposal-v1",
      sessionId,
      sourceMessageId: messageId,
      status: "pending",
      summary: "Add one synthetic attributable household requirement.",
    });
    const siblingProposal = briefPatchProposalSchema.parse({
      ...proposal,
      id: siblingProposalId,
      summary: "Superseded synthetic alternative for terminal cleanup.",
    });
    const proposalSha256 = requestHash(proposal);
    const siblingProposalSha256 = requestHash(siblingProposal);
    const proposalJson = JSON.parse(JSON.stringify(proposal)) as JSONValue;
    const siblingProposalJson = JSON.parse(JSON.stringify(siblingProposal)) as JSONValue;

    await administration`
      INSERT INTO consultation_sessions (
        tenant_id, project_id, id, schema_version, base_brief_id, base_brief_revision,
        provider_mode, state, turn_count, created_by, created_at, updated_at
      ) VALUES (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${sessionId}::uuid,
        'c11-consultation-session-v1', ${brief.id}::uuid, 1,
        'deterministic-local', 'active', 0, ${"20000000-0000-4000-8000-000000000001"}::uuid,
        ${createdAt}, ${createdAt}
      )
    `;
    await administration`
      INSERT INTO consultation_messages (
        tenant_id, project_id, session_id, id, ordinal, role, client_message_id,
        content, content_sha256, created_by, created_at
      ) VALUES (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${sessionId}::uuid,
        ${messageId}::uuid, 1, 'user', ${randomUUID()}::uuid, ${message},
        ${messageSha256}, ${"20000000-0000-4000-8000-000000000001"}::uuid, ${messageAt}
      )
    `;
    await administration`
      UPDATE consultation_sessions
      SET turn_count = 1, updated_at = ${messageAt}
      WHERE tenant_id = ${project.tenantId}::uuid AND project_id = ${project.id}::uuid
        AND id = ${sessionId}::uuid
    `;
    await administration`
      INSERT INTO consultation_patch_proposals (
        tenant_id, project_id, session_id, id, schema_version, base_brief_id,
        base_brief_revision, source_message_id, proposal_payload, proposal_sha256,
        created_at, expires_at
      ) VALUES
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${sessionId}::uuid,
        ${proposalId}::uuid, 'c11-brief-patch-proposal-v1', ${brief.id}::uuid, 1,
        ${messageId}::uuid, ${administration.json(proposalJson)}, ${proposalSha256},
        ${proposalAt}, ${new Date(proposal.expiresAt)}
      ),
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${sessionId}::uuid,
        ${siblingProposalId}::uuid, 'c11-brief-patch-proposal-v1', ${brief.id}::uuid, 1,
        ${messageId}::uuid, ${administration.json(siblingProposalJson)},
        ${siblingProposalSha256}, ${proposalAt}, ${new Date(siblingProposal.expiresAt)}
      )
    `;
    await administration`
      INSERT INTO consultation_proposal_state_events (
        tenant_id, project_id, proposal_id, ordinal, status, occurred_at
      ) VALUES
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${proposalId}::uuid,
        1, 'pending', ${proposalAt}
      ),
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${siblingProposalId}::uuid,
        1, 'pending', ${proposalAt}
      )
    `;
    await administration`
      INSERT INTO consultation_proposal_heads (
        tenant_id, project_id, proposal_id, current_ordinal, current_status, updated_at
      ) VALUES
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${proposalId}::uuid,
        1, 'pending', ${proposalAt}
      ),
      (
        ${project.tenantId}::uuid, ${project.id}::uuid, ${siblingProposalId}::uuid,
        1, 'pending', ${proposalAt}
      )
    `;
    const idempotencyKey = randomUUID();
    const commandAt = (confirmedAt: Date) => ({
      actor: owner,
      confirmation: {
        actorUserId: owner.userId,
        briefId: brief.id,
        briefRevision: 2,
        confirmedAt: confirmedAt.toISOString(),
        idempotencyKey,
        projectId: project.id,
        proposalId,
        sessionId,
      },
      correlation,
      expectedProposalStatus: "pending" as const,
      expectedSessionState: "active" as const,
      expectedTurnCount: 1,
      projectId: project.id,
      proposal,
      update: {
        expectedRevision: 1,
        idempotencyKey,
        operations: proposal.operations,
      },
    });

    await expect(
      administration`
        UPDATE consultation_sessions
        SET state = 'completed', updated_at = ${firstConfirmedAt}
        WHERE tenant_id = ${project.tenantId}::uuid AND project_id = ${project.id}::uuid
          AND id = ${sessionId}::uuid
      `,
    ).rejects.toThrow(/terminal consultation sessions cannot retain pending proposals/u);

    await expect(
      service.confirmProposal(commandAt(new Date(proposalAt.getTime() + 1_001))),
    ).rejects.toMatchObject({
      code: "CONSULTATION_CONFIRMATION_TIME_CONFLICT",
      statusCode: 409,
    });

    await administration`
      CREATE OR REPLACE FUNCTION c11_test_reject_confirmation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic confirmation write failure';
      END;
      $$
    `;
    await administration`
      CREATE TRIGGER c11_test_reject_confirmation_write
      BEFORE INSERT ON consultation_proposal_confirmations
      FOR EACH ROW EXECUTE FUNCTION c11_test_reject_confirmation()
    `;
    try {
      await expect(service.confirmProposal(commandAt(firstConfirmedAt))).rejects.toThrow(
        /synthetic confirmation write failure/u,
      );
    } finally {
      await administration`
        DROP TRIGGER c11_test_reject_confirmation_write
        ON consultation_proposal_confirmations
      `;
      await administration`DROP FUNCTION c11_test_reject_confirmation()`;
    }
    const rolledBack = await administration<
      Array<{
        readonly confirmations: number;
        readonly effects: number;
        readonly proposal_status: string;
        readonly proposal_states: number;
        readonly revisions: number;
        readonly sibling_status: string;
        readonly session_state: string;
      }>
    >`
      SELECT
        (SELECT count(*)::integer FROM design_brief_revisions
          WHERE project_id = ${project.id}::uuid) AS revisions,
        (SELECT count(*)::integer FROM design_brief_idempotency_effects
          WHERE project_id = ${project.id}::uuid) AS effects,
        (SELECT count(*)::integer FROM consultation_proposal_state_events
          WHERE project_id = ${project.id}::uuid) AS proposal_states,
        (SELECT count(*)::integer FROM consultation_proposal_confirmations
          WHERE project_id = ${project.id}::uuid) AS confirmations,
        (SELECT current_status FROM consultation_proposal_heads
          WHERE project_id = ${project.id}::uuid AND proposal_id = ${proposalId}::uuid)
          AS proposal_status,
        (SELECT current_status FROM consultation_proposal_heads
          WHERE project_id = ${project.id}::uuid
            AND proposal_id = ${siblingProposalId}::uuid) AS sibling_status,
        (SELECT state FROM consultation_sessions
          WHERE project_id = ${project.id}::uuid AND id = ${sessionId}::uuid) AS session_state
    `;
    expect(rolledBack[0]).toEqual({
      confirmations: 0,
      effects: 1,
      proposal_status: "pending",
      proposal_states: 2,
      revisions: 1,
      sibling_status: "pending",
      session_state: "active",
    });

    const concurrent = await Promise.all([
      service.confirmProposal(commandAt(firstConfirmedAt)),
      service.confirmProposal(commandAt(secondConfirmedAt)),
    ]);
    const [{ replayed: leftReplay, ...left }, { replayed: rightReplay, ...right }] = concurrent;
    expect([leftReplay, rightReplay].sort()).toEqual([false, true]);
    expect(right).toEqual(left);
    expect(left).toMatchObject({
      brief: { id: brief.id, revision: 2, status: "draft" },
      proposal: { id: proposalId, status: "confirmed" },
      session: { id: sessionId, state: "completed", turnCount: 1 },
    });

    const changedEntry = {
      ...proposalEntry,
      id: randomUUID(),
    };
    await expect(
      service.confirmProposal({
        ...commandAt(secondConfirmedAt),
        proposal: {
          ...proposal,
          operations: [{ entry: changedEntry, kind: "entry.add" as const }],
        },
        update: {
          expectedRevision: 1,
          idempotencyKey,
          operations: [{ entry: changedEntry, kind: "entry.add" as const }],
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });

    const differentKey = randomUUID();
    await expect(
      service.confirmProposal({
        ...commandAt(secondConfirmedAt),
        confirmation: {
          ...commandAt(secondConfirmedAt).confirmation,
          idempotencyKey: differentKey,
        },
        update: {
          ...commandAt(secondConfirmedAt).update,
          idempotencyKey: differentKey,
        },
      }),
    ).rejects.toMatchObject({ code: "CONSULTATION_SESSION_STATE_CONFLICT", statusCode: 409 });

    const counts = await administration<
      Array<{
        readonly confirmations: number;
        readonly effects: number;
        readonly messages: number;
        readonly proposal_states: number;
        readonly proposals: number;
        readonly revisions: number;
        readonly selected_status: string;
        readonly sibling_status: string;
      }>
    >`
      SELECT
        (SELECT count(*)::integer FROM consultation_messages
          WHERE project_id = ${project.id}::uuid) AS messages,
        (SELECT count(*)::integer FROM consultation_patch_proposals
          WHERE project_id = ${project.id}::uuid) AS proposals,
        (SELECT count(*)::integer FROM consultation_proposal_state_events
          WHERE project_id = ${project.id}::uuid) AS proposal_states,
        (SELECT count(*)::integer FROM consultation_proposal_confirmations
          WHERE project_id = ${project.id}::uuid) AS confirmations,
        (SELECT count(*)::integer FROM design_brief_idempotency_effects
          WHERE project_id = ${project.id}::uuid) AS effects,
        (SELECT count(*)::integer FROM design_brief_revisions
          WHERE project_id = ${project.id}::uuid) AS revisions,
        (SELECT current_status FROM consultation_proposal_heads
          WHERE project_id = ${project.id}::uuid AND proposal_id = ${proposalId}::uuid)
          AS selected_status,
        (SELECT current_status FROM consultation_proposal_heads
          WHERE project_id = ${project.id}::uuid
            AND proposal_id = ${siblingProposalId}::uuid) AS sibling_status
    `;
    expect(counts[0]).toEqual({
      confirmations: 1,
      effects: 2,
      messages: 1,
      proposal_states: 4,
      proposals: 2,
      revisions: 2,
      selected_status: "confirmed",
      sibling_status: "rejected",
    });
    await expect(
      administration`
        UPDATE consultation_messages SET content = 'rewritten'
        WHERE project_id = ${project.id}::uuid AND id = ${messageId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        UPDATE consultation_patch_proposals SET proposal_sha256 = ${"e".repeat(64)}
        WHERE project_id = ${project.id}::uuid AND id = ${proposalId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        UPDATE consultation_proposal_heads
        SET current_ordinal = 3, current_status = 'rejected',
          updated_at = ${new Date(secondConfirmedAt.getTime() + 2)}
        WHERE project_id = ${project.id}::uuid AND proposal_id = ${proposalId}::uuid
      `,
    ).rejects.toThrow(/terminal consultation proposals are immutable/u);
  });
});
