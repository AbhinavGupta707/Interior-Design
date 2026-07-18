import http from "node:http";

const port = 4331;
const ids = Object.freeze({
  asset: "d1100000-0000-4000-8000-000000000001",
  brief: "d1100000-0000-4000-8000-000000000002",
  entries: [
    "d1100000-0000-4000-8000-000000000011",
    "d1100000-0000-4000-8000-000000000012",
    "d1100000-0000-4000-8000-000000000013",
    "d1100000-0000-4000-8000-000000000014",
    "d1100000-0000-4000-8000-000000000015",
    "d1100000-0000-4000-8000-000000000016",
    "d1100000-0000-4000-8000-000000000017",
  ],
  message: "d1100000-0000-4000-8000-000000000021",
  owner: "d1100000-0000-4000-8000-000000000003",
  project: "d1100000-0000-4000-8000-000000000004",
  proposal: "d1100000-0000-4000-8000-000000000005",
  reference: "d1100000-0000-4000-8000-000000000006",
  session: "d1100000-0000-4000-8000-000000000007",
  tenant: "d1100000-0000-4000-8000-000000000008",
  viewer: "d1100000-0000-4000-8000-000000000009",
});

const capturedAt = "2026-07-18T09:00:00.000Z";
const baseEntries = Object.freeze([
  {
    category: "retained-item",
    classification: "observed-evidence",
    id: ids.entries[0],
    priority: 5,
    provenance: { assetId: ids.asset, capturedAt, method: "evidence-linked" },
    roomOrLevelElementIds: [],
    statement: "The oak dining table appears in immutable source evidence.",
    status: "active",
  },
  {
    category: "storage",
    classification: "household-assertion",
    id: ids.entries[1],
    priority: 4,
    provenance: { capturedAt, method: "user-stated", statedByUserId: ids.owner },
    roomOrLevelElementIds: [],
    statement: "Two adults share the entrance storage.",
    status: "active",
  },
  {
    category: "minimum-dimension",
    classification: "hard-constraint",
    id: ids.entries[2],
    priority: 5,
    provenance: { capturedAt, method: "user-stated", statedByUserId: ids.owner },
    roomOrLevelElementIds: [],
    statement: "Keep an unobstructed circulation route beside the retained table.",
    status: "active",
  },
  {
    category: "material-colour",
    classification: "preference",
    id: ids.entries[3],
    priority: 3,
    provenance: { capturedAt, method: "user-stated", statedByUserId: ids.owner },
    roomOrLevelElementIds: [],
    statement: "Prefer calm mineral colours and visible timber grain.",
    status: "active",
  },
  {
    category: "other",
    classification: "inferred-suggestion",
    id: ids.entries[4],
    priority: 2,
    provenance: { capturedAt, method: "assistant-suggested", sourceMessageId: ids.message },
    roomOrLevelElementIds: [],
    statement: "Consider layered evening lighting near the dining area.",
    status: "active",
  },
  {
    category: "adjacency",
    classification: "unresolved-conflict",
    id: ids.entries[5],
    priority: 4,
    provenance: { capturedAt, method: "assistant-extracted", sourceMessageId: ids.message },
    roomOrLevelElementIds: [],
    statement: "A wider route may conflict with keeping the table in its current position.",
    status: "active",
  },
  {
    category: "professional-review",
    classification: "unknown",
    id: ids.entries[6],
    priority: 5,
    provenance: { capturedAt, method: "assistant-extracted", sourceMessageId: ids.message },
    roomOrLevelElementIds: [],
    statement: "The structural role of the nib beside the opening is unknown.",
    status: "active",
  },
]);

let scenario = "ready";
let brief;
let activeSession;
let activeProposal;
let c11BriefMutations = 0;
let cancelFailuresRemaining = 0;

function resetState() {
  brief =
    scenario === "no-brief"
      ? undefined
      : {
          createdAt: capturedAt,
          entries: scenario === "empty" ? [] : structuredClone(baseEntries),
          id: ids.brief,
          projectId: ids.project,
          referenceBoard:
            scenario === "empty"
              ? []
              : [
                  {
                    assetId: ids.asset,
                    id: ids.reference,
                    note: "Like the calm palette; aesthetic context only.",
                    rightsRecordSha256: "a".repeat(64),
                    sentiment: "like",
                  },
                ],
          revision: 3,
          schemaVersion: "c11-design-brief-v1",
          status: "draft",
          updatedAt: capturedAt,
          updatedBy: ids.owner,
        };
  activeSession = undefined;
  activeProposal = undefined;
  c11BriefMutations = 0;
  cancelFailuresRemaining = scenario === "cancel-error-after-update" ? 1 : 0;
}

resetState();

function role(request) {
  return (request.headers.authorization ?? "").includes("viewer-token") ? "viewer" : "owner";
}

function foreign(request) {
  return (request.headers.authorization ?? "").includes("foreign-token");
}

