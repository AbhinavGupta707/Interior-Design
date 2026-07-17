import { loadPlatformApiConfig } from "@interior-design/config";
import {
  type LocalPersona,
  type Project,
  type ProjectProperty,
  type PropertyDossier,
  type PropertyResolutionResponse,
} from "@interior-design/contracts";
import {
  DisabledPropertyAdapter,
  FixturePropertyAdapter,
  type PropertyAdapter,
} from "@interior-design/provider-adapters/property";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createServer } from "../../src/app.js";
import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";

const integrationDatabaseUrl = process.env.C3_TEST_DATABASE_URL ?? "";
const describeWithPostgres = integrationDatabaseUrl === "" ? describe.skip : describe;
const alphaTenantId = "10000000-0000-4000-8000-000000000001";
const sessionSecret = "c3-postgres-session-secret-with-at-least-thirty-two-bytes";
const activeServers = new Set<ReturnType<typeof createServer>>();

const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

const sampleIntake = {
  accessibilityNeeds: [],
  bathrooms: 1,
  bedrooms: 2,
  dwellingType: "terraced-house" as const,
  evidenceAvailable: {
    photographs: true,
    plans: false,
    roomCapture: false,
    video: false,
  },
  goals: ["Create a coherent synthetic whole-home direction"],
  household: { adults: 2, children: 0, pets: 0 },
  levels: 2,
  mustChange: ["Synthetic dark hallway"],
  mustKeep: [],
  styleWords: ["warm", "calm"],
};

function postgresServer(
  options: {
    readonly adapter?: PropertyAdapter;
    readonly clock?: () => Date;
  } = {},
) {
  const c1Database = createC1Sql(integrationDatabaseUrl);
  const c3Database = createC1Sql(integrationDatabaseUrl);
  const clock = options.clock ?? (() => new Date("2026-07-17T12:00:00.000Z"));
  const server = createServer({
    c1: { closeDatabase: true, database: c1Database },
    c3: {
      adapter: options.adapter ?? new FixturePropertyAdapter({ clock }),
      clock,
      closeDatabase: true,
      database: c3Database,
    },
    config: testConfig,
    environment: {
      C1_LOCAL_SESSION_SECRET: sessionSecret,
      NODE_ENV: "test",
    },
    logger: false,
  });
  activeServers.add(server);
  return server;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await server.close();
  activeServers.delete(server);
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
  return response.json<{ accessToken: string }>().accessToken;
}

