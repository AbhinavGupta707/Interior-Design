import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  calibration as c6Calibration,
  job as c6Job,
  proposal as c6Proposal,
} from "../../../apps/web/test/plan-import/fixtures";
import { dossier as c3Dossier } from "../../../apps/web/test/c3/fixtures";

const port = 4342;
const now = "2026-08-23T20:00:00.000Z";
const ids = Object.freeze({
  artifact: "e1420000-0000-4000-8000-00000000000d",
  branch: "e1420000-0000-4000-8000-000000000004",
  calibration: "e1420000-0000-4000-8000-000000000009",
  commit: "e1420000-0000-4000-8000-000000000007",
  committedSnapshot: "e1420000-0000-4000-8000-000000000005",
  draft: "e1420000-0000-4000-8000-00000000000a",
  model: "e1420000-0000-4000-8000-000000000003",
  operation: "e1420000-0000-4000-8000-000000000008",
  owner: "aaaaaaaa-1111-4111-8111-111111111111",
  preview: "e1420000-0000-4000-8000-000000000006",
  project: "e1420000-0000-4000-8000-000000000001",
  property: "e1420000-0000-4000-8000-000000000012",
  scene: "e1420000-0000-4000-8000-00000000000c",
  sceneJob: "e1420000-0000-4000-8000-00000000000b",
  setupSnapshot: "e1420000-0000-4000-8000-000000000002",
  tenant: "11111111-1111-4111-8111-111111111111",
  uploadAsset: "e1420000-0000-4000-8000-000000000010",
  uploadSession: "e1420000-0000-4000-8000-000000000011",
});

type JsonObject = Readonly<Record<string, unknown>>;

interface StoredUpload {
  asset: Record<string, unknown>;
  recordedPartNumbers: number[];
  state: "completed" | "initiated" | "uploading";
}

interface AcceptanceState {
  asset?: Record<string, unknown>;
  branch?: Record<string, unknown>;
  calibration?: JsonObject;
  committedSnapshot?: Record<string, unknown>;
  dossier?: Record<string, unknown>;
  draft?: JsonObject;
  intake?: JsonObject;
  planJob?: Record<string, unknown>;
  preview?: JsonObject;
  project?: Record<string, unknown>;
  sceneJob?: Record<string, unknown>;
  setupRequest?: JsonObject;
  setupSnapshot?: Record<string, unknown>;
  upload?: StoredUpload;
  readonly mutationOrder: string[];
  readonly routeCalls: string[];
}

let state: AcceptanceState;

function reset(): void {
  state = { mutationOrder: [], routeCalls: [] };
}