function session(request) {
  const actorRole = role(request);
  return {
    actor: {
      displayName: actorRole === "viewer" ? "Synthetic C11 viewer" : "Synthetic C11 homeowner",
      role: actorRole,
      subject: `fixture:c11-${actorRole}`,
      tenantId: ids.tenant,
      userId: actorRole === "viewer" ? ids.viewer : ids.owner,
    },
    authMode: "local-fixture",
    expiresAt: "2099-07-18T09:00:00.000Z",
  };
}

function project() {
  return {
    createdAt: capturedAt,
    id: ids.project,
    name: "Synthetic C11 garden flat",
    status: "active",
    tenantId: ids.tenant,
    updatedAt: capturedAt,
    version: 1,
  };
}

function projectIntake() {
  return {
    intake: {
      accessibilityNeeds: ["Step-free circulation to the main living spaces."],
      addressSummary: "48 Sensitive Street, ZZ1 1ZZ",
      dwellingType: "flat",
      evidenceAvailable: {
        photographs: true,
        plans: false,
        roomCapture: false,
        video: false,
      },
      goals: ["Make the dining room work for calm weekday meals."],
      household: { adults: 2, children: 0, pets: 0 },
      mustChange: ["Improve uneven evening lighting."],
      mustKeep: ["Keep the existing oak dining table."],
      styleWords: ["warm mineral palette"],
    },
    projectId: ids.project,
    updatedAt: capturedAt,
    updatedBy: ids.viewer,
    version: 2,
  };
}

