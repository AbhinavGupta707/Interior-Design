import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = 4120;
const projectId = "33333333-3333-4333-8333-333333333333";
const tenantId = "11111111-1111-4111-8111-111111111111";
const userIds = {
  "homeowner-alpha": "aaaaaaaa-1111-4111-8111-111111111111",
  "viewer-alpha": "cccccccc-3333-4333-8333-333333333333",
};
let assets = [];
let sessions = new Map();
let storedParts = new Map();

function reset() {
  assets = [];
  sessions = new Map();
  storedParts = new Map();
}

function headers(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    ...extra,
  };
}

function json(response, status, body, extra = {}) {
  response.writeHead(
    status,
    headers({ "content-type": "application/json; charset=utf-8", ...extra }),
  );
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function problem(response, status, detail) {
  json(
    response,
    status,
    { detail, status, title: "Request unavailable", type: "about:blank" },
    {
      "content-type": "application/problem+json; charset=utf-8",
    },
  );
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const data = Buffer.concat(chunks);
  return data.length ? JSON.parse(data.toString("utf8")) : undefined;
}

async function bytes(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function persona(request) {
  const value = request.headers.authorization;
  if (value === "Bearer fixture-token-homeowner-alpha-synthetic-session") return "homeowner-alpha";
  if (value === "Bearer fixture-token-viewer-alpha-synthetic-session") return "viewer-alpha";
  return undefined;
}

function sessionPayload(name) {
  return {
    actor: {
      displayName: name === "viewer-alpha" ? "Alpha viewer" : "Alpha homeowner",
      role: name === "viewer-alpha" ? "viewer" : "owner",
      subject: `fixture:${name}`,
      tenantId,
      userId: userIds[name],
    },
    authMode: "local-fixture",
    expiresAt: "2099-07-18T12:00:00.000Z",
  };
}

function project() {
  return {
    createdAt: "2026-07-17T12:00:00.000Z",
    id: projectId,
    name: "Sample terrace refresh",
    status: "draft",
    tenantId,
    updatedAt: "2026-07-17T12:00:00.000Z",
    version: 1,
  };
}

function makeAsset(status, index = 1, overrides = {}) {
  const rejected = status === "rejected" || status === "quarantined";
  return {
    createdAt: "2026-07-17T12:00:00.000Z",
    declaredMimeType: "application/pdf",
    detectedMimeType: status === "ready" ? "application/pdf" : undefined,
    fileName: `synthetic-plan-${index}.pdf`,
    id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
    kind: "plan",
    projectId,
    rejectionCode: rejected
      ? status === "quarantined"
        ? "malware-suspected"
        : "signature-mismatch"
      : undefined,
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    source: { byteSize: 32, sha256: "a".repeat(64) },
    status,
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(
        204,
        headers({
          "access-control-allow-headers": "content-type,x-amz-checksum-sha256",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        }),
      );
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health")
      return json(response, 200, { status: "ok" });
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      reset();
      return json(response, 200, { reset: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/seed-states") {
      assets = ["pending-upload", "processing", "ready", "rejected", "quarantined", "aborted"].map(
        (status, index) => makeAsset(status, index + 1),
      );
      return json(response, 200, assets);
    }
    if (request.method === "POST" && url.pathname === "/v1/auth/local/session") {
      const payload = await body(request);
      if (!payload || !["homeowner-alpha", "viewer-alpha"].includes(payload.persona)) {
        return problem(response, 400, "Choose a supported fixture persona.");
      }
      return json(response, 201, {
        accessToken: `fixture-token-${payload.persona}-synthetic-session`,
        session: sessionPayload(payload.persona),
      });
    }

    const storageMatch = url.pathname.match(/^\/__storage\/([^/]+)\/(\d+)$/u);
    if (request.method === "PUT" && storageMatch) {
      const content = await bytes(request);
      const checksum = createHash("sha256").update(content).digest("base64");
      if (request.headers["x-amz-checksum-sha256"] !== checksum)
        return problem(response, 400, "Part checksum mismatch.");
      storedParts.set(`${storageMatch[1]}:${storageMatch[2]}`, content);
      const session = sessions.get(storageMatch[1]);
      if (session) {
        session.recordedPartNumbers = Array.from(
          new Set([...session.recordedPartNumbers, Number(storageMatch[2])]),
        ).sort((left, right) => left - right);
      }
      response.writeHead(
        200,
        headers({
          "access-control-expose-headers": "ETag",
          etag: `\"fixture-${storageMatch[2]}\"`,
        }),
      );
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/__preview/")) {
      response.writeHead(200, headers({ "content-type": "application/pdf" }));
      response.end("%PDF-1.4\n% synthetic preview\n");
      return;
    }

    const actor = persona(request);
    if (!actor) return problem(response, 401, "The local fixture session is missing or expired.");
    if (request.method === "GET" && url.pathname === "/v1/session")
      return json(response, 200, sessionPayload(actor));
    if (request.method === "GET" && url.pathname === "/v1/projects")
      return json(response, 200, [project()]);
    if (request.method === "GET" && url.pathname === `/v1/projects/${projectId}`)
      return json(response, 200, project());

    const assetsPath = `/v1/projects/${projectId}/assets`;
    if (request.method === "GET" && url.pathname === assetsPath) return json(response, 200, assets);

    if (request.method === "POST" && url.pathname === `${assetsPath}/upload-sessions`) {
      if (actor === "viewer-alpha")
        return problem(response, 403, "Viewer fixtures cannot upload evidence.");
      const payload = await body(request);
      const index = assets.length + 1;
      const asset = makeAsset("pending-upload", index, {
        declaredMimeType: payload.declaredMimeType,
        fileName: payload.fileName,
        kind: payload.kind,
        rights: payload.rights,
        source: { byteSize: payload.byteSize, sha256: payload.sha256 },
      });
      assets.push(asset);
      const sessionId = randomUUID();
      const session = {
        asset,
        expiresAt: "2099-07-17T13:00:00.000Z",
        maximumPartCount: 10_000,
        minimumNonFinalPartSize: 5_242_880,
        partSize: 5_242_880,
        recordedPartNumbers: [],
        sessionId,
        state: "initiated",
      };
      sessions.set(sessionId, session);
      return json(response, 201, session);
    }

    const sessionMatch = url.pathname.match(
      new RegExp(`^${assetsPath}/upload-sessions/([^/]+)$`, "u"),
    );
    if (sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      if (!session) return problem(response, 404, "This upload session is unavailable.");
      if (request.method === "GET") return json(response, 200, session);
      if (request.method === "DELETE") {
        session.state = "aborted";
        session.asset.status = "aborted";
        return json(response, 200, session);
      }
    }

    const partMatch = url.pathname.match(
      new RegExp(`^${assetsPath}/upload-sessions/([^/]+)/parts$`, "u"),
    );
    if (request.method === "POST" && partMatch) {
      const session = sessions.get(partMatch[1]);
      if (!session) return problem(response, 404, "This upload session is unavailable.");
      const payload = await body(request);
      session.state = "uploading";
      session.asset.status = "uploading";
      return json(response, 200, {
        expiresAt: "2099-07-17T12:15:00.000Z",
        partNumber: payload.partNumber,
        requiredHeaders: { "x-amz-checksum-sha256": payload.checksumSha256 },
        url: `http://127.0.0.1:${port}/__storage/${partMatch[1]}/${payload.partNumber}`,
      });
    }

    const completeMatch = url.pathname.match(
      new RegExp(`^${assetsPath}/upload-sessions/([^/]+)/complete$`, "u"),
    );
    if (request.method === "POST" && completeMatch) {
      const session = sessions.get(completeMatch[1]);
      if (!session) return problem(response, 404, "This upload session is unavailable.");
      const payload = await body(request);
      if (payload.sha256 !== session.asset.source.sha256)
        return problem(response, 409, "Checksum mismatch.");
      session.state = "completed";
      session.asset.status = "ready";
      session.asset.detectedMimeType = session.asset.declaredMimeType;
      return json(response, 200, session.asset);
    }

    const accessMatch = url.pathname.match(new RegExp(`^${assetsPath}/([^/]+)/access$`, "u"));
    if (request.method === "POST" && accessMatch) {
      const asset = assets.find((item) => item.id === accessMatch[1]);
      if (!asset || asset.status !== "ready")
        return problem(response, 409, "A ready preview is required.");
      return json(response, 200, {
        contentDisposition: "inline",
        expiresAt: "2099-07-17T12:05:00.000Z",
        url: `http://127.0.0.1:${port}/__preview/${asset.id}`,
      });
    }

    problem(response, 404, "The deterministic test route does not exist.");
  } catch (error) {
    problem(
      response,
      500,
      `Deterministic mock failure: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`C2 mock API listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
