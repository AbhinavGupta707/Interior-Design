import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { deflateSync } from "node:zlib";

execFileSync("pnpm", ["--filter", "@interior-design/contracts", "build"], {
  stdio: "ignore",
});

const fixtures = await import("../../../apps/web/test/render-stills/fixtures.ts");
const {
  availableCapabilities,
  capabilities,
  enhancement,
  failedJob,
  ids,
  job,
  ownerSession,
  project,
  queuedJob,
  result,
  uuid,
  viewerSession,
} = fixtures;

const port = 4353;
const webOrigin = "http://127.0.0.1:4352";
const lifecycle = [
  "queued",
  "preparing",
  "rendering-safe",
  "validating-safe",
  "publishing-safe",
  "succeeded",
];

let scenario = "ready";
let mutableJobs = [];
let lifecycleReads = new Map();
let accessGrants = 0;
let cancels = 0;
let creates = 0;
let retries = 0;
let enhancementRequests = 0;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function png(width, height, colour) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const accent = (x > width / 3 && x < (width * 2) / 3 ? 22 : 0) + (y % 9);
      row[offset] = Math.min(255, colour[0] + accent);
      row[offset + 1] = Math.min(255, colour[1] + accent);
      row[offset + 2] = Math.min(255, colour[2] + accent);
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function cstring(value) {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function exrAttribute(name, type, data) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([cstring(name), cstring(type), size, data]);
}

function exr(channelName) {
  const magicAndVersion = Buffer.from([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]);
  const channel = Buffer.alloc(16);
  channel.writeInt32LE(1, 0);
  channel.writeInt32LE(1, 8);
  channel.writeInt32LE(1, 12);
  const channels = Buffer.concat([cstring(channelName), channel, Buffer.from([0])]);
  const window = Buffer.alloc(16);
  window.writeInt32LE(95, 8);
  window.writeInt32LE(63, 12);
  return Buffer.concat([
    magicAndVersion,
    exrAttribute("channels", "chlist", channels),
    exrAttribute("dataWindow", "box2i", window),
    Buffer.from([0]),
  ]);
}

const goodBytes = new Map([
  [ids.artifactSafe, png(96, 64, [48, 84, 92])],
  [ids.artifactSegmentation, png(96, 64, [112, 47, 38])],
  [ids.artifactEnhancement, png(96, 64, [76, 94, 60])],
  [ids.artifactMultilayer, exr("R")],
  [ids.artifactDepth, exr("Z")],
  [ids.artifactNormal, exr("N")],
]);
const decodeFailureBytes = goodBytes.get(ids.artifactSafe).subarray(0, 33);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactBytes(artifactId) {
  if (scenario === "decode" && artifactId === ids.artifactSafe) return decodeFailureBytes;
  return goodBytes.get(artifactId);
}

function materializeArtifact(artifact) {
  const bytes = artifactBytes(artifact.id);
  return { ...artifact, byteLength: bytes.length, sha256: sha256(bytes) };
}

function materializedResult(jobId = ids.job) {
  return {
    ...result,
    jobId,
    manifest: {
      ...result.manifest,
      artifacts: result.manifest.artifacts.map(materializeArtifact),
    },
  };
}

function materializedEnhancement(state = "succeeded") {
  const base = materializedResult().manifest.artifacts.find(
    ({ role }) => role === "geometry-safe-png",
  );
  const conditioning = Object.fromEntries(
    materializedResult()
      .manifest.artifacts.filter(({ role }) =>
        ["depth-exr", "normal-exr", "segmentation-png"].includes(role),
      )
      .map((artifact) => [artifact.role.split("-", 1)[0], artifact.sha256]),
  );
  if (state === "disabled" || state === "failed" || state === "not-requested") {
    return {
      baseArtifactSha256: base.sha256,
      conditioningSha256: conditioning,
      schemaVersion: enhancement.schemaVersion,
      state,
    };
  }
  if (state === "rejected") {
    return {
      baseArtifactSha256: base.sha256,
      conditioningSha256: conditioning,
      geometryGuard: {
        ...enhancement.geometryGuard,
        accepted: false,
        baseArtifactSha256: base.sha256,
        changedOutsideAllowedMaskPixels: 18,
        enhancedArtifactSha256: sha256(goodBytes.get(ids.artifactEnhancement)),
        protectedEdgeAgreementBasisPoints: 9300,
        protectedGeometryMoved: true,
        safeCode: "GEOMETRY_GUARD_REJECTED",
        segmentationIoUBasisPoints: 9400,
      },
      model: enhancement.model,
      schemaVersion: enhancement.schemaVersion,
      state,
    };
  }
  return {
    ...enhancement,
    artifact: materializeArtifact(enhancement.artifact),
    baseArtifactSha256: base.sha256,
    conditioningSha256: conditioning,
    geometryGuard: {
      ...enhancement.geometryGuard,
      baseArtifactSha256: base.sha256,
      enhancedArtifactSha256: sha256(goodBytes.get(ids.artifactEnhancement)),
    },
  };
}

