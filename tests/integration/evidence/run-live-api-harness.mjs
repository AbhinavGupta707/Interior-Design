import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.C2_LIVE_STACK_API_URL ?? "http://127.0.0.1:4100";

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}: ${body?.code}`,
    );
  }
  return body;
}

async function signIn(persona) {
  const session = await jsonRequest("/v1/auth/local/session", {
    body: JSON.stringify({ persona }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return session.accessToken;
}

async function createProject(token, persona) {
  const id = randomUUID();
  return jsonRequest("/v1/projects", {
    body: JSON.stringify({ name: `C2 adversarial ${persona} ${id.slice(0, 8)}` }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": `c2-adversarial-project-${id}`,
    },
    method: "POST",
  });
}

const [alphaOwnerToken, betaOwnerToken, alphaViewerToken] = await Promise.all([
  signIn("homeowner-alpha"),
  signIn("homeowner-beta"),
  signIn("viewer-alpha"),
]);
const [alphaProject, betaProject] = await Promise.all([
  createProject(alphaOwnerToken, "alpha"),
  createProject(betaOwnerToken, "beta"),
]);

const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "tests/integration/evidence/live-api.integration.test.ts"],
  {
    env: {
      ...process.env,
      C2_ADVERSARIAL_ALPHA_OWNER_TOKEN: alphaOwnerToken,
      C2_ADVERSARIAL_ALPHA_PROJECT_ID: alphaProject.id,
      C2_ADVERSARIAL_ALPHA_VIEWER_TOKEN: alphaViewerToken,
      C2_ADVERSARIAL_API_URL: baseUrl,
      C2_ADVERSARIAL_BETA_OWNER_TOKEN: betaOwnerToken,
      C2_ADVERSARIAL_BETA_PROJECT_ID: betaProject.id,
      C2_ADVERSARIAL_MEDIA: "1",
    },
    shell: false,
    stdio: "inherit",
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
if (exitCode !== 0) {
  throw new Error(`Live adversarial API harness exited ${String(exitCode)}.`);
}
process.stdout.write(
  `${JSON.stringify({
    alphaProjectId: alphaProject.id,
    betaProjectId: betaProject.id,
    status: "passed",
  })}\n`,
);
