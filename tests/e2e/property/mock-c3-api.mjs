import { createServer } from "node:http";

const port = 4130;
const projectId = "33333333-3333-4333-8333-333333333333";
const tenantId = "11111111-1111-4111-8111-111111111111";
const propertyId = "44444444-4444-4444-8444-444444444444";
const personas = {
  "homeowner-alpha": {
    displayName: "Alpha homeowner",
    role: "owner",
    userId: "aaaaaaaa-1111-4111-8111-111111111111",
  },
  "viewer-alpha": {
    displayName: "Alpha viewer",
    role: "viewer",
    userId: "cccccccc-3333-4333-8333-333333333333",
  },
};

const fixtureSource = {
  coverage: "fixture-complete",
  dataset: "C3 synthetic property catalogue",
  datasetVersion: "c3-fixture-1",
  licence: { id: "repository-test", title: "Repository synthetic test data" },
  modelTrainingAllowed: false,
  participantSharingAllowed: true,
  providerId: "repository-fixture",
  retrievedAt: "2026-07-17T12:00:00.000Z",
  serviceProcessingAllowed: true,
};

const exactCandidate = {
  address: {
    countryCode: "GB",
    line1: "14 Example Mews",
    locality: "Testford",
    postcode: "ZZ1 1ZZ",
  },
  candidateId: "66666666-6666-4666-8666-666666666666",
  displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
  identifiers: [{ scheme: "UPRN", value: "000000000014" }],
  jurisdiction: "england",
  location: { coordinates: [530014, 180014], crs: "EPSG:27700" },
  source: fixtureSource,
};

const ambiguousCandidates = [
  {
    ...exactCandidate,
    address: {
      countryCode: "GB",
      line1: "2A Shared Point Court",
      locality: "Testford",
      postcode: "ZZ2 2ZZ",
    },
    candidateId: "66666666-6666-4666-8666-666666666661",
    displayAddress: "2A Shared Point Court, Testford, ZZ2 2ZZ",
    identifiers: [{ scheme: "UPRN", value: "000000000021" }],
    location: { coordinates: [530022, 180022], crs: "EPSG:27700" },
  },
  {
    ...exactCandidate,
    address: {
      countryCode: "GB",
      line1: "2B Shared Point Court",
      locality: "Testford",
      postcode: "ZZ2 2ZZ",
    },
    candidateId: "66666666-6666-4666-8666-666666666662",
    displayAddress: "2B Shared Point Court, Testford, ZZ2 2ZZ",
    identifiers: [{ scheme: "UPRN", value: "000000000022" }],
    location: { coordinates: [530022, 180022], crs: "EPSG:27700" },
  },
];

let resolutionSequence = 1;
let resolutions = new Map();
let selectedProperty;
let propertyVersion = 0;
let dossierVersion = 0;

function reset() {
  resolutionSequence = 1;
  resolutions = new Map();
  selectedProperty = undefined;
  propertyVersion = 0;
  dossierVersion = 0;
}

function responseHeaders(extra = {}) {
  return { "cache-control": "no-store", ...extra };
}

function json(response, status, payload, extra = {}) {
  response.writeHead(
    status,
    responseHeaders({ "content-type": "application/json; charset=utf-8", ...extra }),
  );
  response.end(payload === undefined ? undefined : JSON.stringify(payload));
}

