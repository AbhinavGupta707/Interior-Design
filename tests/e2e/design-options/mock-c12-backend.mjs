import { execFileSync } from "node:child_process";
import http from "node:http";

execFileSync("pnpm", ["--filter", "@interior-design/contracts", "build"], {
  stdio: "ignore",
});

const fixtures = await import("../../../apps/web/test/design-options/fixtures.ts");
const {
  confirmationA,
  ids,
  job: succeededJob,
  optionA,
  optionB,
  optionSet,
  ownerSession,
  project,
  viewerSession,
} = fixtures;

const port = 4341;
let scenario = "ready";
let confirmations = 0;
let cancellations = 0;
let retries = 0;
let confirmedOptionIds = new Set();

function reset(value = "ready") {
  scenario = value;
  confirmations = 0;
  cancellations = 0;
  retries = 0;
  confirmedOptionIds = new Set();
}

function role(request) {
  return (request.headers.authorization ?? "").includes("viewer-token") ? "viewer" : "owner";
}

function foreign(request) {
  return (request.headers.authorization ?? "").includes("foreign-token");
}

function withoutCompletion(job) {
  const { completedAt: _completedAt, safeCode: _safeCode, ...rest } = job;
  return rest;
}

function currentJob() {
  if (scenario === "running") {
    return {
      ...withoutCompletion(succeededJob),
      optionCount: 0,
      retryable: false,
      stage: "generating",
      state: "running",
      updatedAt: "2026-07-18T10:02:00.000Z",
      version: 2,
    };
  }
  if (scenario === "cancelled") {
    return {
      ...withoutCompletion(succeededJob),
      cancelledAt: "2026-07-18T10:03:00.000Z",
      optionCount: 0,
      retryable: true,
      stage: "complete",
      state: "cancelled",
      version: 3,
    };
  }
  if (scenario === "abstained") {
    return {
      ...withoutCompletion(succeededJob),
      completedAt: "2026-07-18T10:03:00.000Z",
      optionCount: 0,
      retryable: true,
      safeCode: "NO_FEASIBLE_DIVERSE_SET",
      stage: "complete",
      state: "abstained",
      version: 3,
    };
  }
  return succeededJob;
}

function currentOptions() {
  if (currentJob().state !== "succeeded") {
    return { jobId: ids.job, options: [], projectId: ids.project };
  }
  return {
    jobId: ids.job,
    optionSet,
    options: [optionA, optionB].map((option) =>
      confirmedOptionIds.has(option.id) ? { ...option, status: "confirmed" } : option,
    ),
    projectId: ids.project,
  };
}

function json(value, status = 200) {
  return {
    body: JSON.stringify(value),
    headers: { "cache-control": "no-store", "content-type": "application/json" },
    status,
  };
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const jobsPath = `/v1/projects/${ids.project}/design-option-jobs`;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (url.pathname === "/__scenario") {
    reset(url.searchParams.get("value") ?? "ready");
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === "/__state") {
    const result = json({
      asBuiltProfileMutations: 0,
      cancellations,
      confirmations,
      existingProfileMutations: 0,
      retries,
    });
    response.writeHead(result.status, result.headers);
    response.end(result.body);
    return;
  }

  let result;
  if (foreign(request)) {
    result = json({ detail: "Not found", status: 404, title: "Not found" }, 404);
  } else if (url.pathname === "/v1/auth/local/session" && request.method === "POST") {
    await body(request);
    result = json({
      accessToken: "owner-token-for-synthetic-browser-evidence-only",
      session: ownerSession,
    });
  } else if (url.pathname === "/v1/session") {
    result =
      scenario === "expired"
        ? json({ detail: "expired" }, 401)
        : json(role(request) === "viewer" ? viewerSession : ownerSession);
  } else if (url.pathname === `/v1/projects/${ids.project}`) {
    result = json(project);
  } else if (url.pathname === jobsPath && request.method === "GET") {
    if (scenario === "service-error") {
      result = json({ accessToken: "raw-private-token", detail: "raw private brief" }, 503);
    } else {
      result = json({ jobs: scenario === "empty" ? [] : [currentJob()], projectId: ids.project });
    }
  } else if (url.pathname === jobsPath && request.method === "POST") {
    await body(request);
    scenario = "running";
    result = json(currentJob(), 201);
  } else if (url.pathname === `${jobsPath}/${ids.job}` && request.method === "GET") {
    result = json(currentJob());
  } else if (url.pathname === `${jobsPath}/${ids.job}/options` && request.method === "GET") {
    result = json(currentOptions());
  } else if (
    url.pathname === `${jobsPath}/${ids.job}/options/${ids.optionA}` &&
    request.method === "GET"
  ) {
    result = json(optionA);
  } else if (
    url.pathname === `${jobsPath}/${ids.job}/options/${ids.optionB}` &&
    request.method === "GET"
  ) {
    result = json(optionB);
  } else if (url.pathname === `${jobsPath}/${ids.job}/cancel` && request.method === "POST") {
    cancellations += 1;
    scenario = "cancelled";
    result = json(currentJob());
  } else if (url.pathname === `${jobsPath}/${ids.job}/retry` && request.method === "POST") {
    retries += 1;
    scenario = "running";
    result = json(currentJob());
  } else if (
    url.pathname === `${jobsPath}/${ids.job}/options/${ids.optionA}/confirm` &&
    request.method === "POST"
  ) {
    const confirmationRequest = await body(request);
    if (scenario === "stale-confirm") {
      result = json({ code: "SOURCE_CHANGED", detail: "raw stale source" }, 409);
    } else if (role(request) === "viewer") {
      result = json({ detail: "read only" }, 403);
    } else {
      confirmations += 1;
      confirmedOptionIds.add(ids.optionA);
      result = json({ ...confirmationA, idempotencyKey: confirmationRequest.idempotencyKey }, 201);
    }
  } else {
    result = json({ detail: "Not found", status: 404, title: "Not found" }, 404);
  }
  response.writeHead(result.status, result.headers);
  response.end(result.body);
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
