import { loadPlatformApiConfig } from "@interior-design/config";
import type {
  BriefPatchProposal,
  ConsultationSession,
  DesignBrief,
  LocalPersona,
  Project,
  ProjectIntake,
  Session,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC10Migration } from "../../src/c10.js";
import { applyC11Migration } from "../../src/c11.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { applyC7Migration } from "../../src/c7.js";
import { applyC8Migration } from "../../src/c8.js";
import { applyC9Migration } from "../../src/c9.js";
import { createServer, defaultLogger } from "../../src/app.js";

const databaseUrl = process.env.C11_PRODUCTION_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const sessionSecret = "c11-production-integration-secret-at-least-thirty-two-bytes";
const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "info",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function signIn(
  server: ReturnType<typeof createServer>,
  persona: LocalPersona,
): Promise<string> {
  const response = await server.inject({
    method: "POST",
    payload: { persona },
    url: "/v1/auth/local/session",
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ readonly accessToken: string }>().accessToken;
}

async function createProject(
  server: ReturnType<typeof createServer>,
  accessToken: string,
): Promise<Project> {
  const response = await server.inject({
    headers: { ...bearer(accessToken), "idempotency-key": `c11-project-${randomUUID()}` },
    method: "POST",
    payload: { name: `Production-composed C11 ${randomUUID()}` },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

async function mutationBaseline(sql: Sql) {
  const rows = await sql<
    Array<{
      readonly commit_count: string;
      readonly snapshot_count: string;
      readonly snapshot_hashes: string;
    }>
  >`
    SELECT
      (SELECT count(*)::text FROM canonical_model_snapshots) AS snapshot_count,
      (SELECT coalesce(string_agg(snapshot_sha256, ',' ORDER BY snapshot_sha256), '')
         FROM canonical_model_snapshots) AS snapshot_hashes,
      (SELECT count(*)::text FROM model_operation_commits) AS commit_count
  `;
  return rows[0];
}

describeWithPostgres("C11 production-composed consultation", () => {
  let administration: Sql;
  let server: ReturnType<typeof createServer>;
  const logLines: string[] = [];

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

    const loggerOptions = defaultLogger(config);
    if (loggerOptions === false || loggerOptions === true) {
      throw new Error("Expected structured platform logger options.");
    }
    server = createServer({
      c1: { closeDatabase: true, database: createC1Sql(databaseUrl) },
      c11: { closeDatabase: true, database: createC1Sql(databaseUrl) },
      config,
      environment: { C1_LOCAL_SESSION_SECRET: sessionSecret, NODE_ENV: "test" },
      logger: {
        ...loggerOptions,
        stream: {
          write(line: string) {
            logLines.push(line);
          },
        },
      },
    });
  });

  afterAll(async () => {
    await server.close();
    await administration.end({ timeout: 5 });
  });

  it("runs intake, local consultation, correction, cancellation and acceptance without canonical mutation", async () => {
    const ownerToken = await signIn(server, "homeowner-alpha");
    const editorToken = await signIn(server, "editor-alpha");
    const viewerToken = await signIn(server, "viewer-alpha");
    const foreignToken = await signIn(server, "homeowner-beta");
    const project = await createProject(server, ownerToken);
    const editorSessionResponse = await server.inject({
      headers: bearer(editorToken),
      method: "GET",
      url: "/v1/session",
    });
    expect(editorSessionResponse.statusCode).toBe(200);
    const editorUserId = editorSessionResponse.json<Session>().actor.userId;
    const baseline = await mutationBaseline(administration);

    const intakeResponse = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": randomUUID() },
      method: "PUT",
      payload: {
        expectedVersion: 0,
        intake: {
          accessibilityNeeds: ["C11_PRIVATE_ACCESSIBILITY_MARKER"],
          addressSummary: "C11_PRIVATE_ADDRESS_MARKER",
          dwellingType: "terraced-house",
          evidenceAvailable: {
            photographs: true,
            plans: false,
            roomCapture: false,
            video: false,
          },
          goals: ["Create a coherent whole-home direction"],
          household: { adults: 2, children: 0, pets: 1 },
          mustChange: ["Dark hallway"],
          mustKeep: ["Existing dining table"],
          notes: "Synthetic integration fixture only.",
          styleWords: ["warm", "calm"],
        },
      },
      url: `/v1/projects/${project.id}/intake`,
    });
    expect(intakeResponse.statusCode).toBe(200);
    const intake = intakeResponse.json<ProjectIntake>();

    const initialKey = randomUUID();
    const initialRequest = {
      expectedRevision: 0,
      idempotencyKey: initialKey,
      operations: [
        {
          entry: {
            category: "style-aesthetic",
            classification: "preference",
            id: randomUUID(),
            priority: 3,
            provenance: {
              capturedAt: intake.updatedAt,
              method: "user-stated",
              statedByUserId: intake.updatedBy,
            },
            roomOrLevelElementIds: [],
            statement: "Warm and calm materials",
            status: "active",
          },
          kind: "entry.add",
        },
      ],
    };
    const initial = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": initialKey },
      method: "PUT",
      payload: initialRequest,
      url: `/v1/projects/${project.id}/design-brief`,
    });
    const initialReplay = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": initialKey },
      method: "PUT",
      payload: initialRequest,
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(initial.statusCode).toBe(200);
    expect(initialReplay.statusCode).toBe(200);
    expect(initialReplay.headers["idempotent-replay"]).toBe("true");
    expect(initialReplay.json()).toEqual(initial.json());
    let brief = initial.json<DesignBrief>();

    const firstSessionKey = randomUUID();
    const firstSessionResponse = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": firstSessionKey },
      method: "POST",
      payload: {
        baseBriefId: brief.id,
        baseBriefRevision: brief.revision,
        idempotencyKey: firstSessionKey,
        providerMode: "deterministic-local",
      },
      url: `/v1/projects/${project.id}/design-consultations`,
    });
    expect(firstSessionResponse.statusCode).toBe(201);
    const firstSession = firstSessionResponse.json<ConsultationSession>();
    const firstMessageId = randomUUID();
    const firstTurn = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": firstMessageId },
      method: "POST",
      payload: {
        clientMessageId: firstMessageId,
        expectedBriefRevision: brief.revision,
        message: "We prefer warm oak.",
      },
      url: `/v1/projects/${project.id}/design-consultations/${firstSession.id}/turns`,
    });
    expect(firstTurn.statusCode).toBe(201);
    const firstProposal = firstTurn.json<BriefPatchProposal>();
    expect(firstProposal.operations.length).toBeGreaterThan(0);
    const confirmationKey = randomUUID();
    const confirmationRequest = {
      expectedBriefRevision: brief.revision,
      idempotencyKey: confirmationKey,
    };
    const confirmationUrl = `/v1/projects/${project.id}/design-consultations/${firstSession.id}/proposals/${firstProposal.id}/confirm`;
    const confirmed = await server.inject({
      headers: { ...bearer(editorToken), "idempotency-key": confirmationKey },
      method: "POST",
      payload: confirmationRequest,
      url: confirmationUrl,
    });
    const confirmedReplay = await server.inject({
      headers: { ...bearer(editorToken), "idempotency-key": confirmationKey },
      method: "POST",
      payload: confirmationRequest,
      url: confirmationUrl,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmedReplay.statusCode).toBe(200);
    expect(confirmedReplay.headers["idempotent-replay"]).toBe("true");
    brief = confirmed.json<DesignBrief>();
    expect(brief.revision).toBe(2);
    expect(
      brief.entries.some(({ provenance }) => provenance.method === "assistant-extracted"),
    ).toBe(true);

    const secondSessionKey = randomUUID();
    const secondSessionResponse = await server.inject({
      headers: { ...bearer(editorToken), "idempotency-key": secondSessionKey },
      method: "POST",
      payload: {
        baseBriefId: brief.id,
        baseBriefRevision: brief.revision,
        idempotencyKey: secondSessionKey,
        providerMode: "deterministic-local",
      },
      url: `/v1/projects/${project.id}/design-consultations`,
    });
    expect(secondSessionResponse.statusCode).toBe(201);
    const secondSession = secondSessionResponse.json<ConsultationSession>();
    const secondMessageId = randomUUID();
    const secondTurn = await server.inject({
      headers: { ...bearer(editorToken), "idempotency-key": secondMessageId },
      method: "POST",
      payload: {
        clientMessageId: secondMessageId,
        expectedBriefRevision: brief.revision,
        message: "We prefer muted green as well.",
      },
      url: `/v1/projects/${project.id}/design-consultations/${secondSession.id}/turns`,
    });
    expect(secondTurn.statusCode).toBe(201);
    const secondProposal = secondTurn.json<BriefPatchProposal>();
    const correctionKey = randomUUID();
    const corrected = await server.inject({
      headers: { ...bearer(editorToken), "idempotency-key": correctionKey },
      method: "PUT",
      payload: {
        expectedRevision: brief.revision,
        idempotencyKey: correctionKey,
        operations: [
          {
            entry: {
              category: "material-colour",
              classification: "preference",
              id: randomUUID(),
              priority: 3,
              provenance: {
                capturedAt: new Date().toISOString(),
                method: "user-stated",
                statedByUserId: editorUserId,
              },
              roomOrLevelElementIds: [],
              statement: "Muted green, subject to a physical sample review",
              status: "active",
            },
            kind: "entry.add",
          },
        ],
      },
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(corrected.statusCode).toBe(200);
    brief = corrected.json<DesignBrief>();
    expect(brief.revision).toBe(3);
    const cancelKey = randomUUID();
    const cancelled = await server.inject({
      headers: { ...bearer(editorToken), "idempotency-key": cancelKey },
      method: "POST",
      payload: {},
      url: `/v1/projects/${project.id}/design-consultations/${secondSession.id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<ConsultationSession>().state).toBe("cancelled");
    const rejectedProposal = await server.inject({
      headers: bearer(editorToken),
      method: "GET",
      url: `/v1/projects/${project.id}/design-consultations/${secondSession.id}/proposals/${secondProposal.id}`,
    });
    expect(rejectedProposal.statusCode).toBe(200);
    expect(rejectedProposal.json<BriefPatchProposal>().status).toBe("rejected");

    const viewerRead = await server.inject({
      headers: bearer(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(viewerRead.statusCode).toBe(200);
    const viewerSessionKey = randomUUID();
    const viewerSession = await server.inject({
      headers: { ...bearer(viewerToken), "idempotency-key": viewerSessionKey },
      method: "POST",
      payload: {
        baseBriefId: brief.id,
        baseBriefRevision: brief.revision,
        idempotencyKey: viewerSessionKey,
        providerMode: "deterministic-local",
      },
      url: `/v1/projects/${project.id}/design-consultations`,
    });
    expect(viewerSession.statusCode).toBe(403);
    const foreignRead = await server.inject({
      headers: bearer(foreignToken),
      method: "GET",
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(foreignRead.statusCode).toBe(404);

    const acceptKey = randomUUID();
    const accepted = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": acceptKey },
      method: "POST",
      payload: { expectedRevision: brief.revision, idempotencyKey: acceptKey },
      url: `/v1/projects/${project.id}/design-brief/accept`,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<DesignBrief>()).toMatchObject({ revision: 4, status: "accepted" });

    expect(await mutationBaseline(administration)).toEqual(baseline);
    const logs = logLines.join("\n");
    for (const privateValue of [
      ownerToken,
      editorToken,
      "C11_PRIVATE_ACCESSIBILITY_MARKER",
      "C11_PRIVATE_ADDRESS_MARKER",
      "We prefer warm oak.",
      "We prefer muted green as well.",
    ]) {
      expect(logs).not.toContain(privateValue);
    }
    expect(logs).toContain("[REDACTED]");
  });
});
