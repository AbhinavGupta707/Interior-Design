import { reduceModelOperations } from "../../../packages/model-operations/src/index.js";
import { parseGlb, sceneCompilerVersion } from "../../../packages/scene-compiler/src/index.js";
import { loadPlatformApiConfig } from "../../../packages/config/src/index.js";
import {
  canonicalHomeSnapshotSchema,
  designBriefSchema,
  listDesignOptionsResponseSchema,
  modelSnapshotRecordSchema,
  optionConfirmationSchema,
  optionJobSchema,
  sceneJobSchema,
  sceneRecordSchema,
  sessionSchema,
  type LocalPersona,
  type Project,
} from "../../../packages/contracts/src/index.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createTcpServer } from "node:net";
import path from "node:path";
import { Writable } from "node:stream";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServer, defaultLogger } from "../../../services/platform-api/src/app.js";
import {
  applyC1Migration,
  bootstrapC1Fixtures,
  createC1Sql,
} from "../../../services/platform-api/src/c1.js";
import { applyC2Migration } from "../../../services/platform-api/src/c2.js";
import { applyC3Migration } from "../../../services/platform-api/src/c3.js";
import { applyC4Migration } from "../../../services/platform-api/src/c4.js";
import { applyC5Migration } from "../../../services/platform-api/src/c5.js";
import { applyC6Migration } from "../../../services/platform-api/src/c6.js";
import { applyC7Migration } from "../../../services/platform-api/src/c7.js";
import { applyC8Migration } from "../../../services/platform-api/src/c8.js";
import { applyC9Migration } from "../../../services/platform-api/src/c9.js";
import { applyC10Migration } from "../../../services/platform-api/src/c10.js";
import { applyC11Migration } from "../../../services/platform-api/src/c11.js";
import { applyC12Migration } from "../../../services/platform-api/src/c12.js";
import { PostgresSceneRepository } from "../../../services/platform-api/src/modules/scenes/postgres.js";
import { SceneWorkerService } from "../../../services/platform-api/src/modules/scenes/service.js";
import { PostgresSceneSnapshotVerifier } from "../../../services/platform-api/src/modules/scenes/snapshot.js";
import { InMemorySceneObjectStorage } from "../../../services/platform-api/src/modules/scenes/storage.js";
import { createJsonLogger } from "../../../services/spatial-worker/src/logger.js";
import { SceneCompilationRunner } from "../../../services/spatial-worker/src/scene-compile/runner.js";
import { richLease } from "../../../services/spatial-worker/test/design-options/support.js";

const configuredDatabaseUrl = process.env.C12_PRODUCTION_TEST_DATABASE_URL ?? "";
const databaseUrl =
  configuredDatabaseUrl ||
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const describeLive = configuredDatabaseUrl.length === 0 ? describe.skip : describe;
const sessionSecret = "c12-production-runner-test-secret-at-least-thirty-two-bytes";
const compiler = {
  name: "interior-design-scene-compiler" as const,
  version: sceneCompilerVersion,
};
const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "info",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});
const privateMarker = "PRIVATE_C12_HOUSEHOLD_ACCESSIBILITY_ASSET_MARKER";

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

function availableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port for the C12 Next server."));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForHttp(
  url: string,
  child: ChildProcess,
  output: readonly string[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The C12 Next server exited before readiness. ${output.join("")}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The production Next server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The C12 Next server did not become ready. ${output.join("")}`);
}

function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

describeLive("C12 production API, deterministic worker, atomic branches and C10 GLB", () => {
  const composedLogChunks: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      composedLogChunks.push(String(chunk));
      callback();
    },
  });
  const logger = defaultLogger(config);
  if (typeof logger !== "object") throw new Error("C12 live logging configuration is unavailable.");
  const sql = createC1Sql(databaseUrl);
  const storage = new InMemorySceneObjectStorage();
  const nextOutput: string[] = [];
  const workerOutput: string[] = [];
  let nextBaseUrl = "";
  let nextProcess: ChildProcess | undefined;
  let workerProcess: ChildProcess | undefined;
  const server = createServer({
    c1: { database: sql },
    c4: { database: sql },
    c10: { compiler, database: sql, storage },
    c11: { database: sql },
    c12: { database: sql },
    config,
    environment: { C1_LOCAL_SESSION_SECRET: sessionSecret, NODE_ENV: "test" },
    logger: { ...logger, stream: logStream },
  });

  beforeAll(async () => {
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
    await applyC11Migration(sql);
    await applyC12Migration(sql);
    await storage.readiness();
    const apiBaseUrl = await server.listen({ host: "127.0.0.1", port: 0 });
    const webRoot = path.resolve(process.cwd(), "apps/web");
    await access(path.join(webRoot, ".next", "BUILD_ID"));
    const nextPort = await availableLoopbackPort();
    nextBaseUrl = `http://127.0.0.1:${String(nextPort)}`;
    const nextCli = createRequire(path.resolve(process.cwd(), "package.json")).resolve(
      "next/dist/bin/next",
    );
    nextProcess = spawn(
      process.execPath,
      [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(nextPort)],
      {
        cwd: webRoot,
        env: {
          ...process.env,
          C12_OPTION_EVIDENCE_CLASSIFICATION: "production-composed",
          HOME_DESIGN_API_BASE_URL: apiBaseUrl,
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    nextProcess.stdout?.on("data", (chunk) => nextOutput.push(String(chunk)));
    nextProcess.stderr?.on("data", (chunk) => nextOutput.push(String(chunk)));
    await waitForHttp(`${nextBaseUrl}/sign-in`, nextProcess, nextOutput);
  });

  afterAll(async () => {
    await stopChild(workerProcess);
    await stopChild(nextProcess);
    await server.close();
    await sql.end({ timeout: 5 });
  });

  async function signIn(persona: LocalPersona): Promise<string> {
    const response = await server.inject({
      method: "POST",
      payload: { persona },
      url: "/v1/auth/local/session",
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ readonly accessToken: string }>().accessToken;
  }

  async function signInNext(persona: LocalPersona): Promise<string> {
    const response = await fetch(`${nextBaseUrl}/api/c1/session`, {
      body: JSON.stringify({ persona }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (cookie === undefined) throw new Error("The production Next sign-in cookie is missing.");
    return cookie;
  }

  async function createProject(token: string): Promise<Project> {
    const response = await server.inject({
      headers: { ...authorization(token), "idempotency-key": randomUUID() },
      method: "POST",
      payload: { name: `Synthetic C12 production ${randomUUID()}` },
      url: "/v1/projects",
    });
    expect(response.statusCode).toBe(201);
    return response.json<Project>();
  }

  it("generates two replayable options, confirms isolated siblings, preserves existing and compiles one branch", async () => {
    const ownerToken = await signIn("homeowner-alpha");
    const ownerCookie = await signInNext("homeowner-alpha");
    const project = await createProject(ownerToken);
    const sessionResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: "/v1/session",
    });
    const session = sessionSchema.parse(sessionResponse.json());
    const modelId = randomUUID();
    const sourceFixture = richLease().sourceSnapshot.snapshot;
    const sourceSnapshot = canonicalHomeSnapshotSchema.parse({
      ...structuredClone(sourceFixture),
      modelId,
      projectId: project.id,
      profile: "existing",
    });
    const space = sourceSnapshot.elements.spaces[0];
    if (space === undefined) throw new Error("The rich C12 fixture requires one target space.");

    const snapshotResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": randomUUID() },
      method: "POST",
      payload: { expectedCurrentSnapshotSha256: null, snapshot: sourceSnapshot },
      url: `/v1/projects/${project.id}/models/existing/snapshots`,
    });
    expect(snapshotResponse.statusCode).toBe(201);
    const existing = modelSnapshotRecordSchema.parse(snapshotResponse.json());

    const briefKey = randomUUID();
    const briefResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": briefKey },
      method: "PUT",
      payload: {
        expectedRevision: 0,
        idempotencyKey: briefKey,
        operations: [
          {
            entry: {
              category: "spatial-need",
              classification: "preference",
              id: randomUUID(),
              priority: 5,
              provenance: {
                capturedAt: new Date().toISOString(),
                method: "user-stated",
                statedByUserId: session.actor.userId,
              },
              roomOrLevelElementIds: [space.id],
              statement: privateMarker,
              status: "active",
            },
            kind: "entry.add",
          },
        ],
      },
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(briefResponse.statusCode).toBe(200);
    const draft = designBriefSchema.parse(briefResponse.json());
    const acceptanceKey = randomUUID();
    const acceptanceResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": acceptanceKey },
      method: "POST",
      payload: { expectedRevision: draft.revision, idempotencyKey: acceptanceKey },
      url: `/v1/projects/${project.id}/design-brief/accept`,
    });
    expect(acceptanceResponse.statusCode).toBe(200);
    const accepted = designBriefSchema.parse(acceptanceResponse.json());
    const briefContentSha256 = acceptanceResponse.headers["x-interior-design-brief-content-sha256"];
    expect(accepted.status).toBe("accepted");
    expect(briefContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    if (briefContentSha256 === undefined) throw new Error("Accepted brief hash is missing.");

    const liveWorkspaceResponse = await fetch(
      `${nextBaseUrl}/api/c11/projects/${project.id}/workspace`,
      { headers: { cookie: ownerCookie } },
    );
    expect(liveWorkspaceResponse.status).toBe(200);
    const liveWorkspace = (await liveWorkspaceResponse.json()) as {
      readonly brief?: {
        readonly id?: unknown;
        readonly revision?: unknown;
        readonly status?: unknown;
      };
      readonly briefContentSha256?: unknown;
    };
    expect(liveWorkspace).toMatchObject({
      brief: { id: accepted.id, revision: accepted.revision, status: "accepted" },
      briefContentSha256,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const separator = ownerCookie.indexOf("=");
      await context.addCookies([
        {
          name: ownerCookie.slice(0, separator),
          url: nextBaseUrl,
          value: ownerCookie.slice(separator + 1),
        },
      ]);
      const page = await context.newPage();
      const browserErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.goto(`${nextBaseUrl}/design-consultation/${project.id}`, {
        waitUntil: "networkidle",
      });
      const handoff = page.getByRole("link", { name: "Generate two valid design options" });
      await handoff.waitFor({ state: "visible", timeout: 15_000 });
      const href = await handoff.getAttribute("href");
      if (href === null) throw new Error("The production C11-to-C12 handoff URL is missing.");
      const launch = new URL(href, nextBaseUrl);
      expect(launch.pathname).toBe(`/design-options/${project.id}`);
      expect(Object.fromEntries(launch.searchParams.entries())).toMatchObject({
        briefId: accepted.id,
        briefRevision: String(accepted.revision),
        briefSha256: briefContentSha256,
        modelId,
        modelProfile: "existing",
        optionCount: "2",
        snapshotId: existing.id,
        snapshotSha256: existing.snapshotSha256,
        snapshotVersion: String(existing.version),
      });
      await handoff.click();
      await page.getByRole("heading", { name: "Compare what actually changes" }).waitFor({
        state: "visible",
        timeout: 15_000,
      });
      expect(browserErrors).toEqual([]);
      await context.close();
    } finally {
      await browser.close();
    }

    const beforeJob = await sql<
      Array<{ readonly branches: number; readonly commits: number; readonly proposed: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS proposed,
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS commits
    `;
    expect(beforeJob[0]).toEqual({ branches: 0, commits: 0, proposed: 0 });

    const createJobKey = randomUUID();
    const createJobPath = `/api/c12/projects/${project.id}/design-option-jobs`;
    const jobResponse = await fetch(`${nextBaseUrl}${createJobPath}`, {
      body: JSON.stringify({
        baseBrief: {
          briefId: accepted.id,
          contentSha256: briefContentSha256,
          revision: accepted.revision,
        },
        requestedDirections: ["circulation-first", "conversation-first"],
        requestedOptionCount: 2,
        sourceModel: {
          modelId,
          profile: "existing",
          snapshotId: existing.id,
          snapshotSha256: existing.snapshotSha256,
          snapshotVersion: existing.version,
        },
      }),
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
        "idempotency-key": createJobKey,
      },
      method: "POST",
    });
    expect(jobResponse.status).toBe(201);
    const queued = optionJobSchema.parse(await jobResponse.json());
    expect(queued).toMatchObject({ optionCount: 0, state: "queued" });
    expect(beforeJob[0]).toEqual({ branches: 0, commits: 0, proposed: 0 });

    const completedPath = `${createJobPath}/${queued.id}`;
    const workerEntry = path.resolve(process.cwd(), "services/spatial-worker/dist/src/index.js");
    await access(workerEntry);
    workerProcess = spawn(process.execPath, [workerEntry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        C2_DATABASE_URL: databaseUrl,
        C2_POLL_MS: "100",
        C2_WORKER_ID: "c12-live-production-runner",
        C6_PLAN_WORKER_ENABLED: "false",
        C7_ROOMPLAN_WORKER_ENABLED: "false",
        C8_RECONSTRUCTION_WORKER_ENABLED: "false",
        C9_FUSION_WORKER_ENABLED: "false",
        C10_DATABASE_URL: databaseUrl,
        C10_SCENE_WORKER_ENABLED: "false",
        C12_DATABASE_URL: databaseUrl,
        C12_DESIGN_OPTION_WORKER_ENABLED: "true",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    workerProcess.stdout?.on("data", (chunk) => workerOutput.push(String(chunk)));
    workerProcess.stderr?.on("data", (chunk) => workerOutput.push(String(chunk)));

    let completed: ReturnType<typeof optionJobSchema.parse> | undefined;
    const workerDeadline = Date.now() + 45_000;
    try {
      while (Date.now() < workerDeadline) {
        if (workerProcess.exitCode !== null) {
          throw new Error(
            `The built C12 spatial worker exited before completion. ${workerOutput.join("")}`,
          );
        }
        const completedResponse = await fetch(`${nextBaseUrl}${completedPath}`, {
          headers: { cookie: ownerCookie },
        });
        expect(completedResponse.status).toBe(200);
        const current = optionJobSchema.parse(await completedResponse.json());
        if (current.state === "succeeded") {
          completed = current;
          break;
        }
        if (current.state === "failed" || current.state === "cancelled") {
          throw new Error(
            `The built C12 spatial worker reached ${current.state}. ${workerOutput.join("")}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      await stopChild(workerProcess);
      workerProcess = undefined;
    }
    if (completed === undefined) {
      throw new Error(`The built C12 spatial worker timed out. ${workerOutput.join("")}`);
    }
    expect(completed).toMatchObject({
      attempt: 1,
      optionCount: 2,
      stage: "complete",
      state: "succeeded",
    });
    const optionsResponse = await fetch(`${nextBaseUrl}${completedPath}/options`, {
      headers: { cookie: ownerCookie },
    });
    expect(optionsResponse.status).toBe(200);
    const proposals = listDesignOptionsResponseSchema.parse(await optionsResponse.json());
    expect(proposals.options).toHaveLength(2);
    expect(proposals.optionSet?.pairwiseDiversity).toHaveLength(1);
    expect(proposals.optionSet?.pairwiseDiversity[0]?.spatiallyOrMateriallyDistinct).toBe(true);
    expect(new Set(proposals.options.map(({ direction }) => direction))).toEqual(
      new Set(["circulation-first", "conversation-first"]),
    );

    const workingSnapshot = canonicalHomeSnapshotSchema.parse({
      ...structuredClone(existing.snapshot),
      derivedFromSnapshotSha256: existing.snapshotSha256,
      profile: "proposed",
    });
    for (const option of proposals.options) {
      const elementKinds = new Set(
        option.operationBundle.operations.flatMap((operation) =>
          "element" in operation ? [operation.element.elementType] : [],
        ),
      );
      expect(elementKinds).toEqual(new Set(["finish", "furnishing", "light"]));
      expect(option.operationBundle.constraintResults.every(({ passed }) => passed)).toBe(true);
      const replay = reduceModelOperations(workingSnapshot, option.operationBundle.operations);
      expect(replay.hasBlockingFindings).toBe(false);
      expect(replay.snapshotSha256).toBe(option.operationBundle.candidateSnapshotSha256);
    }

    const afterGeneration = await sql<
      Array<{ readonly branches: number; readonly commits: number; readonly proposed: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS proposed,
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS commits
    `;
    expect(afterGeneration[0]).toEqual({ branches: 0, commits: 0, proposed: 0 });

    const optionSet = proposals.optionSet;
    const first = proposals.options[0];
    const second = proposals.options[1];
    if (optionSet === undefined || first === undefined || second === undefined) {
      throw new Error("The deterministic C12 worker did not publish two complete options.");
    }
    const confirmationPayload = (idempotencyKey: string) => ({
      expectedBriefContentSha256: completed.baseBrief.contentSha256,
      expectedBriefRevision: completed.baseBrief.revision,
      expectedJobVersion: completed.version,
      expectedOptionSetSha256: optionSet.setSha256,
      expectedOptionStatus: "pending" as const,
      expectedSourceSnapshotSha256: completed.sourceModel.snapshotSha256,
      idempotencyKey,
    });
    const firstKey = randomUUID();
    const firstPayload = confirmationPayload(firstKey);
    const firstConfirmationResponse = await fetch(
      `${nextBaseUrl}${completedPath}/options/${first.id}/confirm`,
      {
        body: JSON.stringify(firstPayload),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
          "idempotency-key": firstKey,
        },
        method: "POST",
      },
    );
    const firstUrl = `/v1/projects/${project.id}/design-option-jobs/${completed.id}/options/${first.id}/confirm`;
    const firstReplayResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": firstKey },
      method: "POST",
      payload: firstPayload,
      url: firstUrl,
    });
    expect(firstConfirmationResponse.status).toBe(201);
    expect(firstReplayResponse.statusCode).toBe(201);
    expect(firstReplayResponse.headers["idempotent-replay"]).toBe("true");
    const firstConfirmationPayload = await firstConfirmationResponse.json();
    expect(firstReplayResponse.json()).toEqual(firstConfirmationPayload);
    const firstConfirmation = optionConfirmationSchema.parse(firstConfirmationPayload);

    const secondKey = randomUUID();
    const secondConfirmationResponse = await fetch(
      `${nextBaseUrl}${completedPath}/options/${second.id}/confirm`,
      {
        body: JSON.stringify(confirmationPayload(secondKey)),
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
          "idempotency-key": secondKey,
        },
        method: "POST",
      },
    );
    expect(secondConfirmationResponse.status).toBe(201);
    const secondConfirmation = optionConfirmationSchema.parse(
      await secondConfirmationResponse.json(),
    );
    expect(firstConfirmation.branchId).not.toBe(secondConfirmation.branchId);
    expect(firstConfirmation.commitId).not.toBe(secondConfirmation.commitId);
    expect(firstConfirmation.resultSnapshotSha256).not.toBe(
      secondConfirmation.resultSnapshotSha256,
    );

    const topology = await sql<
      Array<{
        readonly branch_id: string;
        readonly branch_revision: number;
        readonly commit_id: string;
        readonly head_snapshot_id: string;
        readonly head_snapshot_sha256: string;
        readonly option_id: string;
        readonly parent_snapshot_id: string;
        readonly parent_snapshot_sha256: string;
        readonly result_snapshot_id: string;
        readonly result_snapshot_sha256: string;
        readonly source_snapshot_id: string;
        readonly source_snapshot_sha256: string;
      }>
    >`
      SELECT c.option_id, c.branch_id, c.commit_id, c.result_snapshot_id,
        c.result_snapshot_sha256, b.revision AS branch_revision,
        b.source_snapshot_id, b.source_snapshot_sha256,
        b.head_snapshot_id, b.head_snapshot_sha256,
        m.parent_snapshot_id, m.parent_snapshot_sha256
      FROM design_option_confirmations c
      JOIN model_branches b
        ON b.tenant_id = c.tenant_id AND b.project_id = c.project_id
        AND b.profile = c.profile AND b.id = c.branch_id
      JOIN model_operation_commits m
        ON m.tenant_id = c.tenant_id AND m.project_id = c.project_id
        AND m.profile = c.profile AND m.branch_id = c.branch_id AND m.id = c.commit_id
      WHERE c.project_id = ${project.id}::uuid AND c.job_id = ${completed.id}::uuid
      ORDER BY c.option_id
    `;
    expect(topology).toHaveLength(2);
    const candidateByOption = new Map(
      proposals.options.map((option) => [
        option.id,
        option.operationBundle.candidateSnapshotSha256,
      ]),
    );
    for (const row of topology) {
      expect(row.branch_revision).toBe(1);
      expect(row.source_snapshot_id).toBe(completed.workingModel.snapshotId);
      expect(row.source_snapshot_sha256).toBe(completed.workingModel.snapshotSha256);
      expect(row.parent_snapshot_id).toBe(completed.workingModel.snapshotId);
      expect(row.parent_snapshot_sha256).toBe(completed.workingModel.snapshotSha256);
      expect(row.head_snapshot_id).toBe(row.result_snapshot_id);
      expect(row.head_snapshot_sha256).toBe(row.result_snapshot_sha256);
      expect(row.result_snapshot_sha256).toBe(candidateByOption.get(row.option_id));
    }
    expect(new Set(topology.map(({ branch_id }) => branch_id)).size).toBe(2);
    expect(new Set(topology.map(({ commit_id }) => commit_id)).size).toBe(2);
    expect(new Set(topology.map(({ result_snapshot_id }) => result_snapshot_id)).size).toBe(2);

    const counts = await sql<
      Array<{
        readonly branches: number;
        readonly commits: number;
        readonly confirmations: number;
        readonly proposed: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS proposed,
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS commits,
        (SELECT count(*)::int FROM design_option_confirmations
          WHERE project_id = ${project.id}::uuid AND job_id = ${completed.id}::uuid) AS confirmations
    `;
    expect(counts[0]).toEqual({ branches: 2, commits: 2, confirmations: 2, proposed: 3 });

    const existingAfterResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing`,
    });
    expect(existingAfterResponse.statusCode).toBe(200);
    const existingAfter = modelSnapshotRecordSchema.parse(existingAfterResponse.json());
    expect(existingAfter).toEqual(existing);

    const firstTopology = topology.find(({ option_id }) => option_id === first.id);
    if (firstTopology === undefined) throw new Error("First confirmed branch topology is missing.");
    const sceneResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": randomUUID() },
      method: "POST",
      payload: {
        configuration: {
          coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
          geometryMode: "parametric-v1",
          materialMode: "status-aware-neutral-v1",
          purpose: "interactive-browser",
          unknownGeometryPolicy: "omit-and-report",
        },
        label: "C12 confirmed isolated branch",
        sourceSnapshot: {
          modelId,
          profile: "proposed",
          projectId: project.id,
          schemaVersion: "c4-canonical-home-v1",
          snapshotId: firstTopology.result_snapshot_id,
          snapshotSha256: firstTopology.result_snapshot_sha256,
        },
      },
      url: `/v1/projects/${project.id}/scene-jobs`,
    });
    expect(sceneResponse.statusCode).toBe(201);
    const sceneJob = sceneJobSchema.parse(sceneResponse.json());
    const sceneRunner = new SceneCompilationRunner({
      heartbeatMilliseconds: 1_000,
      leaseSeconds: 30,
      logger: createJsonLogger(logStream),
      pollMilliseconds: 100,
      worker: new SceneWorkerService({
        repository: new PostgresSceneRepository(sql),
        snapshotVerifier: new PostgresSceneSnapshotVerifier(sql),
        storage,
      }),
      workerId: "c12-confirmed-scene-runner",
    });
    await expect(sceneRunner.processNext()).resolves.toBe("processed");
    const completedSceneJobResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${sceneJob.id}`,
    });
    expect(sceneJobSchema.parse(completedSceneJobResponse.json()).state).toBe("succeeded");
    const publishedSceneResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${sceneJob.id}/scene`,
    });
    const published = sceneRecordSchema.parse(publishedSceneResponse.json());
    expect(published.manifest.sourceSnapshot.snapshotId).toBe(firstTopology.result_snapshot_id);
    expect(published.manifest.sourceSnapshot.snapshotSha256).toBe(
      firstTopology.result_snapshot_sha256,
    );
    const bytes = storage.readForTest(published.artifact.glbSha256);
    if (bytes === undefined) throw new Error("The immutable C12-derived GLB is missing.");
    expect(bytes.byteLength).toBe(published.artifact.byteSize);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(published.artifact.glbSha256);
    const parsed = parseGlb(bytes);
    expect(parsed.counts).toMatchObject(published.manifest.counts);
    expect((parsed.json.asset as { readonly version?: unknown }).version).toBe("2.0");
    expect(parsed.json.extensionsRequired ?? []).toEqual([]);
    expect(JSON.stringify(parsed.json)).not.toMatch(/"uri"/u);

    const c12Elements = first.operationBundle.operations.flatMap((operation) =>
      "element" in operation ? [operation.element] : [],
    );
    expect(new Set(c12Elements.map(({ elementType }) => elementType))).toEqual(
      new Set(["finish", "furnishing", "light"]),
    );
    const nodes = parsed.json.nodes as readonly {
      readonly extensions?: { readonly KHR_lights_punctual?: { readonly light?: unknown } };
      readonly extras?: { readonly canonicalElementId?: unknown };
    }[];
    const materials = parsed.json.materials as readonly {
      readonly extras?: { readonly canonicalElementId?: unknown };
    }[];
    const punctualLights = (
      parsed.json.extensions as
        | {
            readonly KHR_lights_punctual?: {
              readonly lights?: readonly {
                readonly extras?: { readonly canonicalElementId?: unknown };
              }[];
            };
          }
        | undefined
    )?.KHR_lights_punctual?.lights;
    for (const element of c12Elements) {
      const mapping = published.manifest.elementMappings.find(
        ({ elementId }) => elementId === element.id,
      );
      expect(mapping).toMatchObject({
        elementId: element.id,
        elementType: element.elementType,
        status: "mapped",
      });
      if (mapping === undefined) throw new Error("A confirmed C12 scene mapping is missing.");
      if (element.elementType === "finish") {
        expect(mapping.materialIndices.length).toBeGreaterThan(0);
        for (const materialIndex of mapping.materialIndices) {
          expect(materials[materialIndex]?.extras?.canonicalElementId).toBe(element.id);
        }
      } else {
        expect(mapping.nodeIndices.length).toBeGreaterThan(0);
        for (const nodeIndex of mapping.nodeIndices) {
          expect(nodes[nodeIndex]?.extras?.canonicalElementId).toBe(element.id);
        }
      }
      if (element.elementType === "furnishing")
        expect(mapping.meshIndices.length).toBeGreaterThan(0);
      if (element.elementType === "light") {
        const lightIndex =
          nodes[mapping.nodeIndices[0] ?? -1]?.extensions?.KHR_lights_punctual?.light;
        expect(typeof lightIndex).toBe("number");
        if (typeof lightIndex === "number") {
          expect(punctualLights?.[lightIndex]?.extras?.canonicalElementId).toBe(element.id);
        }
      }
    }

    const composedLogs = `${composedLogChunks.join("")}\n${nextOutput.join("")}\n${workerOutput.join("")}`;
    expect(composedLogs).toContain("design-options.published");
    expect(composedLogs).toContain("scene.compiled");
    expect(composedLogs).not.toContain(privateMarker);
    expect(composedLogs).not.toContain(ownerToken);
    expect(composedLogs).not.toContain(first.summary);
    expect(composedLogs).not.toContain(first.operationBundle.assetPlacements[0]?.asset.id);
    expect(composedLogs).not.toMatch(/acceptedBrief|assetPlacements|leaseToken|operations/iu);
  }, 120_000);
});