function reset(value = "ready") {
  scenario = value;
  mutableJobs = [structuredClone(job), structuredClone(failedJob), structuredClone(queuedJob)];
  lifecycleReads = new Map([[queuedJob.id, 0]]);
  accessGrants = 0;
  cancels = 0;
  creates = 0;
  retries = 0;
  enhancementRequests = 0;
}
reset();

function json(value, status = 200, headers = {}) {
  return {
    body: JSON.stringify(value),
    headers: { "cache-control": "no-store", "content-type": "application/json", ...headers },
    status,
  };
}

function token(request) {
  return request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
}

function role(request) {
  if (token(request).includes("viewer")) return "viewer";
  if (token(request).includes("editor")) return "editor";
  return "owner";
}

function foreign(request) {
  return token(request).includes("foreign");
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function now(version = 1) {
  return `2026-07-19T09:${String(10 + version).padStart(2, "0")}:00.000Z`;
}

function sessionFor(request) {
  if (role(request) === "viewer") return viewerSession;
  if (role(request) === "editor") {
    return { ...ownerSession, actor: { ...ownerSession.actor, role: "editor" } };
  }
  return ownerSession;
}

function jobById(jobId) {
  return mutableJobs.find(({ id }) => id === jobId);
}

function replaceJob(next) {
  mutableJobs = [next, ...mutableJobs.filter(({ id }) => id !== next.id)];
  return next;
}

function progressJob(current) {
  const reads = lifecycleReads.get(current.id) ?? 0;
  const nextState = lifecycle[Math.min(reads + 1, lifecycle.length - 1)];
  lifecycleReads.set(current.id, reads + 1);
  const next = {
    ...current,
    ...(nextState === "succeeded" ? { resultId: ids.result } : {}),
    state: nextState,
    updatedAt: now(reads + 1),
    version: current.version + 1,
  };
  return replaceJob(next);
}

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
    const state = json({
      accessGrants,
      cancels,
      canonicalMutations: 0,
      creates,
      enhancementRequests,
      retries,
      scenario,
    });
    response.writeHead(state.status, state.headers);
    response.end(state.body);
    return;
  }
  if (url.pathname.startsWith("/artifacts/")) {
    const artifactId = url.pathname.split("/").at(-1);
    const expected = artifactBytes(artifactId);
    const bytes =
      scenario === "tampered" && expected ? Buffer.concat([expected, Buffer.from([0])]) : expected;
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    const materialized = [
      ...materializedResult().manifest.artifacts,
      materializedEnhancement().artifact,
    ].find(({ id }) => id === artifactId);
    response.writeHead(200, {
      "access-control-allow-origin": webOrigin,
      "cache-control": "no-store",
      "content-length": String(bytes.length),
      "content-type": materialized.mediaType,
    });
    response.end(bytes);
    return;
  }

  const projectBase = `/v1/projects/${ids.project}`;
  const jobsBase = `${projectBase}/render-jobs`;
  let output;
  if (url.pathname === "/v1/auth/local/session" && request.method === "POST") {
    const payload = await body(request);
    const supported = ["homeowner-alpha", "editor-alpha", "viewer-alpha"].includes(
      payload?.persona,
    );
    const fixtureRole =
      payload?.persona === "viewer-alpha"
        ? "viewer"
        : payload?.persona === "editor-alpha"
          ? "editor"
          : "owner";
    output = supported
      ? json(
          {
            accessToken: `${fixtureRole}-token-deterministic-synthetic-c14-0001`,
            session:
              fixtureRole === "viewer"
                ? viewerSession
                : fixtureRole === "editor"
                  ? { ...ownerSession, actor: { ...ownerSession.actor, role: "editor" } }
                  : ownerSession,
          },
          201,
        )
      : json({ detail: "Unsupported synthetic persona" }, 400);
  } else if (foreign(request)) {
    output = json({ detail: "not found" }, 404);
  } else if (scenario === "expired" && ["/v1/session", projectBase].includes(url.pathname)) {
    output = json({ detail: "PRIVATE_EXPIRED_SESSION" }, 401);
  } else if (url.pathname === "/v1/session") {
    output = json(sessionFor(request));
  } else if (url.pathname === "/v1/projects" && request.method === "GET") {
    output = json([project]);
  } else if (url.pathname === projectBase) {
    output = json(project);
  } else if (url.pathname === `${projectBase}/render-capabilities`) {
    output = json(
      scenario === "provider-disabled"
        ? capabilities
        : scenario === "malformed"
          ? { ...availableCapabilities, privateUnexpected: "PRIVATE_TOKEN" }
          : availableCapabilities,
    );
  } else if (url.pathname === jobsBase && request.method === "GET") {
    output =
      scenario === "service-error"
        ? json({ code: "RENDER_HOST_UNAVAILABLE", detail: "PRIVATE_RENDER_TOKEN" }, 503)
        : json({ jobs: mutableJobs });
  } else if (url.pathname === jobsBase && request.method === "POST") {
    const payload = await body(request);
    if (role(request) === "viewer") {
      output = json({ detail: "read only" }, 403);
    } else {
      creates += 1;
      const created = {
        ...job,
        attempt: 1,
        createdAt: now(1),
        id: uuid(24 + creates),
        request: payload,
        resultId: undefined,
        state: "queued",
        updatedAt: now(1),
        version: 1,
      };
      lifecycleReads.set(created.id, 0);
      output = json(replaceJob(created), 201);
    }
  } else if (url.pathname.startsWith(`${jobsBase}/`)) {
    const remainder = url.pathname.slice(`${jobsBase}/`.length).split("/");
    const [jobId, action, artifactId, accessAction] = remainder;
    const current = jobById(jobId);
    if (!current) {
      output = json({ detail: "not found" }, 404);
    } else if (!action && request.method === "GET") {
      output = json(
        lifecycle.includes(current.state) && current.state !== "succeeded"
          ? progressJob(current)
          : current,
      );
    } else if (action === "result" && request.method === "GET") {
      output =
        current.state === "succeeded"
          ? json(materializedResult(current.id))
          : json({ detail: "not ready" }, 409);
    } else if (action === "cancel" && request.method === "POST") {
      await body(request);
      if (role(request) === "viewer") output = json({ detail: "read only" }, 403);
      else if (scenario === "stale")
        output = json({ code: "STALE_RENDER_JOB", detail: "PRIVATE_VERSION" }, 409);
      else {
        cancels += 1;
        output = json(
          replaceJob({
            ...current,
            state: "cancelled",
            updatedAt: now(current.version + 1),
            version: current.version + 1,
          }),
        );
      }
    } else if (action === "retry" && request.method === "POST") {
      await body(request);
      if (role(request) === "viewer") output = json({ detail: "read only" }, 403);
      else if (scenario === "stale")
        output = json({ code: "STALE_RENDER_JOB", detail: "PRIVATE_VERSION" }, 409);
      else {
        retries += 1;
        const retried = {
          ...current,
          attempt: Math.min(3, current.attempt + 1),
          resultId: undefined,
          safeCode: undefined,
          state: "queued",
          updatedAt: now(current.version + 1),
          version: current.version + 1,
        };
        lifecycleReads.set(current.id, 0);
        output = json(replaceJob(retried));
      }
    } else if (action === "enhancement" && request.method === "GET") {
      output = json(
        scenario === "provider-disabled"
          ? materializedEnhancement("disabled")
          : scenario === "enhancement-failed"
            ? materializedEnhancement("failed")
            : scenario === "enhancement-rejected"
              ? materializedEnhancement("rejected")
              : materializedEnhancement(),
      );
    } else if (action === "enhancement" && request.method === "POST") {
      await body(request);
      if (role(request) === "viewer") output = json({ detail: "read only" }, 403);
      else if (scenario === "provider-disabled") output = json({ code: "PROVIDER_DISABLED" }, 422);
      else {
        enhancementRequests += 1;
        output = json(
          {
            attempt: 1,
            baseArtifactSha256: materializedResult().manifest.artifacts[0].sha256,
            createdAt: now(1),
            createdBy: ids.user,
            id: ids.enhancementJob,
            projectId: ids.project,
            renderJobId: current.id,
            state: "queued",
            updatedAt: now(1),
            version: 1,
          },
          201,
        );
      }
    } else if (action === "artifacts" && accessAction === "access" && request.method === "GET") {
      const all = [
        ...materializedResult(current.id).manifest.artifacts,
        materializedEnhancement().artifact,
      ];
      const artifact = all.find(({ id }) => id === artifactId);
      if (!artifact) output = json({ detail: "not found" }, 404);
      else {
        accessGrants += 1;
        output = json({
          artifactId: artifact.id,
          byteLength: artifact.byteLength,
          expiresAt:
            scenario === "expired-access" ? "2020-01-01T00:00:00.000Z" : "2027-07-19T09:05:00.000Z",
          manifestSha256: result.manifestSha256,
          mediaType: artifact.mediaType,
          role: artifact.role,
          sha256: artifact.sha256,
          url: `http://127.0.0.1:${String(port)}/artifacts/${artifact.id}?grant=${String(accessGrants)}`,
        });
      }
    } else {
      output = json({ detail: "not found" }, 404);
    }
  } else {
    output = json({ detail: "not found" }, 404);
  }

  response.writeHead(output.status, output.headers);
  response.end(output.body);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`C14 deterministic fixture backend listening on ${String(port)}\n`);
});

function close() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
