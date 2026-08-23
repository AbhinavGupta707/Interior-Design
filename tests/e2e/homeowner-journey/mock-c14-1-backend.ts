import {
  c10DefaultCompileConfiguration,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  modelBranchSchema,
  modelCommitSchema,
  modelOperationsPreviewSchema,
  modelSnapshotRecordSchema,
  sceneJobSchema,
  type LocalPersona,
  type MemberRole,
  type Project,
  type Session,
} from "../../../packages/contracts/src/index";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { dossier as c3Dossier } from "../../../apps/web/test/c3/fixtures";
import {
  imageAsset as c8ImageAsset,
  job as c8Job,
  partialResult,
} from "../../../apps/web/test/reconstruction/fixtures";
import {
  branch as c9Branch,
  decision as c9Decision,
  draft as c9Draft,
  job as c9Job,
  project as c9Project,
  proposal as c9Proposal,
  snapshotRecord as c9SnapshotRecord,
} from "../../../apps/web/test/model-fusion/fixtures";

const port = 4336;
const createdProjectId = "e1400000-0000-4000-8000-000000000001";
const committedSnapshotId = "e1400000-0000-4000-8000-000000000002";
const previewId = "e1400000-0000-4000-8000-000000000003";
const commitId = "e1400000-0000-4000-8000-000000000004";
const commitOperationId = "e1400000-0000-4000-8000-000000000005";
const currentSceneJobId = "e1400000-0000-4000-8000-000000000006";
const staleSceneJobId = "e1400000-0000-4000-8000-000000000007";
const staleSceneId = "e1400000-0000-4000-8000-000000000008";
const staleSnapshotId = "e1400000-0000-4000-8000-000000000009";
const resultHash = "e".repeat(64);

type Scenario =
  | "commit-conflict"
  | "commit-expired"
  | "commit-forbidden"
  | "commit-unavailable"
  | "current-unavailable"
  | "normal"
  | "preview-blocked"
  | "preview-expired"
  | "preview-forbidden"
  | "preview-unavailable";

type MutationName = "c5Commit" | "c5Preview" | "c9Draft" | "c9Review" | "c10Create";

interface MutationEntry {
  readonly body: unknown;
  readonly persona: LocalPersona;
}

const personas: Record<
  LocalPersona,
  {
    readonly displayName: string;
    readonly role: MemberRole;
    readonly tenantId: string;
    readonly userId: string;
  }
> = {
  "editor-alpha": {
    displayName: "Alpha editor",
    role: "editor",
    tenantId: c9Project.tenantId,
    userId: "e1400000-0000-4000-8000-000000000101",
  },
  "homeowner-alpha": {
    displayName: "Alpha homeowner",
    role: "owner",
    tenantId: c9Project.tenantId,
    userId: c9Project.tenantId,
  },
  "homeowner-beta": {
    displayName: "Beta homeowner",
    role: "owner",
    tenantId: "e1400000-0000-4000-8000-000000000102",
    userId: "e1400000-0000-4000-8000-000000000103",
  },
  "viewer-alpha": {
    displayName: "Alpha viewer",
    role: "viewer",
    tenantId: c9Project.tenantId,
    userId: "e1400000-0000-4000-8000-000000000104",
  },
};

const baseProject: Project = {
  ...c9Project,
  name: "Synthetic C14.1 bridge home",
  status: "active",
  updatedAt: "2026-08-23T18:00:00.000Z",
};

const createdProject: Project = {
  ...baseProject,
  createdAt: "2026-08-23T18:05:00.000Z",
  id: createdProjectId,
  name: "New synthetic journey",
  updatedAt: "2026-08-23T18:05:00.000Z",
};

const intake = {
  intake: {
    accessibilityNeeds: [],
    dwellingType: "terraced-house",
    evidenceAvailable: {
      photographs: true,
      plans: true,
      roomCapture: false,
      video: true,
    },
    goals: ["Improve the kitchen flow without inventing hidden geometry"],
    household: { adults: 2, children: 0, pets: 0 },
    mustChange: ["Dark circulation"],
    mustKeep: ["Existing fireplace"],
    notes: "Visibly synthetic acceptance fixture.",
    styleWords: ["calm", "warm"],
  },
  projectId: baseProject.id,
  updatedAt: "2026-08-23T18:01:00.000Z",
  updatedBy: personas["homeowner-alpha"].userId,
  version: 1,
};

