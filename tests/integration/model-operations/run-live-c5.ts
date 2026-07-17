import {
  modelSnapshotRecordSchema,
  projectSchema,
  type LocalPersona,
} from "../../../packages/contracts/src/index.js";
import { existingHomeSnapshot } from "../../../packages/test-fixtures/src/models/index.js";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

interface PersonaSession {
  readonly accessToken: string;
}

const apiUrl = (process.env.C5_LIVE_API_URL ?? "http://127.0.0.1:4105").replace(/\/$/u, "");
const databaseUrl = process.env.C5_LIVE_DATABASE_URL;

async function checkedJson(label: string, pathname: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiUrl}${pathname}`, { ...init, redirect: "manual" });
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${String(response.status)}.`);
  }
  return (await response.json()) as unknown;
}

async function signIn(persona: LocalPersona): Promise<string> {
  const session = (await checkedJson(`sign-in-${persona}`, "/v1/auth/local/session", {
    body: JSON.stringify({ persona }),
    headers: { "content-type": "application/json" },
    method: "POST",
  })) as PersonaSession;
  if (typeof session.accessToken !== "string" || session.accessToken.length < 20) {
    throw new Error("Live C5 fixture sign-in returned no bounded access token.");
  }
  return session.accessToken;
}

async function createProject(token: string, label: string) {
  return projectSchema.parse(
    await checkedJson("create-project", "/v1/projects", {
      body: JSON.stringify({ name: label }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `c5-live-project-${randomUUID()}`,
      },
      method: "POST",
    }),
  );
}

async function runVitest(environment: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "vitest", "run", "--config", "tests/integration/model-operations/vitest.config.ts"],
      { env: environment, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

export async function runLiveC5Acceptance(): Promise<number> {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("C5_LIVE_DATABASE_URL is required for the live acceptance harness.");
  }
  const [ownerToken, editorToken, viewerToken, foreignToken] = await Promise.all([
    signIn("homeowner-alpha"),
    signIn("editor-alpha"),
    signIn("viewer-alpha"),
    signIn("homeowner-beta"),
  ]);
  const [project, foreignProject] = await Promise.all([
    createProject(ownerToken, `C5 live acceptance ${randomUUID()}`),
    createProject(foreignToken, `C5 foreign acceptance ${randomUUID()}`),
  ]);
  const snapshot = {
    ...structuredClone(existingHomeSnapshot),
    modelId: randomUUID(),
    propertyId: undefined,
    projectId: project.id,
  };
  const initialized = modelSnapshotRecordSchema.parse(
    await checkedJson("initialize-model", `/v1/projects/${project.id}/models/existing/snapshots`, {
      body: JSON.stringify({ expectedCurrentSnapshotSha256: null, snapshot }),
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "content-type": "application/json",
        "idempotency-key": `c5-live-initialize-${randomUUID()}`,
      },
      method: "POST",
    }),
  );

  return runVitest({
    ...process.env,
    C5_DB_AUDIT_BRANCH_COLUMN: "branch_id",
    C5_DB_AUDIT_TABLE: "model_domain_audit_events",
    C5_DB_BRANCH_TABLE: "model_branches",
    C5_DB_COMMIT_TABLE: "model_operation_commits",
    C5_DB_OPERATION_TABLE: "model_operation_envelopes",
    C5_DB_OUTBOX_BRANCH_COLUMN: "branch_id",
    C5_DB_OUTBOX_TABLE: "model_transactional_outbox",
    C5_DB_SNAPSHOT_TABLE: "canonical_model_snapshots",
    C5_LIVE_API_URL: apiUrl,
    C5_LIVE_DATABASE_URL: databaseUrl,
    C5_LIVE_EDITOR_TOKEN: editorToken,
    C5_LIVE_FOREIGN_PROJECT_ID: foreignProject.id,
    C5_LIVE_FOREIGN_TOKEN: foreignToken,
    C5_LIVE_OWNER_TOKEN: ownerToken,
    C5_LIVE_PROFILE: "existing",
    C5_LIVE_PROJECT_ID: project.id,
    C5_LIVE_SOURCE_IS_C4_FIXTURE: "1",
    C5_LIVE_SOURCE_SNAPSHOT_ID: initialized.id,
    C5_LIVE_SOURCE_SNAPSHOT_SHA256: initialized.snapshotSha256,
    C5_LIVE_VIEWER_TOKEN: viewerToken,
    C5_RUN_LIVE_API: "1",
    C5_RUN_LIVE_POSTGRES: "1",
  });
}

void runLiveC5Acceptance()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "c5_live_acceptance_failed",
        message: error instanceof Error ? error.message : "Unknown live acceptance failure.",
      })}\n`,
    );
    process.exitCode = 1;
  });