reset();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("The synthetic backend received an unsupported canonical value.");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(response: ServerResponse, status: number, value?: unknown): void {
  response.writeHead(status, {
    "access-control-allow-origin": "http://127.0.0.1:4341",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

function problem(response: ServerResponse, status: number, code: string, detail: string): void {
  json(response, status, {
    code,
    detail,
    status,
    title: code.replaceAll("_", " "),
    type: "about:blank",
  });
}

async function readBytes(request: IncomingMessage): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readBody(request: IncomingMessage): Promise<JsonObject> {
  const bytes = await readBytes(request);
  return JSON.parse(bytes.toString("utf8") || "{}") as JsonObject;
}

function session(): JsonObject {
  return {
    actor: {
      displayName: "Alpha homeowner",
      role: "owner",
      subject: "fixture:c14-2-homeowner-alpha",
      tenantId: ids.tenant,
      userId: ids.owner,
    },
    authMode: "local-fixture",
    expiresAt: "2099-08-23T20:00:00.000Z",
  };
}

function authorised(request: IncomingMessage): boolean {
  return request.headers.authorization === "Bearer fixture-token-c14-2-homeowner-alpha";
}

function project(name = "Persisted synthetic homeowner journey"): Record<string, unknown> {
  return {
    createdAt: now,
    id: ids.project,
    name,
    status: "draft",
    tenantId: ids.tenant,
    updatedAt: now,
    version: 1,
  };
}

function manualProperty(body: JsonObject): Record<string, unknown> {
  const address = body.address as Record<string, unknown>;
  const displayAddress = [address.line1, address.line2, address.locality, address.postcode]
    .filter(Boolean)
    .join(", ");
  return {
    address,
    displayAddress,
    identifiers: [],
    interiorKnowledgeStatus: "unknown-without-evidence",
    jurisdiction: body.jurisdiction,
    mode: "manual",
    projectId: ids.project,
    propertyId: ids.property,
    selectedAt: now,
    source: {
      coverage: "unknown",
      dataset: "Manual property identity",
      datasetVersion: "c3-manual-1",
      licence: { id: "user-provided", title: "User-provided project data" },
      modelTrainingAllowed: false,
      participantSharingAllowed: true,
      providerId: "user-provided",
      retrievedAt: now,
      serviceProcessingAllowed: true,
    },
    updatedAt: now,
    version: 1,
  };
}

function dossier(propertyValue: Record<string, unknown>): Record<string, unknown> {
  const sources = c3Dossier.sources.map((source) => ({
    ...source,
    projectId: ids.project,
    propertyId: ids.property,
  }));
  return {
    ...c3Dossier,
    generatedAt: now,
    interiorKnowledgeStatus: "unknown-without-evidence",
    items: c3Dossier.items.map((item) =>
      item.key === "property-identity"
        ? {
            ...item,
            classification: "user-assertion",
            note: "A manually entered property identity only; not a surveyed shell or interior.",
            sourceRecordIds: [sources[0]?.id].filter((value): value is string => Boolean(value)),
            value: { kind: "text", value: propertyValue.displayAddress },
          }
        : item,
    ),
    property: propertyValue,
    sources,
    version: 1,
  };
}

function currentSnapshot(): Record<string, unknown> | undefined {
  return state.committedSnapshot ?? state.setupSnapshot;
}

function modelProfiles(): JsonObject {
  const current = currentSnapshot();
  return {
    profiles: [
      current
        ? {
            currentSnapshotId: current.id,
            currentSnapshotSha256: current.snapshotSha256,
            modelId: current.modelId,
            profile: "existing",
            status: "available",
            updatedAt: current.createdAt,
            version: current.version,
          }
        : { profile: "existing", status: "empty" },
      { profile: "proposed", status: "empty" },
      { profile: "as-built", status: "empty" },
    ],
    projectId: ids.project,
  };
}

function planJob(): Record<string, unknown> {
  const asset = state.asset as Record<string, unknown>;
  return {
    ...c6Job,
    assetId: asset.id,
    createdAt: now,
    projectId: ids.project,
    sourceSha256: (asset.source as Record<string, unknown>).sha256,
    updatedAt: now,
  };
}

function planProposal(): Record<string, unknown> {
  const asset = state.asset as Record<string, unknown>;
  return {
    ...c6Proposal,
    createdAt: now,
    jobId: c6Job.id,
    projectId: ids.project,
    source: {
      ...c6Proposal.source,
      assetId: asset.id,
      byteSize: (asset.source as Record<string, unknown>).byteSize,
      projectId: ids.project,
      rights: asset.rights,
      sha256: (asset.source as Record<string, unknown>).sha256,
    },
  };
}

function sceneManifest(sourceSnapshot: JsonObject): JsonObject {
  const levelId = c6Proposal.candidates.find(({ kind }) => kind === "level")?.candidateId;
  const wallId = c6Proposal.candidates.find(({ kind }) => kind === "wall")?.candidateId;
  if (!levelId || !wallId) throw new Error("The synthetic C6 fixture lacks scene elements.");
  return {
    authority: "derived-visualisation-only",
    boundsMm: {
      maximum: { xMm: 8_000, yMm: 6_000, zMm: 2_600 },
      minimum: { xMm: 0, yMm: 0, zMm: 0 },
    },
    compiler: {
      configuration: (state.sceneJob?.request as JsonObject).configuration,
      configurationSha256: "4".repeat(64),
      name: "interior-design-scene-compiler",
      version: "synthetic-acceptance-only-1",
    },
    coordinateSystem: {
      canonicalAxes: "+X east, +Y north, +Z up",
      gltfAxes: "+Y up, +Z forward, right-handed",
      mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
      outputLengthUnit: "metre",
    },
    counts: { materials: 1, meshes: 1, nodes: 2, triangles: 12, vertices: 8 },
    determinismKeySha256: "5".repeat(64),
    elementMappings: [
      {
        elementId: levelId,
        elementType: "level",
        findingCodes: [],
        materialIndices: [],
        meshIndices: [],
        nodeIndices: [0],
        status: "mapped",
      },
      {
        elementId: wallId,
        elementType: "wall",
        findingCodes: ["SYNTHETIC_ACCEPTANCE_ONLY"],
        materialIndices: [0],
        meshIndices: [0],
        nodeIndices: [1],
        status: "mapped",
      },
    ],
    findings: [
      {
        affectedElementIds: [wallId],
        code: "SYNTHETIC_ACCEPTANCE_ONLY",
        detail: "This is deterministic rendered software evidence, not live-backend evidence.",
        severity: "information",
      },
    ],
    gltf: { container: "GLB", specificationVersion: "2.0" },
    schemaVersion: "c10-scene-manifest-v1",
    sourceSnapshot,
  };
}

function sceneRecord(): JsonObject {
  const sourceSnapshot = (state.sceneJob?.request as JsonObject).sourceSnapshot as JsonObject;
  const manifest = sceneManifest(sourceSnapshot);
  return {
    artifact: {
      byteSize: 256,
      glbSha256: "3".repeat(64),
      id: ids.artifact,
      manifestSha256: sha256(canonicalJson(manifest)),
      mimeType: "model/gltf-binary",
      schemaVersion: "c10-scene-artifact-v1",
    },
    createdAt: now,
    createdBy: ids.owner,
    id: ids.scene,
    manifest,
    projectId: ids.project,
  };
}

function stateSummary(): JsonObject {
  const setup = state.setupRequest;
  const snapshot = setup?.snapshot as JsonObject | undefined;
  const elements = snapshot?.elements as JsonObject | undefined;
  const routeCalls = [...state.routeCalls];
  return {
    asset: state.asset,
    branch: state.branch,
    c8V2Invocations: routeCalls.filter((route) => /c8[-_/]?v2|reconstruction-v2/iu.test(route)),
    calibration: state.calibration,
    currentSnapshotId: currentSnapshot()?.id,
    currentSnapshotSha256: currentSnapshot()?.snapshotSha256,
    dossier: state.dossier,
    draft: state.draft,
    intake: state.intake,
    mutationOrder: [...state.mutationOrder],
    planJob: state.planJob,
    preview: state.preview,
    routeCalls,
    sceneJob: state.sceneJob,
    setup: setup
      ? {
          actorUserId: ((elements?.levels as JsonObject[] | undefined)?.[0]?.origin as JsonObject)
            ?.actorUserId,
          coordinateSystem: snapshot?.coordinateSystem,
          elements,
          expectedCurrentSnapshotSha256: setup.expectedCurrentSnapshotSha256,
          projectId: snapshot?.projectId,
          propertyId: snapshot?.propertyId,
        }
      : undefined,
  };
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${String(port)}`);
  state.routeCalls.push(`${request.method ?? "GET"} ${url.pathname}`);
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type,x-amz-checksum-sha256",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "access-control-allow-origin": "http://127.0.0.1:4341",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      reset();
      json(response, 200, { reset: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__test/state") {
      json(response, 200, stateSummary());
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/auth/local/session") {
      const body = await readBody(request);
      if (body.persona !== "homeowner-alpha" || Object.keys(body).length !== 1) {
        problem(response, 400, "INVALID_PERSONA", "Choose the supported synthetic homeowner.");
        return;
      }
      json(response, 201, {
        accessToken: "fixture-token-c14-2-homeowner-alpha",
        session: session(),
      });
      return;
    }
    const storage = url.pathname.match(/^\/__storage\/([^/]+)\/(\d+)$/u);
    if (request.method === "PUT" && storage) {
      const bytes = await readBytes(request);
      const expected = request.headers["x-amz-checksum-sha256"];
      const actual = createHash("sha256").update(bytes).digest("base64");
      if (expected !== actual) {
        problem(response, 400, "CHECKSUM_MISMATCH", "The upload part checksum did not match.");
        return;
      }
      if (state.upload) {
        state.upload.recordedPartNumbers = [Number(storage[2])];
        state.upload.state = "uploading";
        state.upload.asset.status = "uploading";
      }
      response.writeHead(200, {
        "access-control-allow-origin": "http://127.0.0.1:4341",
        "access-control-expose-headers": "ETag",
        etag: '"synthetic-part-1"',
      });
      response.end();
      return;
    }
    if (!authorised(request)) {
      problem(response, 401, "SESSION_EXPIRED", "The synthetic session is unavailable.");
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/session") {
      json(response, 200, session());
      return;
    }
    if (url.pathname === "/v1/projects" && request.method === "GET") {
      json(response, 200, state.project ? [state.project] : []);
      return;
    }
    if (url.pathname === "/v1/projects" && request.method === "POST") {
      const body = await readBody(request);
      state.project = project(typeof body.name === "string" ? body.name.trim() : undefined);
      state.mutationOrder.push("project.create");
      json(response, 201, state.project);
      return;
    }
    const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/u);
    if (request.method === "GET" && projectMatch) {
      if (!state.project || projectMatch[1] !== ids.project) {
        problem(response, 404, "NOT_FOUND", "The synthetic project is unavailable.");
        return;
      }
      json(response, 200, state.project);
      return;
    }
    const resourceMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/(.+)$/u);
    if (!resourceMatch || resourceMatch[1] !== ids.project || !state.project) {
      problem(response, 404, "NOT_FOUND", "The synthetic project is unavailable.");
      return;
    }
    const resource = resourceMatch[2] ?? "";

    if (resource === "intake" && request.method === "GET") {
      if (!state.intake) {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
      } else json(response, 200, state.intake);
      return;
    }
    if (resource === "intake" && request.method === "PUT") {
      const body = await readBody(request);
      state.intake = {
        intake: body.intake,
        projectId: ids.project,
        updatedAt: now,
        updatedBy: ids.owner,
        version: 1,
      };
      state.mutationOrder.push("intake.persist");
      json(response, 200, state.intake);
      return;
    }
    if (resource === "property/dossier" && request.method === "GET") {
      if (!state.dossier) {
        problem(response, 404, "PROPERTY_NOT_SELECTED", "No property identity is selected.");
      } else json(response, 200, state.dossier);
      return;
    }
    if (resource === "property" && request.method === "PUT") {
      const body = await readBody(request);
      if (body.mode !== "manual") {
        problem(response, 400, "MANUAL_REQUIRED", "This lane accepts manual property identity.");
        return;
      }
      const propertyValue = manualProperty(body);
      state.dossier = dossier(propertyValue);
      state.mutationOrder.push("property.manual");
      json(response, 200, propertyValue);
      return;
    }
    if (resource === "property/source-records" && request.method === "GET") {
      json(response, 200, state.dossier?.sources ?? []);
      return;
    }
    if (resource === "assets" && request.method === "GET") {
      json(response, 200, state.asset ? [state.asset] : []);
      return;
    }
    if (resource === "assets/upload-sessions" && request.method === "POST") {
      const body = await readBody(request);
      const asset: Record<string, unknown> = {
        createdAt: now,
        declaredMimeType: body.declaredMimeType,
        fileName: body.fileName,
        id: ids.uploadAsset,
        kind: body.kind,
        projectId: ids.project,
        rights: body.rights,
        source: { byteSize: body.byteSize, sha256: body.sha256 },
        status: "pending-upload",
        updatedAt: now,
      };
      state.upload = { asset, recordedPartNumbers: [], state: "initiated" };
      state.asset = asset;
      state.mutationOrder.push("evidence.upload-start");
      json(response, 201, {
        asset,
        expiresAt: "2099-08-23T21:00:00.000Z",
        maximumPartCount: 10_000,
        minimumNonFinalPartSize: 5_242_880,
        partSize: 5_242_880,
        recordedPartNumbers: [],
        sessionId: ids.uploadSession,
        state: "initiated",
      });
      return;
    }
    if (resource === `assets/upload-sessions/${ids.uploadSession}` && request.method === "GET") {
      if (!state.upload) {
        problem(response, 404, "NOT_FOUND", "The upload session is unavailable.");
        return;
      }
      json(response, 200, {
        asset: state.upload.asset,
        expiresAt: "2099-08-23T21:00:00.000Z",
        maximumPartCount: 10_000,
        minimumNonFinalPartSize: 5_242_880,
        partSize: 5_242_880,
        recordedPartNumbers: state.upload.recordedPartNumbers,
        sessionId: ids.uploadSession,
        state: state.upload.state,
      });
      return;
    }
    if (resource === `assets/upload-sessions/${ids.uploadSession}/parts` && request.method === "POST") {
      const body = await readBody(request);
      if (!state.upload) throw new Error("Upload state is missing.");
      state.upload.state = "uploading";
      state.upload.asset.status = "uploading";
      json(response, 200, {
        expiresAt: "2099-08-23T20:15:00.000Z",
        partNumber: body.partNumber,
        requiredHeaders: { "x-amz-checksum-sha256": body.checksumSha256 },
        url: `http://127.0.0.1:${String(port)}/__storage/${ids.uploadSession}/${String(body.partNumber)}`,
      });
      return;
    }
    if (resource === `assets/upload-sessions/${ids.uploadSession}/complete` && request.method === "POST") {
      const body = await readBody(request);
      if (!state.upload || body.sha256 !== (state.upload.asset.source as JsonObject).sha256) {
        problem(response, 409, "CHECKSUM_MISMATCH", "The final asset checksum did not match.");
        return;
      }
      state.upload.state = "completed";
      state.upload.asset.status = "ready";
      state.upload.asset.detectedMimeType = state.upload.asset.declaredMimeType;
      state.asset = state.upload.asset;
      state.mutationOrder.push("evidence.ready");
      json(response, 200, state.asset);
      return;
    }
    const assetAccess = resource.match(/^assets\/([^/]+)\/access$/u);
    if (assetAccess && request.method === "POST" && state.asset?.id === assetAccess[1]) {
      json(response, 200, {
        contentDisposition: "inline",
        expiresAt: "2099-08-23T20:10:00.000Z",
        url: `http://127.0.0.1:${String(port)}/synthetic-preview/${ids.uploadAsset}`,
      });
      return;
    }
    if (resource === "models/existing" && request.method === "GET") {
      const current = currentSnapshot();
      if (!current) problem(response, 404, "MODEL_NOT_FOUND", "No existing profile is available.");
      else json(response, 200, current);
      return;
    }
    if (resource === "models" && request.method === "GET") {
      json(response, 200, modelProfiles());
      return;
    }
    if (resource === "models/existing/snapshots" && request.method === "POST") {
      const body = await readBody(request);
      if (!state.dossier) {
        problem(response, 409, "PROPERTY_NOT_SELECTED", "Select a property first.");
        return;
      }
      const snapshot = body.snapshot as JsonObject;
      state.setupRequest = body;
      state.setupSnapshot = {
        createdAt: now,
        createdBy: ids.owner,
        id: ids.setupSnapshot,
        modelId: snapshot.modelId,
        profile: "existing",
        projectId: ids.project,
        snapshot,
        snapshotSha256: "1".repeat(64),
        version: 1,
      };
      state.branch = {
        createdAt: now,
        createdBy: ids.owner,
        headSnapshotId: ids.setupSnapshot,
        headSnapshotSha256: "1".repeat(64),
        id: ids.branch,
        modelId: snapshot.modelId,
        name: "Main",
        profile: "existing",
        projectId: ids.project,
        revision: 1,
        schemaVersion: "c5-model-branch-v1",
        sourceSnapshotId: ids.setupSnapshot,
        updatedAt: now,
      };
      state.mutationOrder.push("model.acknowledged-setup");
      json(response, 201, state.setupSnapshot);
      return;
    }
    if (resource === "models/existing/branches" && request.method === "GET") {
      json(response, 200, {
        branches: state.branch ? [state.branch] : [],
        profile: "existing",
        projectId: ids.project,
      });
      return;
    }
    const exactSnapshot = resource.match(/^models\/existing\/snapshots\/([^/]+)$/u);
    if (exactSnapshot && request.method === "GET") {
      const found = [state.setupSnapshot, state.committedSnapshot].find(
        (snapshot) => snapshot?.id === exactSnapshot[1],
      );
      if (!found) problem(response, 404, "NOT_FOUND", "The exact snapshot is unavailable.");
      else json(response, 200, found);
      return;
    }
    const exactBranch = resource.match(/^models\/existing\/branches\/([^/]+)$/u);
    if (exactBranch && request.method === "GET") {
      if (!state.branch || state.branch.id !== exactBranch[1]) {
        problem(response, 404, "NOT_FOUND", "The exact branch is unavailable.");
      } else json(response, 200, state.branch);
      return;
    }
    if (resource === "plan-processing-jobs" && request.method === "GET") {
      json(response, 200, { jobs: state.planJob ? [state.planJob] : [] });
      return;
    }
    if (resource === "plan-processing-jobs" && request.method === "POST") {
      if (!state.setupSnapshot || !state.asset) {
        problem(response, 409, "SETUP_REQUIRED", "Setup and ready plan evidence are required.");
        return;
      }
      state.planJob = planJob();
      state.mutationOrder.push("c6.proposal");
      json(response, 201, state.planJob);
      return;
    }
    if (resource === `plan-processing-jobs/${c6Job.id}` && request.method === "GET") {
      json(response, 200, state.planJob);
      return;
    }
    if (resource === `plan-processing-jobs/${c6Job.id}/proposal` && request.method === "GET") {
      json(response, 200, planProposal());
      return;
    }
    if (
      resource === `plan-processing-jobs/${c6Job.id}/proposal/calibrations` &&
      request.method === "POST"
    ) {
      const body = await readBody(request);
      state.calibration = {
        ...c6Calibration,
        createdAt: now,
        createdBy: ids.owner,
        evidence: body.evidence,
        id: ids.calibration,
        jobId: c6Job.id,
        projectId: ids.project,
        proposalId: c6Proposal.proposalId,
      };
      state.mutationOrder.push("c6.calibration");
      json(response, 201, state.calibration);
      return;
    }
    if (
      resource === `plan-processing-jobs/${c6Job.id}/proposal/operation-drafts` &&
      request.method === "POST"
    ) {
      const body = await readBody(request);
      const decisions = body.decisions as ReadonlyArray<JsonObject>;
      const counts = { accepted: 0, corrected: 0, excluded: 0, unresolved: 0 };
      for (const decision of decisions) {
        const key = decision.decision as keyof typeof counts;
        counts[key] += 1;
      }
      state.draft = {
        acknowledgedFindingCodes: body.acknowledgedFindingCodes,
        calibrationId: body.calibrationId,
        createdAt: now,
        createdBy: ids.owner,
        decisions,
        id: ids.draft,
        jobId: c6Job.id,
        metrics: {
          acceptedCount: counts.accepted,
          correctedCount: counts.corrected,
          excludedCount: counts.excluded,
          reviewDurationMilliseconds: body.reviewDurationMilliseconds,
          unresolvedCount: counts.unresolved,
        },
        operations: body.operations,
        projectId: ids.project,
        proposalId: c6Proposal.proposalId,
        schemaVersion: "c6-plan-operation-draft-v1",
        target: body.target,
      };
      state.mutationOrder.push("c6.draft");
      json(response, 201, state.draft);
      return;
    }
    const previewMatch = resource.match(/^models\/existing\/branches\/([^/]+)\/previews$/u);
    if (previewMatch && request.method === "POST") {
      const body = await readBody(request);
      state.preview = {
        baseHeadSnapshotSha256: body.expectedHeadSnapshotSha256,
        baseRevision: body.expectedRevision,
        branchId: ids.branch,
        canonicalByteLength: 4_096,
        expiresAt: "2099-08-23T21:00:00.000Z",
        findings: [],
        hasBlockingFindings: false,
        id: ids.preview,
        operations: body.operations,
        projectId: ids.project,
        resultSnapshotSha256: "2".repeat(64),
      };
      state.mutationOrder.push("c5.preview");
      json(response, 201, state.preview);
      return;
    }
    const commitMatch = resource.match(/^models\/existing\/branches\/([^/]+)\/commits$/u);
    if (commitMatch && request.method === "POST") {
      const body = await readBody(request);
      if (body.previewId !== ids.preview || !state.preview || !state.setupSnapshot || !state.branch) {
        problem(response, 409, "PREVIEW_REQUIRED", "Commit requires the exact current preview.");
        return;
      }
      state.committedSnapshot = {
        ...state.setupSnapshot,
        createdAt: "2026-08-23T20:10:00.000Z",
        id: ids.committedSnapshot,
        snapshotSha256: "2".repeat(64),
        version: 2,
      };
      state.branch = {
        ...state.branch,
        headSnapshotId: ids.committedSnapshot,
        headSnapshotSha256: "2".repeat(64),
        revision: 2,
        updatedAt: "2026-08-23T20:10:00.000Z",
      };
      state.mutationOrder.push("c5.commit");
      json(response, 201, {
        branch: state.branch,
        commit: {
          branchId: ids.branch,
          committedAt: "2026-08-23T20:10:00.000Z",
          committedBy: ids.owner,
          id: ids.commit,
          message: body.commitMessage,
          operationIds: [ids.operation],
          parentSnapshotSha256: "1".repeat(64),
          projectId: ids.project,
          revision: 2,
          snapshotId: ids.committedSnapshot,
          snapshotSha256: "2".repeat(64),
        },
        findings: [],
      });
      return;
    }
    if (resource === "reconstruction-jobs" && request.method === "GET") {
      json(response, 200, { jobs: [] });
      return;
    }
    if (resource === "fusion-jobs" && request.method === "GET") {
      json(response, 200, { jobs: [] });
      return;
    }
    if (resource === "capture-sessions" && request.method === "GET") {
      json(response, 200, []);
      return;
    }
    if (resource === "scene-jobs" && request.method === "GET") {
      json(response, 200, { jobs: state.sceneJob ? [state.sceneJob] : [] });
      return;
    }
    if (resource === "scene-jobs" && request.method === "POST") {
      const body = await readBody(request);
      const source = body.sourceSnapshot as JsonObject;
      if (
        !state.committedSnapshot ||
        source.snapshotId !== state.committedSnapshot.id ||
        source.snapshotSha256 !== state.committedSnapshot.snapshotSha256 ||
        source.profile !== "existing"
      ) {
        problem(response, 409, "SCENE_SOURCE_CONFLICT", "Use the exact current committed snapshot.");
        return;
      }
      state.sceneJob = {
        attempt: 1,
        createdAt: "2026-08-23T20:11:00.000Z",
        createdBy: ids.owner,
        id: ids.sceneJob,
        projectId: ids.project,
        request: body,
        sceneId: ids.scene,
        state: "succeeded",
        updatedAt: "2026-08-23T20:12:00.000Z",
        version: 2,
      };
      state.mutationOrder.push("c10.scene");
      json(response, 201, state.sceneJob);
      return;
    }
    if (resource === `scene-jobs/${ids.sceneJob}` && request.method === "GET") {
      json(response, 200, state.sceneJob);
      return;
    }
    if (resource === `scene-jobs/${ids.sceneJob}/scene` && request.method === "GET") {
      json(response, 200, sceneRecord());
      return;
    }
    if (resource === `scene-jobs/${ids.sceneJob}/scene/access` && request.method === "POST") {
      const scene = sceneRecord();
      const artifact = scene.artifact as JsonObject;
      json(response, 200, {
        byteSize: artifact.byteSize,
        expiresAt: "2099-08-23T20:20:00.000Z",
        glbSha256: artifact.glbSha256,
        manifestSha256: artifact.manifestSha256,
        mimeType: "model/gltf-binary",
        sceneId: ids.scene,
        url: `http://127.0.0.1:${String(port)}/synthetic-scene/${ids.scene}.glb`,
      });
      return;
    }
    problem(response, 404, "NOT_FOUND", "The deterministic synthetic route is unavailable.");
  } catch (error) {
    problem(
      response,
      500,
      "SYNTHETIC_BACKEND_ERROR",
      error instanceof Error ? error.message : "The deterministic synthetic backend failed.",
    );
  }
}

const server = createServer((request, response) => {
  void handle(request, response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`C14.2 synthetic backend listening on http://127.0.0.1:${String(port)}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