function authorization(token: string): { readonly authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function createProject(
  server: ReturnType<typeof createServer>,
  token: string,
  name: string,
): Promise<Project> {
  const response = await server.inject({
    headers: {
      ...authorization(token),
      "idempotency-key": `project-${name.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}`,
    },
    method: "POST",
    payload: { name },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

async function resolve(
  server: ReturnType<typeof createServer>,
  token: string,
  projectId: string,
  query: string,
  key: string,
): Promise<PropertyResolutionResponse> {
  const response = await server.inject({
    headers: { ...authorization(token), "idempotency-key": key },
    method: "POST",
    payload: { countryCode: "GB", query },
    url: `/v1/projects/${projectId}/property/resolutions`,
  });
  expect(response.statusCode).toBe(201);
  return response.json<PropertyResolutionResponse>();
}

describeWithPostgres("C3 real Postgres integration", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(integrationDatabaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await applyC2Migration(administration);
    await applyC3Migration(administration);
  });

  afterAll(async () => {
    await administration.end({ timeout: 5 });
  });

  afterEach(async () => {
    await Promise.all([...activeServers].map(async (server) => closeServer(server)));
  });

  it("persists exact, ambiguous, no-match, disabled, outage, and manual states without disclosure", async () => {
    const server = postgresServer();
    const alphaToken = await signIn(server, "homeowner-alpha");
    const betaToken = await signIn(server, "homeowner-beta");
    const viewerToken = await signIn(server, "viewer-alpha");
    const project = await createProject(server, alphaToken, `C3 states ${randomUUID()}`);

    const unselectedSources = await server.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${project.id}/property/source-records`,
    });
    expect(unselectedSources.statusCode).toBe(200);
    expect(unselectedSources.json()).toEqual({ sources: [] });

    const exactRequest = {
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-exact-replay-001" },
      method: "POST" as const,
      payload: { countryCode: "GB", query: "14   EXAMPLE MEWS" },
      url: `/v1/projects/${project.id}/property/resolutions`,
    };
    const [exactLeft, exactRight] = await Promise.all([
      server.inject(exactRequest),
      server.inject(exactRequest),
    ]);
    expect(exactLeft.statusCode).toBe(201);
    expect(exactRight.json()).toEqual(exactLeft.json());
    const exact = exactLeft.json<PropertyResolutionResponse>();
    expect(exact).toMatchObject({ providerState: "fixture", status: "matched" });
    expect(exact.candidates[0]?.identifiers).toEqual([{ scheme: "UPRN", value: "000000000014" }]);

    const ambiguous = await resolve(
      server,
      alphaToken,
      project.id,
      "20 Shared Point Court",
      "pg-ambiguous-0001",
    );
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.candidates).toHaveLength(2);
    expect(ambiguous.candidates[0]?.location).toEqual(ambiguous.candidates[1]?.location);
    expect(
      new Set(
        ambiguous.candidates.flatMap((candidate) =>
          candidate.identifiers.map(({ value }) => value),
        ),
      ),
    ).toEqual(new Set(["000000000021", "000000000022"]));

    const noMatch = await resolve(
      server,
      alphaToken,
      project.id,
      "99 Missing Fixture Road, Testford, ZZ9 9ZZ",
      "pg-no-match-00001",
    );
    expect(noMatch).toMatchObject({ candidates: [], providerState: "fixture", status: "no-match" });

    const disabledServer = postgresServer({ adapter: new DisabledPropertyAdapter() });
    const disabled = await resolve(
      disabledServer,
      alphaToken,
      project.id,
      "14 Example Mews",
      "pg-disabled-0001",
    );
    expect(disabled).toMatchObject({
      candidates: [],
      providerState: "disabled",
      status: "unavailable",
    });
    const outageServer = postgresServer({
      adapter: new FixturePropertyAdapter({ injectOutage: true }),
    });
    const outage = await resolve(
      outageServer,
      alphaToken,
      project.id,
      "14 Example Mews",
      "pg-outage-000001",
    );
    expect(outage).toMatchObject({
      candidates: [],
      providerState: "unavailable",
      status: "unavailable",
    });

    const manualProject = await createProject(server, alphaToken, `C3 manual ${randomUUID()}`);
    const manualResponse = await server.inject({
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-manual-select-1" },
      method: "PUT",
      payload: {
        address: {
          countryCode: "GB",
          line1: "8 Manual Example Row",
          locality: "Testford",
          postcode: "ZZ3 3ZZ",
        },
        expectedVersion: 0,
        jurisdiction: "england",
        mode: "manual",
      },
      url: `/v1/projects/${manualProject.id}/property`,
    });
    expect(manualResponse.statusCode).toBe(200);
    expect(manualResponse.json<ProjectProperty>()).toMatchObject({
      identifiers: [],
      mode: "manual",
      version: 1,
    });
    expect(manualResponse.json<ProjectProperty>().location).toBeUndefined();

    const foreign = await server.inject({
      headers: authorization(betaToken),
      method: "GET",
      url: `/v1/projects/${project.id}/property/dossier`,
    });
    const unknown = await server.inject({
      headers: authorization(betaToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}/property/dossier`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknown.json<{ detail: string }>().detail,
    });
    const viewerDenied = await server.inject({
      headers: { ...authorization(viewerToken), "idempotency-key": "viewer-resolve-01" },
      method: "POST",
      payload: { countryCode: "GB", query: "14 Example Mews" },
      url: `/v1/projects/${project.id}/property/resolutions`,
    });
    expect(viewerDenied.statusCode).toBe(403);

    const resolutionCount = await administration<{ readonly count: number }[]>`
      SELECT count(*)::integer AS count
      FROM property_resolution_snapshots
      WHERE tenant_id = ${alphaTenantId}::uuid
        AND project_id = ${project.id}::uuid
        AND id = ${exact.resolutionId}::uuid
    `;
    expect(resolutionCount[0]?.count).toBe(1);
  });

  it("enforces expiry, replay safety, stale/concurrent writes, immutable history, and redacted storage", async () => {
    let clockMilliseconds = new Date("2026-07-17T12:00:00.000Z").getTime();
    const clock = () => new Date(clockMilliseconds);
    const server = postgresServer({ clock });
    const alphaToken = await signIn(server, "homeowner-alpha");
    const betaToken = await signIn(server, "homeowner-beta");
    const project = await createProject(server, alphaToken, `C3 concurrency ${randomUUID()}`);
    const betaProject = await createProject(server, betaToken, `C3 beta isolation ${randomUUID()}`);
    const intakeResponse = await server.inject({
      headers: { ...authorization(alphaToken), "idempotency-key": `pg-intake-${project.id}` },
      method: "PUT",
      payload: { expectedVersion: 0, intake: sampleIntake },
      url: `/v1/projects/${project.id}/intake`,
    });
    expect(intakeResponse.statusCode).toBe(200);

    const exact = await resolve(
      server,
      alphaToken,
      project.id,
      "14 Example Mews",
      "pg-c3-select-resolution",
    );
    const exactCandidate = exact.candidates[0];
    expect(exactCandidate).toBeDefined();
    const selectionRequest = {
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-select-replay" },
      method: "PUT" as const,
      payload: {
        candidateId: exactCandidate?.candidateId,
        expectedVersion: 0,
        mode: "candidate",
        resolutionId: exact.resolutionId,
      },
      url: `/v1/projects/${project.id}/property`,
    };
    const [selectedLeft, selectedRight] = await Promise.all([
      server.inject(selectionRequest),
      server.inject(selectionRequest),
    ]);
    expect(selectedLeft.statusCode).toBe(200);
    expect(selectedRight.json()).toEqual(selectedLeft.json());
    const property = selectedLeft.json<ProjectProperty>();

    const replayedCandidate = await server.inject({
      ...selectionRequest,
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-select-again1" },
      payload: { ...selectionRequest.payload, expectedVersion: 1 },
    });
    expect(replayedCandidate.statusCode).toBe(404);
    const foreignCandidate = await server.inject({
      headers: { ...authorization(betaToken), "idempotency-key": "pg-c3-foreign-candidate" },
      method: "PUT",
      payload: { ...selectionRequest.payload, expectedVersion: 0 },
      url: `/v1/projects/${betaProject.id}/property`,
    });
    expect(foreignCandidate.statusCode).toBe(404);

    const staleSelection = await server.inject({
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-stale-select1" },
      method: "PUT",
      payload: {
        address: {
          countryCode: "GB",
          line1: "9 Stale Example Row",
          locality: "Testford",
          postcode: "ZZ4 4ZZ",
        },
        expectedVersion: 0,
        jurisdiction: "england",
        mode: "manual",
      },
      url: `/v1/projects/${project.id}/property`,
    });
    expect(staleSelection.statusCode).toBe(409);
    expect(staleSelection.json()).toMatchObject({ code: "REVISION_CONFLICT" });

    const dossierBefore = await server.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${project.id}/property/dossier`,
    });
    expect(dossierBefore.statusCode).toBe(200);
    const initialDossier = dossierBefore.json<PropertyDossier>();
    expect(initialDossier.version).toBe(1);
    expect(new Set(initialDossier.items.map((item) => item.classification))).toEqual(
      new Set(["source-observation", "user-assertion", "estimate", "inference", "unknown"]),
    );
    expect(initialDossier.items.some((item) => item.key === "intake-dwelling-type")).toBe(true);
    expect(
      initialDossier.items
        .filter((item) => item.classification === "unknown")
        .map(({ key }) => key),
    ).toEqual(["current-room-layout", "wall-thicknesses", "structural-system", "legal-boundary"]);
    expect(initialDossier.planningStatus).toBe("not-reviewed");
    expect(JSON.stringify(initialDossier)).not.toMatch(/raw|dossier_seed|source_fingerprint/iu);

    const refreshReplayRequest = {
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-refresh-replay" },
      method: "POST" as const,
      payload: { expectedVersion: 1 },
      url: `/v1/projects/${project.id}/property/dossier/refresh`,
    };
    const [refreshLeft, refreshRight] = await Promise.all([
      server.inject(refreshReplayRequest),
      server.inject(refreshReplayRequest),
    ]);
    expect(refreshLeft.statusCode).toBe(200);
    expect(refreshRight.json()).toEqual(refreshLeft.json());
    expect(refreshLeft.json<PropertyDossier>().version).toBe(2);

    const [refreshRaceLeft, refreshRaceRight] = await Promise.all([
      server.inject({
        ...refreshReplayRequest,
        headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-refresh-left01" },
        payload: { expectedVersion: 2 },
      }),
      server.inject({
        ...refreshReplayRequest,
        headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-refresh-right1" },
        payload: { expectedVersion: 2 },
      }),
    ]);
    expect([refreshRaceLeft.statusCode, refreshRaceRight.statusCode].sort()).toEqual([200, 409]);
    const refreshConflict = refreshRaceLeft.statusCode === 409 ? refreshRaceLeft : refreshRaceRight;
    expect(refreshConflict.json()).toMatchObject({ code: "REVISION_CONFLICT" });

    const raceProject = await createProject(
      server,
      alphaToken,
      `C3 selection race ${randomUUID()}`,
    );
    const raceResolution = await resolve(
      server,
      alphaToken,
      raceProject.id,
      "20 Shared Point Court",
      "pg-c3-race-resolution",
    );
    const [raceCandidateLeft, raceCandidateRight] = raceResolution.candidates;
    expect(raceCandidateLeft).toBeDefined();
    expect(raceCandidateRight).toBeDefined();
    const [selectionRaceLeft, selectionRaceRight] = await Promise.all([
      server.inject({
        headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-race-select-left" },
        method: "PUT",
        payload: {
          candidateId: raceCandidateLeft?.candidateId,
          expectedVersion: 0,
          mode: "candidate",
          resolutionId: raceResolution.resolutionId,
        },
        url: `/v1/projects/${raceProject.id}/property`,
      }),
      server.inject({
        headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-race-select-right" },
        method: "PUT",
        payload: {
          candidateId: raceCandidateRight?.candidateId,
          expectedVersion: 0,
          mode: "candidate",
          resolutionId: raceResolution.resolutionId,
        },
        url: `/v1/projects/${raceProject.id}/property`,
      }),
    ]);
    expect([selectionRaceLeft.statusCode, selectionRaceRight.statusCode].sort()).toEqual([
      200, 409,
    ]);
    const selectionConflict =
      selectionRaceLeft.statusCode === 409 ? selectionRaceLeft : selectionRaceRight;
    expect(selectionConflict.json()).toMatchObject({ code: "REVISION_CONFLICT" });
    const selectedIdentityCount = await administration<{ readonly count: number }[]>`
      SELECT count(*)::integer AS count
      FROM property_identities
      WHERE tenant_id = ${alphaTenantId}::uuid
        AND project_id = ${raceProject.id}::uuid
    `;
    expect(selectedIdentityCount[0]?.count).toBe(1);

    const expiringProject = await createProject(server, alphaToken, `C3 expiry ${randomUUID()}`);
    const expiring = await resolve(
      server,
      alphaToken,
      expiringProject.id,
      "14 Example Mews",
      "pg-c3-expiry-resolve1",
    );
    clockMilliseconds += 16 * 60 * 1000;
    const expiredSelection = await server.inject({
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-c3-expired-select" },
      method: "PUT",
      payload: {
        candidateId: expiring.candidates[0]?.candidateId,
        expectedVersion: 0,
        mode: "candidate",
        resolutionId: expiring.resolutionId,
      },
      url: `/v1/projects/${expiringProject.id}/property`,
    });
    expect(expiredSelection.statusCode).toBe(404);

    const counts = await administration<
      Array<{ dossier_versions: number; source_records: number }>
    >`
      SELECT
        (SELECT count(*)::integer
         FROM property_dossier_versions
         WHERE tenant_id = ${alphaTenantId}::uuid
           AND project_id = ${project.id}::uuid
           AND property_id = ${property.propertyId}::uuid) AS dossier_versions,
        (SELECT count(*)::integer
         FROM property_source_records
         WHERE tenant_id = ${alphaTenantId}::uuid
           AND project_id = ${project.id}::uuid
           AND property_id = ${property.propertyId}::uuid) AS source_records
    `;
    expect(counts[0]).toEqual({ dossier_versions: 3, source_records: 3 });

    await expect(
      administration`
        UPDATE property_source_records
        SET fields = ARRAY['tampered']::text[]
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND property_id = ${property.propertyId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        DELETE FROM property_dossier_versions
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND property_id = ${property.propertyId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);

    const unsafeColumns = await administration<{ readonly column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name LIKE 'property%'
        AND column_name ~ '(raw|provider_payload|query_text)'
    `;
    expect(unsafeColumns).toEqual([]);
    const audits = await administration<
      Array<{ action: string; request_id: string; trace_id: string }>
    >`
      SELECT action, request_id, trace_id
      FROM property_audit_events
      WHERE tenant_id = ${alphaTenantId}::uuid
        AND project_id = ${project.id}::uuid
      ORDER BY occurred_at ASC, id ASC
    `;
    expect(audits.map(({ action }) => action)).toEqual([
      "property.resolve",
      "property.select",
      "property.dossier.refresh",
      "property.dossier.refresh",
    ]);
    expect(JSON.stringify(audits)).not.toContain("Example Mews");
    expect(audits.every(({ trace_id }) => /^[0-9a-f]{32}$/u.test(trace_id))).toBe(true);
  });
});