const dossier = {
  ...c3Dossier,
  property: { ...c3Dossier.property, projectId: baseProject.id },
  sources: c3Dossier.sources.map((source) => ({ ...source, projectId: baseProject.id })),
};

const readyAsset = { ...c8ImageAsset, projectId: baseProject.id };
const reconstructionJob = {
  ...c8Job,
  projectId: baseProject.id,
  resultId: partialResult.resultId,
  state: "completed" as const,
  version: 2,
};
const reconstructionResult = {
  ...partialResult,
  jobId: reconstructionJob.id,
  projectId: baseProject.id,
};

const draft = fusionOperationDraftSchema.parse(c9Draft);
const proposal = fusionProposalSchema.parse({
  ...c9Proposal,
  discrepancies: c9Proposal.discrepancies.map((discrepancy) => ({
    ...discrepancy,
    suggestedOperations: draft.operations,
  })),
});
const fusionJob = fusionJobSchema.parse({
  ...c9Job,
  proposalId: proposal.id,
  state: "proposed",
  updatedAt: "2026-08-23T18:02:00.000Z",
  version: 5,
});

const initialSnapshot = modelSnapshotRecordSchema.parse(c9SnapshotRecord);
const initialBranch = modelBranchSchema.parse(c9Branch);
const committedSnapshot = modelSnapshotRecordSchema.parse({
  ...initialSnapshot,
  createdAt: "2026-08-23T18:03:00.000Z",
  id: committedSnapshotId,
  snapshotSha256: resultHash,
  version: 2,
});
const committedBranch = modelBranchSchema.parse({
  ...initialBranch,
  headSnapshotId: committedSnapshot.id,
  headSnapshotSha256: committedSnapshot.snapshotSha256,
  revision: 1,
  updatedAt: "2026-08-23T18:03:00.000Z",
});

const staleSceneJob = sceneJobSchema.parse({
  attempt: 1,
  createdAt: "2026-08-23T17:00:00.000Z",
  createdBy: personas["homeowner-alpha"].userId,
  id: staleSceneJobId,
  projectId: baseProject.id,
  request: {
    configuration: c10DefaultCompileConfiguration,
    label: "Stale synthetic scene",
    sourceSnapshot: {
      modelId: initialSnapshot.modelId,
      profile: "existing",
      projectId: baseProject.id,
      schemaVersion: "c4-canonical-home-v1",
      snapshotId: staleSnapshotId,
      snapshotSha256: "9".repeat(64),
    },
  },
  sceneId: staleSceneId,
  state: "succeeded",
  updatedAt: "2026-08-23T17:01:00.000Z",
  version: 2,
});

let scenario: Scenario;
let currentBranch: typeof initialBranch;
let currentSnapshot: typeof initialSnapshot;
let projects: Project[];
let sceneJobs: Array<ReturnType<typeof sceneJobSchema.parse>>;
interface MutationLog {
  readonly c5Commit: MutationEntry[];
  readonly c5Preview: MutationEntry[];
  readonly c9Draft: MutationEntry[];
  readonly c9Review: MutationEntry[];
  readonly c10Create: MutationEntry[];
}

let attempts: MutationLog;
let accepted: MutationLog;

function emptyMutations(): MutationLog {
  return { c5Commit: [], c5Preview: [], c9Draft: [], c9Review: [], c10Create: [] };
}

function reset(): void {
  scenario = "normal";
  currentBranch = initialBranch;
  currentSnapshot = initialSnapshot;
  projects = [baseProject];
  sceneJobs = [staleSceneJob];
  attempts = emptyMutations();
  accepted = emptyMutations();
}

reset();

function sessionFor(persona: LocalPersona): Session {
  const actor = personas[persona];
  return {
    actor: {
      displayName: actor.displayName,
      role: actor.role,
      subject: `fixture:c14-1-${persona}`,
      tenantId: actor.tenantId,
      userId: actor.userId,
    },
    authMode: "local-fixture",
    expiresAt: "2099-08-23T20:00:00.000Z",
  };
}

function json(response: ServerResponse, status: number, value?: unknown): void {
  response.writeHead(status, {
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

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    } else {
      throw new TypeError("The synthetic fixture received an unsupported request chunk.");
    }
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") as unknown;
}

function personaFrom(request: IncomingMessage): LocalPersona | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer fixture-token-c14-1-")) return undefined;
  const persona = authorization.slice("Bearer fixture-token-c14-1-".length) as LocalPersona;
  return persona in personas ? persona : undefined;
}