function consultation(state = "active") {
  return {
    baseBriefId: ids.brief,
    baseBriefRevision: brief.revision,
    ...(state === "cancelled" ? { cancelledAt: new Date().toISOString() } : {}),
    createdAt: capturedAt,
    createdBy: ids.owner,
    id: ids.session,
    projectId: ids.project,
    providerMode: "deterministic-local",
    schemaVersion: "c11-consultation-session-v1",
    state,
    turnCount: activeSession?.turnCount ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

function proposal(message, sourceMessageId) {
  const expired = scenario === "expired-proposal";
  return {
    baseBriefId: brief.id,
    baseBriefRevision: brief.revision,
    clarifyingQuestions: ["Must the dining table remain in exactly its current position?"],
    createdAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2099-07-18T09:30:00.000Z",
    id: ids.proposal,
    operations: [
      {
        entry: {
          category: "other",
          classification: "preference",
          id: "d1100000-0000-4000-8000-000000000018",
          priority: 3,
          provenance: { capturedAt, method: "assistant-extracted", sourceMessageId },
          roomOrLevelElementIds: [],
          statement: message.slice(0, 500),
          status: "active",
        },
        kind: "entry.add",
      },
    ],
    professionalReview: [
      {
        question: "Can the nib beside the opening be removed?",
        reason: "structural",
        status: "review-required",
      },
      {
        question: "What will the final construction cost be?",
        reason: "cost-certainty",
        status: "review-required",
      },
    ],
    projectId: ids.project,
    providerManifest: {
      adapter: "deterministic-local-v1",
      externalNetworkUsed: false,
      promptRegistryVersion: "brief-consultation-v1",
      toolRegistryVersion: "brief-tools-v1",
    },
    schemaVersion: "c11-brief-patch-proposal-v1",
    sessionId: ids.session,
    sourceMessageId,
    status: expired ? "expired" : "pending",
    summary:
      "A preference patch is ready; one conflict needs clarification and two questions need review.",
  };
}

function applyOperations(operations) {
  if (!brief) {
    brief = {
      createdAt: new Date().toISOString(),
      entries: [],
      id: ids.brief,
      projectId: ids.project,
      referenceBoard: [],
      revision: 0,
      schemaVersion: "c11-design-brief-v1",
      status: "draft",
      updatedAt: new Date().toISOString(),
      updatedBy: ids.owner,
    };
  }
  for (const operation of operations) {
    if (operation.kind === "entry.add") brief.entries.push(operation.entry);
    else if (operation.kind === "entry.replace") {
      brief.entries = brief.entries.map((entry) =>
        entry.id === operation.expectedEntryId ? operation.entry : entry,
      );
    } else if (operation.kind === "entry.remove") {
      brief.entries = brief.entries.filter((entry) => entry.id !== operation.entryId);
    } else if (operation.kind === "reference.add") brief.referenceBoard.push(operation.item);
    else if (operation.kind === "reference.remove") {
      brief.referenceBoard = brief.referenceBoard.filter(({ id }) => id !== operation.itemId);
    }
  }
  brief = {
    ...brief,
    revision: brief.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: ids.owner,
  };
  c11BriefMutations += 1;
  return brief;
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (url.pathname === "/__scenario") {
    scenario = url.searchParams.get("value") ?? "ready";
    resetState();
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === "/__mutation-counts") {
    const result = json({
      activeC11Sessions: activeSession?.state === "active" ? 1 : 0,
      cancelledC11Sessions: activeSession?.state === "cancelled" ? 1 : 0,
      c11BriefMutations,
      c11ProposalStatus: activeProposal?.status ?? null,
      c4CanonicalMutations: 0,
      c5ModelOperationMutations: 0,
      c9FusionMutations: 0,
      c10SceneMutations: 0,
    });
    response.writeHead(result.status, result.headers);
    response.end(result.body);
    return;
  }

  let result;
  if (foreign(request)) {
    result = json({ detail: "Not found", status: 404, title: "Not found" }, 404);
  } else if (url.pathname === "/v1/session") {
    result =
      scenario === "expired-session"
        ? json({ detail: "expired", status: 401, title: "expired" }, 401)
        : json(session(request));
  } else if (url.pathname === `/v1/projects/${ids.project}`) {
    result = json(project());
  } else if (url.pathname === `/v1/projects/${ids.project}/intake`) {
    result = json(projectIntake());
  } else if (url.pathname === `/v1/projects/${ids.project}/design-brief`) {
    if (request.method === "GET") {
      result = !brief
        ? json({ detail: "No design brief" }, 404)
        : scenario === "malformed-workspace"
          ? json({ ...brief, entries: [{ dangerous: true }] })
          : json(brief);
    } else if (request.method !== "PUT") {
      result = json({ detail: "Design brief updates require PUT" }, 405);
    } else if (scenario === "stale") {
      result = json({ code: "BRIEF_REVISION_CONFLICT", detail: "stale" }, 409);
    } else {
      const payload = await body(request);
      result = json(applyOperations(payload.operations));
    }
  } else if (url.pathname === `/v1/projects/${ids.project}/design-brief/accept`) {
    if (scenario === "stale") {
      result = json({ code: "BRIEF_REVISION_CONFLICT", detail: "stale" }, 409);
    } else {
      brief = {
        ...brief,
        acceptedAt: new Date().toISOString(),
        acceptedBy: ids.owner,
        revision: brief.revision + 1,
        status: "accepted",
        updatedAt: new Date().toISOString(),
      };
      c11BriefMutations += 1;
      result = json(brief);
    }
  } else if (url.pathname === `/v1/projects/${ids.project}/design-consultations`) {
    if (request.method !== "POST") result = json({ detail: "not found" }, 404);
    else if (role(request) === "viewer") result = json({ detail: "read only" }, 403);
    else {
      activeSession = consultation();
      result = json(activeSession, 201);
    }
  } else if (url.pathname === `/v1/projects/${ids.project}/design-consultations/${ids.session}`) {
    result = activeSession ? json(activeSession) : json({ detail: "not found" }, 404);
  } else if (
    url.pathname === `/v1/projects/${ids.project}/design-consultations/${ids.session}/cancel`
  ) {
    if (cancelFailuresRemaining > 0) {
      cancelFailuresRemaining -= 1;
      result = json({ detail: "Synthetic cleanup interruption" }, 503);
    } else {
      activeSession = consultation("cancelled");
      activeProposal = activeProposal ? { ...activeProposal, status: "rejected" } : undefined;
      result = json(activeSession);
    }
  } else if (
    url.pathname === `/v1/projects/${ids.project}/design-consultations/${ids.session}/turns`
  ) {
    if (scenario === "turn-error") {
      result = json({ detail: "raw prompt must not leak", token: "secret" }, 500);
    } else if (scenario === "malformed-proposal") {
      result = json({ status: "pending", externalNetworkUsed: true });
    } else {
      const payload = await body(request);
      activeProposal = proposal(payload.message, payload.clientMessageId);
      activeSession = { ...activeSession, turnCount: (activeSession?.turnCount ?? 0) + 1 };
      result = json(activeProposal, 201);
    }
  } else if (
    url.pathname ===
    `/v1/projects/${ids.project}/design-consultations/${ids.session}/proposals/${ids.proposal}`
  ) {
    result = activeProposal ? json(activeProposal) : json({ detail: "not found" }, 404);
  } else if (
    url.pathname ===
    `/v1/projects/${ids.project}/design-consultations/${ids.session}/proposals/${ids.proposal}/confirm`
  ) {
    if (scenario === "stale") result = json({ code: "BRIEF_REVISION_CONFLICT" }, 409);
    else if (activeProposal?.status === "expired") result = json({ code: "PROPOSAL_EXPIRED" }, 410);
    else {
      brief = applyOperations(activeProposal.operations);
      activeProposal = { ...activeProposal, status: "confirmed" };
      activeSession = { ...activeSession, state: "completed" };
      result = json(brief);
    }
  } else {
    result = json({ detail: "not found", status: 404, title: "not found" }, 404);
  }

  response.writeHead(result.status, result.headers);
  response.end(result.body);
});

server.listen(port, "127.0.0.1");

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
