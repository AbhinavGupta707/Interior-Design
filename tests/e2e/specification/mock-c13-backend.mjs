import { execFileSync } from "node:child_process";
import http from "node:http";

execFileSync("pnpm", ["--filter", "@interior-design/contracts", "build"], {
  stdio: "ignore",
});

const fixtures = await import("../../../apps/web/test/materials-products/fixtures.ts");
const {
  assetsResponse,
  chairAsset,
  confirmation,
  ids,
  ownerSession,
  preview,
  project,
  release,
  releasesResponse,
  scheduleResponse,
  sofaAsset,
  specification,
  specificationRevisionTwo,
  specificationsResponse,
  viewerSession,
  withdrawnAsset,
} = fixtures;

const port = 4351;
let scenario = "ready";
let currentSpecification = structuredClone(specification);
let confirmations = 0;
let previewRequests = 0;
let boardUpdates = 0;

function reset(value = "ready") {
  scenario = value;
  currentSpecification = structuredClone(specification);
  confirmations = 0;
  previewRequests = 0;
  boardUpdates = 0;
}

function json(value, status = 200) {
  return {
    body: JSON.stringify(value),
    headers: { "cache-control": "no-store", "content-type": "application/json" },
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

function alternative(index) {
  const versionId = fixtures.uuid(500 + index);
  return {
    ...chairAsset,
    assetId: versionId,
    description: `Deterministic creator-authored catalog alternative ${index}.`,
    displayName: `Generic lounge alternative ${index}`,
    placementProjection: {
      ...chairAsset.placementProjection,
      c12Asset: {
        ...chairAsset.placementProjection.c12Asset,
        id: versionId,
        versionId,
      },
    },
    versionId,
  };
}

const catalogAssets = [
  ...assetsResponse.assets,
  ...Array.from({ length: 9 }, (_, index) => alternative(index + 1)),
];
const releasePath = `/v1/projects/${ids.project}/catalog/releases`;
const specificationPath = `/v1/projects/${ids.project}/specifications`;

function filteredAssets(url) {
  const kind = url.searchParams.get("kind") ?? "all";
  const source = url.searchParams.get("source") ?? "all";
  const rights = url.searchParams.get("rights") ?? "all";
  const query = (url.searchParams.get("query") ?? "").toLowerCase();
  const filtered = catalogAssets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false;
    if (source !== "all" && asset.rights.sourceKind !== source) return false;
    if (rights !== "all" && asset.rights.review.state !== rights) return false;
    if (
      query &&
      !`${asset.displayName} ${asset.category} ${asset.description}`.toLowerCase().includes(query)
    )
      return false;
    return true;
  });
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "9"), 24);
  const start = url.searchParams.get("cursor") === "page-2" ? limit : 0;
  return {
    assets: filtered.slice(start, start + limit),
    ...(start + limit < filtered.length ? { nextCursor: "page-2" } : {}),
    releaseId: ids.release,
    total: filtered.length,
  };
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
    const result = json({
      asBuiltProfileMutations: 0,
      boardUpdates,
      confirmations,
      existingProfileMutations: 0,
      previewRequests,
      specificationRevision: currentSpecification.currentRevision.revision,
    });
    response.writeHead(result.status, result.headers);
    response.end(result.body);
    return;
  }

  let result;
  if (url.pathname === "/v1/auth/local/session" && request.method === "POST") {
    const payload = await body(request);
    result =
      payload?.persona === "homeowner-alpha"
        ? json(
            {
              accessToken: "owner-token-deterministic-synthetic-c13-0001",
              session: ownerSession,
            },
            201,
          )
        : json({ detail: "Unsupported synthetic persona" }, 400);
  } else if (foreign(request)) {
    result = json({ detail: "Not found", status: 404, title: "Not found" }, 404);
  } else if (url.pathname === "/v1/session") {
    result =
      scenario === "expired"
        ? json({ detail: "expired" }, 401)
        : json(
            role(request) === "viewer"
              ? viewerSession
              : role(request) === "editor"
                ? { ...ownerSession, actor: { ...ownerSession.actor, role: "editor" } }
                : ownerSession,
          );
  } else if (url.pathname === `/v1/projects/${ids.project}`) {
    result = scenario === "expired" ? json({ detail: "expired" }, 401) : json(project);
  } else if (url.pathname === releasePath && request.method === "GET") {
    result =
      scenario === "service-error"
        ? json({ detail: "PRIVATE_RIGHTS_AND_TOKEN", token: "PRIVATE" }, 503)
        : json(releasesResponse);
  } else if (url.pathname === `${releasePath}/${ids.release}` && request.method === "GET") {
    result = json(release);
  } else if (url.pathname === `${releasePath}/${ids.release}/assets` && request.method === "GET") {
    if (scenario === "missing-artifacts") {
      result = json({
        ...filteredAssets(url),
        assets: [
          {
            ...chairAsset,
            artifacts: chairAsset.artifacts.filter(
              ({ role }) => role !== "model" && role !== "thumbnail",
            ),
          },
        ],
        total: 1,
      });
    } else {
      result = json(filteredAssets(url));
    }
  } else if (
    url.pathname.startsWith(`${releasePath}/${ids.release}/assets/`) &&
    request.method === "GET"
  ) {
    const assetId = url.pathname.split("/").at(-1);
    const asset = catalogAssets.find(({ versionId }) => versionId === assetId);
    result = asset ? json(asset) : json({ detail: "not found" }, 404);
  } else if (url.pathname === specificationPath && request.method === "GET") {
    result = json({ ...specificationsResponse, specifications: [currentSpecification] });
  } else if (
    url.pathname === `${specificationPath}/from-c12-confirmation` &&
    request.method === "POST"
  ) {
    await body(request);
    result = json(currentSpecification, 201);
  } else if (
    url.pathname === `${specificationPath}/${ids.specification}` &&
    request.method === "GET"
  ) {
    result = json(currentSpecification);
  } else if (
    url.pathname === `${specificationPath}/${ids.specification}/revisions` &&
    request.method === "GET"
  ) {
    result = json({
      revisions:
        currentSpecification.currentRevision.revision === 1
          ? [currentSpecification.currentRevision]
          : [specification.currentRevision, currentSpecification.currentRevision],
      specificationId: ids.specification,
    });
  } else if (
    url.pathname === `${specificationPath}/${ids.specification}/schedule-lines` &&
    request.method === "GET"
  ) {
    result = json({
      ...scheduleResponse,
      lines: currentSpecification.currentRevision.lines,
      revision: currentSpecification.currentRevision.revision,
    });
  } else if (
    url.pathname === `${specificationPath}/${ids.specification}/selection-board` &&
    request.method === "PUT"
  ) {
    await body(request);
    if (role(request) === "viewer") {
      result = json({ detail: "read only" }, 403);
    } else if (scenario === "stale-board") {
      result = json({ code: "STALE_SPEC", detail: "PRIVATE_NOTE" }, 409);
    } else {
      boardUpdates += 1;
      currentSpecification = structuredClone(specificationRevisionTwo);
      result = json(currentSpecification);
    }
  } else if (
    url.pathname === `${specificationPath}/${ids.specification}/substitutions` &&
    request.method === "POST"
  ) {
    await body(request);
    if (scenario === "stale-preview") {
      result = json({ code: "STALE_RIGHTS", detail: "PRIVATE_RIGHTS_RECEIPT" }, 409);
    } else {
      if (scenario === "slow-preview") {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      previewRequests += 1;
      result = json(preview, 201);
    }
  } else if (
    url.pathname === `${specificationPath}/${ids.specification}/substitutions/${ids.preview}` &&
    request.method === "GET"
  ) {
    result = json(preview);
  } else if (
    url.pathname ===
      `${specificationPath}/${ids.specification}/substitutions/${ids.preview}/confirm` &&
    request.method === "POST"
  ) {
    await body(request);
    if (role(request) === "viewer") {
      result = json({ detail: "read only" }, 403);
    } else if (scenario === "expired-preview") {
      result = json({ code: "PREVIEW_EXPIRED", detail: "PRIVATE_PREVIEW" }, 410);
    } else {
      confirmations += 1;
      currentSpecification = structuredClone(specificationRevisionTwo);
      result = json(confirmation, 201);
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