function requirePersona(
  request: IncomingMessage,
  response: ServerResponse,
): LocalPersona | undefined {
  const persona = personaFrom(request);
  if (!persona) {
    problem(
      response,
      401,
      "SESSION_EXPIRED",
      "The synthetic fixture session is missing or expired.",
    );
    return undefined;
  }
  return persona;
}

function isAlpha(persona: LocalPersona): boolean {
  return personas[persona].tenantId === baseProject.tenantId;
}

function isViewer(persona: LocalPersona): boolean {
  return personas[persona].role === "viewer";
}

function record(
  collection: MutationLog,
  name: MutationName,
  persona: LocalPersona,
  body: unknown,
): void {
  collection[name].push({ body, persona });
}

function projectFor(projectId: string, persona: LocalPersona): Project | undefined {
  return isAlpha(persona) ? projects.find((project) => project.id === projectId) : undefined;
}

function isBridgeProject(projectId: string): boolean {
  return projectId === baseProject.id;
}

function modelProfiles(projectId: string): unknown {
  if (!isBridgeProject(projectId) || scenario === "current-unavailable") {
    return {
      profiles: [
        { profile: "existing", status: "empty" },
        { profile: "proposed", status: "empty" },
        { profile: "as-built", status: "empty" },
      ],
      projectId,
    };
  }
  return {
    profiles: [
      {
        currentSnapshotId: currentSnapshot.id,
        currentSnapshotSha256: currentSnapshot.snapshotSha256,
        modelId: currentSnapshot.modelId,
        profile: "existing",
        status: "available",
        updatedAt: currentSnapshot.createdAt,
        version: currentSnapshot.version,
      },
      { profile: "proposed", status: "empty" },
      { profile: "as-built", status: "empty" },
    ],
    projectId,
  };
}

function previewResponse(): ReturnType<typeof modelOperationsPreviewSchema.parse> {
  const blocked = scenario === "preview-blocked";
  return modelOperationsPreviewSchema.parse({
    baseHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
    baseRevision: draft.expectedBranchRevision,
    branchId: draft.branchId,
    canonicalByteLength: 2_048,
    expiresAt:
      scenario === "preview-expired" ? "2020-01-01T00:00:00.000Z" : "2099-08-23T20:00:00.000Z",
    findings: blocked
      ? [
          {
            affectedElementIds: [],
            code: "SPACE_BOUNDARY_OPEN",
            message: "The synthetic boundary is intentionally blocking for acceptance.",
            severity: "error",
          },
        ]
      : [],
    hasBlockingFindings: blocked,
    id: previewId,
    operations: draft.operations,
    projectId: baseProject.id,
    resultSnapshotSha256: resultHash,
  });
}

function commitResponse(persona: LocalPersona): unknown {
  const commit = modelCommitSchema.parse({
    branchId: committedBranch.id,
    committedAt: committedSnapshot.createdAt,
    committedBy: personas[persona].userId,
    id: commitId,
    message: "Homeowner confirmed reviewed reconstruction corrections for exploration",
    operationIds: [commitOperationId],
    parentSnapshotSha256: initialSnapshot.snapshotSha256,
    projectId: baseProject.id,
    revision: committedBranch.revision,
    snapshotId: committedSnapshot.id,
    snapshotSha256: committedSnapshot.snapshotSha256,
  });
  return { branch: committedBranch, commit, findings: [] };
}