function problem(response, status, code, title, detail) {
  json(
    response,
    status,
    {
      code,
      detail,
      instance: "/v1/projects/synthetic/property",
      requestId: `request-${code.toLowerCase()}`,
      status,
      title,
      traceId: `trace-${code.toLowerCase()}`,
      type: `urn:interior-design:error:${code.toLowerCase().replaceAll("_", "-")}`,
    },
    { "content-type": "application/problem+json; charset=utf-8" },
  );
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function personaFrom(request) {
  const value = request.headers.authorization;
  return Object.keys(personas).find(
    (persona) => value === `Bearer fixture-token-${persona}-synthetic-session`,
  );
}

function sessionFor(persona) {
  const actor = personas[persona];
  return {
    actor: {
      displayName: actor.displayName,
      role: actor.role,
      subject: `fixture:${persona}`,
      tenantId,
      userId: actor.userId,
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

function requireMutation(request, response, persona) {
  if (personas[persona].role === "viewer") {
    problem(
      response,
      403,
      "FORBIDDEN",
      "Forbidden",
      "Viewer fixtures have read-only property access.",
    );
    return false;
  }
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    problem(
      response,
      400,
      "BAD_REQUEST",
      "Invalid request",
      "A bounded Idempotency-Key is required.",
    );
    return false;
  }
  return true;
}

function nextResolutionId() {
  const suffix = String(resolutionSequence).padStart(12, "0");
  resolutionSequence += 1;
  return `70000000-0000-4000-8000-${suffix}`;
}

function makeResolution(query) {
  const normalized = query.toLowerCase();
  const resolutionId = nextResolutionId();
  let result;
  if (normalized.includes("disabled")) {
    result = {
      candidates: [],
      expiresAt: "2099-07-17T12:15:00.000Z",
      manualEntryAllowed: true,
      providerState: "disabled",
      resolutionId,
      status: "unavailable",
    };
  } else if (normalized.includes("outage")) {
    result = {
      candidates: [],
      expiresAt: "2099-07-17T12:15:00.000Z",
      manualEntryAllowed: true,
      providerState: "unavailable",
      resolutionId,
      status: "unavailable",
    };
  } else if (normalized.includes("missing") || normalized.includes("no match")) {
    result = {
      candidates: [],
      expiresAt: "2099-07-17T12:15:00.000Z",
      manualEntryAllowed: true,
      providerState: "fixture",
      resolutionId,
      status: "no-match",
    };
  } else if (normalized.includes("shared") || normalized.includes("ambiguous")) {
    result = {
      candidates: ambiguousCandidates,
      expiresAt: "2099-07-17T12:15:00.000Z",
      manualEntryAllowed: true,
      providerState: "fixture",
      resolutionId,
      status: "ambiguous",
    };
  } else {
    result = {
      candidates: [exactCandidate],
      expiresAt: "2099-07-17T12:15:00.000Z",
      manualEntryAllowed: true,
      providerState: "fixture",
      resolutionId,
      status: "matched",
    };
  }
  resolutions.set(resolutionId, { expired: false, result });
  return result;
}

function propertyFromCandidate(candidate) {
  return {
    address: candidate.address,
    displayAddress: candidate.displayAddress,
    identifiers: candidate.identifiers,
    interiorKnowledgeStatus: "unknown-without-evidence",
    jurisdiction: candidate.jurisdiction,
    location: candidate.location,
    mode: "candidate",
    projectId,
    propertyId,
    selectedAt: "2026-07-17T12:05:00.000Z",
    source: fixtureSource,
    updatedAt: "2026-07-17T12:05:00.000Z",
    version: propertyVersion,
  };
}

function propertyFromManual(body) {
  const source = {
    coverage: "unknown",
    dataset: "Manual property identity",
    datasetVersion: "c3-manual-1",
    licence: { id: "user-provided", title: "User-provided project data" },
    modelTrainingAllowed: false,
    participantSharingAllowed: true,
    providerId: "user-provided",
    retrievedAt: "2026-07-17T12:05:00.000Z",
    serviceProcessingAllowed: true,
  };
  const displayAddress = [
    body.address.line1,
    body.address.line2,
    body.address.locality,
    body.address.postcode,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    address: body.address,
    displayAddress,
    identifiers: [],
    interiorKnowledgeStatus: "unknown-without-evidence",
    jurisdiction: body.jurisdiction,
    mode: "manual",
    projectId,
    propertyId,
    selectedAt: "2026-07-17T12:05:00.000Z",
    source,
    updatedAt: "2026-07-17T12:05:00.000Z",
    version: propertyVersion,
  };
}

function sourceRecords() {
  if (!selectedProperty) return [];
  const identitySourceId = "55555555-5555-4555-8555-555555555551";
  const assertionSourceId = "55555555-5555-4555-8555-555555555552";
  const heuristicSourceId = "55555555-5555-4555-8555-555555555553";
  return [
    {
      fields: [
        "property-identity",
        ...(selectedProperty.identifiers.length ? ["uprn", "location-point"] : []),
      ],
      id: identitySourceId,
      normalizedPayloadSha256: "a".repeat(64),
      projectId,
      propertyId,
      source: selectedProperty.source,
    },
    {
      fields: ["household-priority"],
      id: assertionSourceId,
      normalizedPayloadSha256: "b".repeat(64),
      projectId,
      propertyId,
      source: {
        coverage: "partial",
        dataset: "C1 synthetic intake assertions",
        datasetVersion: "c1-fixture-1",
        licence: { id: "user-provided", title: "User-provided project data" },
        modelTrainingAllowed: false,
        participantSharingAllowed: true,
        providerId: "project-intake",
        retrievedAt: "2026-07-17T12:00:00.000Z",
        serviceProcessingAllowed: true,
      },
    },
    {
      fields: ["context-year", "locality-context"],
      id: heuristicSourceId,
      normalizedPayloadSha256: "c".repeat(64),
      projectId,
      propertyId,
      source: {
        ...fixtureSource,
        coverage: "partial",
        dataset: "C3 deterministic context heuristic",
        datasetVersion: "c3-heuristic-1",
      },
    },
  ];
}

function dossier() {
  if (!selectedProperty) return undefined;
  const sources = sourceRecords();
  return {
    coverageWarnings: [
      "Synthetic fixture coverage is limited to the fixture catalogue. It does not establish the current interior, legal boundary, structure, planning constraints or professional approval.",
      "No-result planning or context data must not be read as no constraints.",
    ],
    generatedAt: `2026-07-17T12:${String(5 + dossierVersion).padStart(2, "0")}:00.000Z`,
    interiorKnowledgeStatus: "unknown-without-evidence",
    items: [
      {
        classification: "source-observation",
        interiorClaim: "none",
        key: "property-identity",
        label: "Property identity",
        note: "An addressable identity only; not a surveyed shell or interior.",
        sourceRecordIds: [sources[0].id],
        value: { kind: "text", value: selectedProperty.displayAddress },
      },
      {
        classification: "user-assertion",
        interiorClaim: "none",
        key: "household-priority",
        label: "Household priority",
        note: "Supplied in the synthetic project intake and not independently verified.",
        sourceRecordIds: [sources[1].id],
        value: { kind: "text", value: "More daylight requested" },
      },
      {
        classification: "estimate",
        confidencePercent: 70,
        interiorClaim: "none",
        key: "context-year",
        label: "Context record year",
        note: "A fixture-only contextual estimate; not construction dating.",
        sourceRecordIds: [sources[2].id],
        value: { kind: "integer", unit: "year", value: 1985 },
      },
      {
        classification: "inference",
        confidencePercent: 62,
        interiorClaim: "none",
        key: "locality-context",
        label: "Locality context",
        note: "A deterministic interpretation of synthetic context, requiring confirmation.",
        sourceRecordIds: [sources[2].id],
        value: { kind: "text", value: "Synthetic residential context" },
      },
      ...[
        ["current-layout", "Current interior layout"],
        ["wall-thickness", "Wall thickness"],
        ["structure", "Structural system"],
        ["legal-boundary", "Legal boundary"],
      ].map(([key, label]) => ({
        classification: "unknown",
        interiorClaim: "none",
        key,
        label,
        note: "No sufficient evidence has established this.",
        sourceRecordIds: [],
        value: { kind: "unknown" },
      })),
    ],
    planningStatus: "not-reviewed",
    property: selectedProperty,
    sources,
    version: dossierVersion,
  };
}

function seedSelected() {
  propertyVersion = 1;
  dossierVersion = 1;
  selectedProperty = propertyFromCandidate(exactCandidate);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  try {
    if (request.method === "GET" && url.pathname === "/health")
      return json(response, 200, { status: "ok" });
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      reset();
      return json(response, 200, { reset: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/seed-selected") {
      seedSelected();
      return json(response, 200, dossier());
    }
    if (request.method === "POST" && url.pathname === "/__test/expire-resolutions") {
      for (const entry of resolutions.values()) entry.expired = true;
      return json(response, 200, { expired: resolutions.size });
    }
    if (request.method === "POST" && url.pathname === "/__test/bump-dossier") {
      if (!selectedProperty)
        return problem(
          response,
          404,
          "PROPERTY_NOT_SELECTED",
          "Not found",
          "No property is selected.",
        );
      dossierVersion += 1;
      return json(response, 200, dossier());
    }

    if (request.method === "POST" && url.pathname === "/v1/auth/local/session") {
      const body = await readBody(request);
      if (!body || !(body.persona in personas)) {
        return problem(
          response,
          400,
          "BAD_REQUEST",
          "Invalid persona",
          "Choose a supported fixture persona.",
        );
      }
      return json(response, 201, {
        accessToken: `fixture-token-${body.persona}-synthetic-session`,
        session: sessionFor(body.persona),
      });
    }

    const persona = personaFrom(request);
    if (!persona)
      return problem(response, 401, "UNAUTHENTICATED", "Session expired", "Sign in again.");
    if (request.method === "GET" && url.pathname === "/v1/session")
      return json(response, 200, sessionFor(persona));
    if (request.method === "GET" && url.pathname === "/v1/projects")
      return json(response, 200, [project()]);
    if (request.method === "GET" && url.pathname === `/v1/projects/${projectId}`)
      return json(response, 200, project());
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/v1/projects/") &&
      !url.pathname.includes(projectId)
    ) {
      return problem(
        response,
        404,
        "NOT_FOUND",
        "Not found",
        "The requested resource was not found.",
      );
    }

    const base = `/v1/projects/${projectId}/property`;
    if (request.method === "POST" && url.pathname === `${base}/resolutions`) {
      if (!requireMutation(request, response, persona)) return;
      const body = await readBody(request);
      return json(response, 201, makeResolution(body.query));
    }

    if (request.method === "PUT" && url.pathname === base) {
      if (!requireMutation(request, response, persona)) return;
      const body = await readBody(request);
      if (body.expectedVersion !== propertyVersion) {
        return problem(
          response,
          409,
          "REVISION_CONFLICT",
          "Revision conflict",
          "A newer property selection already exists.",
        );
      }
      propertyVersion += 1;
      dossierVersion = 1;
      if (body.mode === "manual") {
        selectedProperty = propertyFromManual(body);
      } else {
        const snapshot = resolutions.get(body.resolutionId);
        if (!snapshot || snapshot.expired) {
          propertyVersion -= 1;
          return problem(
            response,
            409,
            "PROPERTY_RESOLUTION_EXPIRED",
            "Search expired",
            "The candidate resolution expired after 15 minutes.",
          );
        }
        const candidate = snapshot.result.candidates.find(
          (item) => item.candidateId === body.candidateId,
        );
        if (!candidate) {
          propertyVersion -= 1;
          return problem(
            response,
            400,
            "BAD_REQUEST",
            "Invalid candidate",
            "Choose a candidate from this resolution.",
          );
        }
        selectedProperty = propertyFromCandidate(candidate);
      }
      return json(response, 200, selectedProperty);
    }

    if (request.method === "GET" && url.pathname === `${base}/dossier`) {
      const payload = dossier();
      if (!payload)
        return problem(
          response,
          404,
          "PROPERTY_NOT_SELECTED",
          "Not found",
          "No property is selected.",
        );
      return json(response, 200, payload);
    }

    if (request.method === "GET" && url.pathname === `${base}/source-records`) {
      return json(response, 200, { sources: sourceRecords() });
    }

    if (request.method === "POST" && url.pathname === `${base}/dossier/refresh`) {
      if (!requireMutation(request, response, persona)) return;
      if (!selectedProperty)
        return problem(
          response,
          404,
          "PROPERTY_NOT_SELECTED",
          "Not found",
          "No property is selected.",
        );
      const body = await readBody(request);
      if (body.expectedVersion !== dossierVersion) {
        return problem(
          response,
          409,
          "REVISION_CONFLICT",
          "Revision conflict",
          "A newer dossier version already exists.",
        );
      }
      dossierVersion += 1;
      return json(response, 200, dossier());
    }

    problem(response, 404, "NOT_FOUND", "Not found", "The deterministic C3 route does not exist.");
  } catch (error) {
    problem(
      response,
      500,
      "MOCK_FAILURE",
      "Mock failure",
      error instanceof Error ? error.message : "Unknown deterministic mock failure.",
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`C3 mock API listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
