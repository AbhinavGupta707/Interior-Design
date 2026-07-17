import { createServer } from "node:http";

const port = 4110;
const tenants = {
  "homeowner-alpha": "11111111-1111-4111-8111-111111111111",
  "homeowner-beta": "22222222-2222-4222-8222-222222222222",
  "viewer-alpha": "11111111-1111-4111-8111-111111111111",
};
const users = {
  "homeowner-alpha": "aaaaaaaa-1111-4111-8111-111111111111",
  "homeowner-beta": "bbbbbbbb-2222-4222-8222-222222222222",
  "viewer-alpha": "cccccccc-3333-4333-8333-333333333333",
};
const displayNames = {
  "homeowner-alpha": "Alpha homeowner",
  "homeowner-beta": "Beta homeowner",
  "viewer-alpha": "Alpha viewer",
};

let projectsByTenant = new Map();
let intakes = new Map();
let projectSequence = 1;
let idempotentResponses = new Map();

function reset() {
  projectsByTenant = new Map();
  intakes = new Map();
  projectSequence = 1;
  idempotentResponses = new Map();
}

function json(response, status, body, contentType = "application/json") {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": `${contentType}; charset=utf-8`,
  });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function problem(response, status, title, detail) {
  json(
    response,
    status,
    { detail, status, title, type: "about:blank" },
    "application/problem+json",
  );
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function personaFrom(request) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return undefined;
  return Object.keys(tenants).find(
    (persona) => value === `Bearer fixture-token-${persona}-synthetic-session`,
  );
}

function sessionFor(persona) {
  return {
    actor: {
      displayName: displayNames[persona],
      role: persona === "viewer-alpha" ? "viewer" : "owner",
      subject: `fixture:${persona}`,
      tenantId: tenants[persona],
      userId: users[persona],
    },
    authMode: "local-fixture",
    expiresAt: "2099-07-18T12:00:00.000Z",
  };
}

function projectForTenant(projectId, tenantId) {
  return (projectsByTenant.get(tenantId) ?? []).find((project) => project.id === projectId);
}

function authorise(request, response) {
  const persona = personaFrom(request);
  if (!persona || !(persona in tenants)) {
    problem(response, 401, "Session expired", "The local fixture session is missing or expired.");
    return undefined;
  }
  return persona;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/__test/reset") {
      reset();
      json(response, 200, { reset: true });
      return;
    }

    const bumpMatch = url.pathname.match(/^\/__test\/bump-intake\/([^/]+)$/u);
    if (request.method === "POST" && bumpMatch) {
      const projectId = bumpMatch[1];
      const current = intakes.get(projectId);
      if (!current) {
        problem(response, 404, "Missing intake", "Create the intake before bumping it.");
        return;
      }
      intakes.set(projectId, {
        ...current,
        updatedAt: "2026-07-17T12:30:00.000Z",
        version: current.version + 1,
      });
      json(response, 200, intakes.get(projectId));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/auth/local/session") {
      const body = await readBody(request);
      if (!body || Object.keys(body).length !== 1 || !(body.persona in tenants)) {
        problem(response, 400, "Invalid persona", "Choose a supported local fixture persona.");
        return;
      }
      json(response, 201, {
        accessToken: `fixture-token-${body.persona}-synthetic-session`,
        session: sessionFor(body.persona),
      });
      return;
    }

    const persona = authorise(request, response);
    if (!persona) return;
    const tenantId = tenants[persona];

    if (request.method === "GET" && url.pathname === "/v1/session") {
      json(response, 200, sessionFor(persona));
      return;
    }

    if (url.pathname === "/v1/projects" && request.method === "GET") {
      json(response, 200, projectsByTenant.get(tenantId) ?? []);
      return;
    }

    if (url.pathname === "/v1/projects" && request.method === "POST") {
      if (persona === "viewer-alpha") {
        problem(response, 403, "Forbidden", "This fixture persona cannot create projects.");
        return;
      }
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) {
        problem(response, 400, "Missing idempotency key", "Idempotency-Key is required.");
        return;
      }
      const body = await readBody(request);
      if (!body || Object.keys(body).length !== 1 || typeof body.name !== "string") {
        problem(response, 400, "Invalid project", "Only a project name is accepted.");
        return;
      }
      const prior = idempotentResponses.get(idempotencyKey);
      if (prior) {
        json(response, 200, prior);
        return;
      }
      const suffix = String(projectSequence).padStart(12, "0");
      projectSequence += 1;
      const project = {
        createdAt: "2026-07-17T12:00:00.000Z",
        id: `33333333-3333-4333-8333-${suffix}`,
        name: body.name.trim(),
        status: "draft",
        tenantId,
        updatedAt: "2026-07-17T12:00:00.000Z",
        version: 1,
      };
      projectsByTenant.set(tenantId, [...(projectsByTenant.get(tenantId) ?? []), project]);
      idempotentResponses.set(idempotencyKey, project);
      json(response, 201, project);
      return;
    }

    const intakeMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/intake$/u);
    if (intakeMatch) {
      const projectId = intakeMatch[1];
      const project = projectForTenant(projectId, tenantId);
      if (!project) {
        problem(response, 404, "Project unavailable", "This project is not available.");
        return;
      }
      if (request.method === "GET") {
        const intake = intakes.get(projectId);
        if (!intake) {
          response.writeHead(204, { "cache-control": "no-store" });
          response.end();
          return;
        }
        json(response, 200, intake);
        return;
      }
      if (request.method === "PUT") {
        if (persona === "viewer-alpha") {
          problem(response, 403, "Forbidden", "This fixture persona cannot update intake.");
          return;
        }
        if (!request.headers["idempotency-key"]) {
          problem(response, 400, "Missing idempotency key", "Idempotency-Key is required.");
          return;
        }
        const body = await readBody(request);
        const current = intakes.get(projectId);
        const currentVersion = current?.version ?? 0;
        if (body.expectedVersion !== currentVersion) {
          problem(response, 409, "Stale intake", "A newer intake version is already saved.");
          return;
        }
        const saved = {
          intake: body.intake,
          projectId,
          updatedAt: "2026-07-17T12:15:00.000Z",
          updatedBy: users[persona],
          version: currentVersion + 1,
        };
        intakes.set(projectId, saved);
        json(response, 200, saved);
        return;
      }
    }

    const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/u);
    if (request.method === "GET" && projectMatch) {
      const project = projectForTenant(projectMatch[1], tenantId);
      if (!project) {
        problem(response, 404, "Project unavailable", "This project is not available.");
        return;
      }
      json(response, 200, project);
      return;
    }

    problem(response, 404, "Not found", "The requested test-contract route does not exist.");
  } catch {
    problem(response, 500, "Mock contract error", "The deterministic test contract failed.");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`C1 mock API listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