function currentSceneJob(
  persona: LocalPersona,
  body: unknown,
): ReturnType<typeof sceneJobSchema.parse> {
  const request = body as { configuration: unknown; label: string; sourceSnapshot: unknown };
  return sceneJobSchema.parse({
    attempt: 1,
    createdAt: "2026-08-23T18:04:00.000Z",
    createdBy: personas[persona].userId,
    id: currentSceneJobId,
    projectId: baseProject.id,
    request,
    state: "queued",
    updatedAt: "2026-08-23T18:04:00.000Z",
    version: 1,
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${String(port)}`);
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
    if (request.method === "POST" && url.pathname === "/__test/scenario") {
      const body = (await readBody(request)) as { value?: Scenario };
      scenario = body.value ?? "normal";
      json(response, 200, { scenario });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__test/state") {
      json(response, 200, {
        accepted,
        attempts,
        currentBranchRevision: currentBranch.revision,
        currentSnapshotId: currentSnapshot.id,
        currentSnapshotSha256: currentSnapshot.snapshotSha256,
        scenario,
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/auth/local/session") {
      const body = (await readBody(request)) as { persona?: LocalPersona };
      if (!body.persona || !(body.persona in personas)) {
        problem(response, 400, "INVALID_PERSONA", "Choose one supported synthetic persona.");
        return;
      }
      json(response, 201, {
        accessToken: `fixture-token-c14-1-${body.persona}`,
        session: sessionFor(body.persona),
      });
      return;
    }

    const persona = requirePersona(request, response);
    if (!persona) return;
    if (request.method === "GET" && url.pathname === "/v1/session") {
      json(response, 200, sessionFor(persona));
      return;
    }
    if (url.pathname === "/v1/projects" && request.method === "GET") {
      json(response, 200, isAlpha(persona) ? projects : []);
      return;
    }
    if (url.pathname === "/v1/projects" && request.method === "POST") {
      if (isViewer(persona)) {
        problem(response, 403, "FORBIDDEN", "Viewer access cannot create projects.");
        return;
      }
      const body = (await readBody(request)) as { name?: string };
      const next = { ...createdProject, name: body.name?.trim() || createdProject.name };
      projects = [...projects.filter(({ id }) => id !== next.id), next];
      json(response, 201, next);
      return;
    }

    const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/u);
    if (request.method === "GET" && projectMatch) {
      const project = projectFor(projectMatch[1] ?? "", persona);
      if (!project) {
        problem(response, 404, "NOT_FOUND", "The synthetic project is unavailable.");
        return;
      }
      json(response, 200, project);
      return;
    }

    const resourceMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/(.+)$/u);
    if (!resourceMatch) {
      problem(response, 404, "NOT_FOUND", "The fixture route does not exist.");
      return;
    }
    const projectId = resourceMatch[1] ?? "";
    const resource = resourceMatch[2] ?? "";
    if (!projectFor(projectId, persona)) {
      problem(response, 404, "NOT_FOUND", "The synthetic project is unavailable.");
      return;
    }

    if (request.method === "GET" && resource === "intake") {
      if (!isBridgeProject(projectId)) {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      json(response, 200, intake);
      return;
    }
    if (request.method === "GET" && resource === "property/dossier") {
      if (!isBridgeProject(projectId)) {
        problem(response, 404, "PROPERTY_NOT_SELECTED", "No property has been selected.");
        return;
      }
      json(response, 200, dossier);
      return;
    }
    if (request.method === "GET" && resource === "assets") {
      json(response, 200, isBridgeProject(projectId) ? [readyAsset] : []);
      return;
    }
    if (request.method === "GET" && resource === "reconstruction-jobs") {
      json(response, 200, { jobs: isBridgeProject(projectId) ? [reconstructionJob] : [] });
      return;
    }
    if (
      request.method === "GET" &&
      resource === `reconstruction-jobs/${reconstructionJob.id}/result`
    ) {
      json(response, 200, reconstructionResult);
      return;
    }
    if (request.method === "GET" && resource === "fusion-jobs") {
      json(response, 200, { jobs: isBridgeProject(projectId) ? [fusionJob] : [] });
      return;
    }
    if (request.method === "GET" && resource === `fusion-jobs/${fusionJob.id}/proposal`) {
      json(response, 200, proposal);
      return;
    }
    if (request.method === "GET" && resource === "models/existing") {
      if (!isBridgeProject(projectId)) {
        problem(response, 404, "MODEL_NOT_FOUND", "No current existing profile is available.");
        return;
      }
      json(response, 200, currentSnapshot);
      return;
    }
    if (request.method === "GET" && resource === "models/existing/branches") {
      json(response, 200, {
        branches: isBridgeProject(projectId) ? [currentBranch] : [],
        profile: "existing",
        projectId,
      });
      return;
    }
    if (request.method === "GET" && resource === "plan-processing-jobs") {
      json(response, 200, { jobs: [] });
      return;
    }
    if (request.method === "GET" && resource === "capture-sessions") {
      json(response, 200, []);
      return;
    }
    if (request.method === "GET" && resource === "models") {
      json(response, 200, modelProfiles(projectId));
      return;
    }
    if (request.method === "GET" && resource === "scene-jobs") {
      json(response, 200, { jobs: isBridgeProject(projectId) ? sceneJobs : [] });
      return;
    }

    if (
      request.method === "POST" &&
      resource === `fusion-jobs/${fusionJob.id}/proposal/discrepancy-decisions`
    ) {
      const body = await readBody(request);
      record(attempts, "c9Review", persona, body);
      if (isViewer(persona)) {
        problem(response, 403, "FORBIDDEN", "Viewer access cannot record decisions.");
        return;
      }
      record(accepted, "c9Review", persona, body);
      const requestDecision = (body as { decisions?: Array<{ choice?: string; reason?: string }> })
        .decisions?.[0];
      json(response, 200, {
        decisions: [
          {
            ...c9Decision,
            choice: requestDecision?.choice ?? "accept-candidate",
            decidedAt: "2026-08-23T18:02:30.000Z",
            decidedBy: personas[persona].userId,
            reason: requestDecision?.reason ?? "Synthetic acceptance decision",
          },
        ],
        proposal,
      });
      return;
    }
    if (
      request.method === "POST" &&
      resource === `fusion-jobs/${fusionJob.id}/proposal/operation-drafts`
    ) {
      const body = await readBody(request);
      record(attempts, "c9Draft", persona, body);
      if (isViewer(persona)) {
        problem(response, 403, "FORBIDDEN", "Viewer access cannot create operation drafts.");
        return;
      }
      record(accepted, "c9Draft", persona, body);
      json(response, 201, draft);
      return;
    }
    if (
      request.method === "POST" &&
      resource === `models/existing/branches/${draft.branchId}/previews`
    ) {
      const body = await readBody(request);
      record(attempts, "c5Preview", persona, body);
      if (isViewer(persona) || scenario === "preview-forbidden") {
        problem(response, 403, "FORBIDDEN", "This role cannot preview canonical mutations.");
        return;
      }
      if (scenario === "preview-unavailable") {
        problem(response, 503, "MODEL_SERVICE_UNAVAILABLE", "The preview service is unavailable.");
        return;
      }
      record(accepted, "c5Preview", persona, body);
      json(response, 201, previewResponse());
      return;
    }
    if (
      request.method === "POST" &&
      resource === `models/existing/branches/${draft.branchId}/commits`
    ) {
      const body = await readBody(request);
      record(attempts, "c5Commit", persona, body);
      if (isViewer(persona) || scenario === "commit-forbidden") {
        problem(response, 403, "FORBIDDEN", "This role cannot commit canonical mutations.");
        return;
      }
      if (scenario === "commit-conflict") {
        json(response, 409, {
          code: "BRANCH_REVISION_CONFLICT",
          currentHeadSnapshotSha256: "f".repeat(64),
          currentRevision: 1,
          detail: "The branch changed after preview.",
          status: 409,
          title: "Branch revision conflict",
          type: "about:blank",
        });
        return;
      }
      if (scenario === "commit-expired") {
        problem(response, 409, "PREVIEW_EXPIRED", "The preview expired before commit.");
        return;
      }
      if (scenario === "commit-unavailable") {
        problem(response, 503, "MODEL_SERVICE_UNAVAILABLE", "The commit service is unavailable.");
        return;
      }
      record(accepted, "c5Commit", persona, body);
      currentBranch = committedBranch;
      currentSnapshot = committedSnapshot;
      json(response, 201, commitResponse(persona));
      return;
    }
    if (request.method === "POST" && resource === "scene-jobs") {
      const body = await readBody(request);
      record(attempts, "c10Create", persona, body);
      if (isViewer(persona)) {
        problem(response, 403, "FORBIDDEN", "Viewer access cannot create scene jobs.");
        return;
      }
      const source = (body as { sourceSnapshot?: { snapshotId?: string; snapshotSha256?: string } })
        .sourceSnapshot;
      const exactCurrentSource =
        source !== undefined &&
        source.snapshotId === currentSnapshot.id &&
        source.snapshotSha256 === currentSnapshot.snapshotSha256;
      if (currentSnapshot.id !== committedSnapshot.id || !exactCurrentSource) {
        problem(
          response,
          409,
          "SCENE_SOURCE_CONFLICT",
          "The requested source is not the exact current existing-profile snapshot.",
        );
        return;
      }
      record(accepted, "c10Create", persona, body);
      const job = currentSceneJob(persona, body);
      sceneJobs = [job, ...sceneJobs];
      json(response, 201, job);
      return;
    }

    problem(response, 404, "NOT_FOUND", "The fixture route does not exist.");
  } catch (error) {
    problem(
      response,
      500,
      "FIXTURE_CONTRACT_ERROR",
      error instanceof Error ? error.message : "The synthetic fixture failed.",
    );
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`C14.1 synthetic backend listening on http://127.0.0.1:${String(port)}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
