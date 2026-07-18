import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../src/app/api/c13/[...segments]/route";
import {
  assetsResponse,
  chairAsset,
  confirmation,
  ids,
  preview,
  release,
  releasesResponse,
  scheduleResponse,
  specification,
  specificationRevisionTwo,
  specificationsResponse,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mutationKey = "c1300000-0000-4000-8000-000000000099";
const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(method = "GET", body?: unknown, search = "", token = "server-owned-c13-token") {
  return new NextRequest(`http://localhost:3000/api/c13/test${search}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: `hds_c1_session=${token}`,
      ...(method === "GET"
        ? {}
        : { "content-type": "application/json", "idempotency-key": mutationKey }),
    },
    method,
  });
}

function requestBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") throw new Error("Expected a JSON mutation body");
  return JSON.parse(init.body) as unknown;
}

describe("C13 exact same-origin BFF", () => {
  it("proxies release, asset, specification, revision, schedule, and preview reads", async () => {
    const signedArtifactAccess = {
      artifactId: ids.model,
      byteLength: 512,
      expiresAt: "2027-07-18T13:00:00.000Z",
      mediaType: "model/gltf-binary",
      sha256: "a".repeat(64),
      url: `http://127.0.0.1:4351/signed/catalog/${ids.model}?signature=synthetic`,
    };
    const cases = [
      {
        payload: signedArtifactAccess,
        segments: ["projects", ids.project, "catalog", "artifacts", ids.model],
        suffix: `/catalog/artifacts/${ids.model}`,
      },
      {
        payload: releasesResponse,
        segments: ["projects", ids.project, "catalog", "releases"],
        suffix: `/v1/projects/${ids.project}/catalog/releases`,
      },
      {
        payload: release,
        segments: ["projects", ids.project, "catalog", "releases", ids.release],
        suffix: `/catalog/releases/${ids.release}`,
      },
      {
        payload: assetsResponse,
        segments: ["projects", ids.project, "catalog", "releases", ids.release, "assets"],
        suffix: `/catalog/releases/${ids.release}/assets?`,
        search: "?kind=all&limit=9&query=&rights=all&source=all",
      },
      {
        payload: chairAsset,
        segments: [
          "projects",
          ids.project,
          "catalog",
          "releases",
          ids.release,
          "assets",
          ids.assetChair,
        ],
        suffix: `/catalog/releases/${ids.release}/assets/${ids.assetChair}`,
      },
      {
        payload: specificationsResponse,
        segments: ["projects", ids.project, "specifications"],
        suffix: `/v1/projects/${ids.project}/specifications`,
      },
      {
        payload: specification,
        segments: ["projects", ids.project, "specifications", ids.specification],
        suffix: `/specifications/${ids.specification}`,
      },
      {
        payload: { revisions: [specification.currentRevision], specificationId: ids.specification },
        segments: ["projects", ids.project, "specifications", ids.specification, "revisions"],
        suffix: `/specifications/${ids.specification}/revisions`,
      },
      {
        payload: scheduleResponse,
        segments: ["projects", ids.project, "specifications", ids.specification, "schedule-lines"],
        suffix: `/specifications/${ids.specification}/schedule-lines`,
      },
      {
        payload: preview,
        segments: [
          "projects",
          ids.project,
          "specifications",
          ids.specification,
          "substitutions",
          ids.preview,
        ],
        suffix: `/specifications/${ids.specification}/substitutions/${ids.preview}`,
      },
    ];
    for (const testCase of cases) {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(testCase.payload));
      vi.stubGlobal("fetch", fetchMock);
      const response = await GET(
        request("GET", undefined, testCase.search ?? ""),
        context(testCase.segments),
      );
      expect(response.status, testCase.suffix).toBe(200);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(testCase.suffix);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-owned-c13-token");
      expect(JSON.stringify(await response.json())).not.toMatch(
        /server-owned|authorization|token/iu,
      );
      vi.unstubAllGlobals();
    }
  });

  it("proxies authoritative creation, board revision, preview, and confirmation mutations", async () => {
    const createBody = {
      catalogReleaseId: ids.release,
      catalogReleaseSha256: release.manifestSha256,
      confirmationId: ids.confirmation,
    };
    const boardBody = {
      entries: specification.selectionBoard.entries,
      expectedRevision: 1,
    };
    const previewBody = {
      elementId: ids.elementChair,
      expectedBranchRevision: 2,
      expectedSpecificationRevision: 1,
      replacementAssetVersionId: ids.assetSofa,
    };
    const confirmBody = {
      expectedCandidateSnapshotSha256: preview.candidateSnapshotSha256,
      expectedSpecificationRevision: 1,
      previewId: ids.preview,
    };
    const cases = [
      {
        body: createBody,
        method: "POST",
        payload: specification,
        segments: ["projects", ids.project, "specifications", "from-c12-confirmation"],
      },
      {
        body: boardBody,
        method: "PUT",
        payload: specificationRevisionTwo,
        segments: ["projects", ids.project, "specifications", ids.specification, "selection-board"],
      },
      {
        body: previewBody,
        method: "POST",
        payload: preview,
        segments: ["projects", ids.project, "specifications", ids.specification, "substitutions"],
      },
      {
        body: confirmBody,
        method: "POST",
        payload: confirmation,
        segments: [
          "projects",
          ids.project,
          "specifications",
          ids.specification,
          "substitutions",
          ids.preview,
          "confirm",
        ],
        sceneRequestState: "requested",
      },
    ];
    for (const testCase of cases) {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json(testCase.payload, {
          ...(testCase.sceneRequestState
            ? { headers: { "Scene-Request-State": testCase.sceneRequestState } }
            : {}),
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const response = await POST(request("POST", testCase.body), context(testCase.segments));
      expect(response.status).toBe(200);
      if (testCase.sceneRequestState) {
        expect(response.headers.get("scene-request-state")).toBe(testCase.sceneRequestState);
        await expect(response.json()).resolves.toEqual({
          confirmation,
          sceneRequestState: testCase.sceneRequestState,
        });
      }
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe(testCase.method);
      expect(new Headers(init.headers).get("idempotency-key")).toBe(mutationKey);
      expect(requestBody(init)).toEqual(testCase.body);
      vi.unstubAllGlobals();
    }
  });

  it("requests an exact scene for one committed revision and preserves its exact job ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ sceneJobId: ids.sceneJob }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      request("POST", { sceneJobId: ids.sceneJob }),
      context([
        "projects",
        ids.project,
        "specifications",
        ids.specification,
        "revisions",
        "2",
        "scene-jobs",
      ]),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ sceneJobId: ids.sceneJob });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/specifications/${ids.specification}/revisions/2/scene-jobs`);
    expect(init.method).toBe("POST");
    expect(requestBody(init)).toEqual({ sceneJobId: ids.sceneJob });
    expect(new Headers(init.headers).get("idempotency-key")).toBe(mutationKey);
  });

  it("propagates only the two exact platform scene request states", async () => {
    for (const sceneRequestState of ["requested", "retry-required"] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json(confirmation, {
            headers: { "Scene-Request-State": sceneRequestState },
            status: 201,
          }),
        ),
      );
      const response = await POST(
        request("POST", confirmBody()),
        context([
          "projects",
          ids.project,
          "specifications",
          ids.specification,
          "substitutions",
          ids.preview,
          "confirm",
        ]),
      );
      expect(response.status).toBe(201);
      expect(response.headers.get("scene-request-state")).toBe(sceneRequestState);
      await expect(response.json()).resolves.toEqual({ confirmation, sceneRequestState });
    }
  });

  it("keeps viewer scene retry server-authoritative and returns a safe denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ detail: "PRIVATE_SCENE_JOB" }, { status: 403 })),
    );
    const response = await POST(
      request("POST", { sceneJobId: ids.sceneJob }, "", "viewer-token"),
      context([
        "projects",
        ids.project,
        "specifications",
        ids.specification,
        "revisions",
        "2",
        "scene-jobs",
      ]),
    );
    expect(response.status).toBe(403);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("does not allow");
    expect(serialized).not.toContain("PRIVATE_SCENE_JOB");
  });

  it("rejects missing or malformed scene state headers and malformed retry bodies", async () => {
    const confirmationSegments = [
      "projects",
      ids.project,
      "specifications",
      ids.specification,
      "substitutions",
      ids.preview,
      "confirm",
    ];
    for (const header of [undefined, "queued", "requested, retry-required"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json(confirmation, {
            ...(header ? { headers: { "Scene-Request-State": header } } : {}),
          }),
        ),
      );
      const response = await POST(request("POST", confirmBody()), context(confirmationSegments));
      expect(response.status).toBe(502);
      expect(response.headers.get("scene-request-state")).toBeNull();
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ jobId: ids.sceneJob })));
    const malformedRetry = await POST(
      request("POST", { sceneJobId: ids.sceneJob }),
      context([
        "projects",
        ids.project,
        "specifications",
        ids.specification,
        "revisions",
        "2",
        "scene-jobs",
      ]),
    );
    expect(malformedRetry.status).toBe(502);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ sceneJobId: ids.viewer })));
    const mismatchedRetry = await POST(
      request("POST", { sceneJobId: ids.sceneJob }),
      context([
        "projects",
        ids.project,
        "specifications",
        ids.specification,
        "revisions",
        "2",
        "scene-jobs",
      ]),
    );
    expect(mismatchedRetry.status).toBe(502);

    const missingBodyFetch = vi.fn();
    vi.stubGlobal("fetch", missingBodyFetch);
    const missingRetryBody = await POST(
      request("POST"),
      context([
        "projects",
        ids.project,
        "specifications",
        ids.specification,
        "revisions",
        "2",
        "scene-jobs",
      ]),
    );
    expect(missingRetryBody.status).toBe(400);
    expect(missingBodyFetch).not.toHaveBeenCalled();
  });

  it("rejects malformed path IDs, filters, bodies, and preview mismatches before upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformedProject = await GET(
      request(),
      context(["projects", "not-a-project", "specifications"]),
    );
    expect(malformedProject.status).toBe(404);
    const malformedFilter = await GET(
      request("GET", undefined, "?limit=9000"),
      context(["projects", ids.project, "catalog", "releases", ids.release, "assets"]),
    );
    expect(malformedFilter.status).toBe(400);
    const forgedCreation = await POST(
      request("POST", {
        catalogReleaseId: ids.release,
        catalogReleaseSha256: release.manifestSha256,
        confirmationId: ids.confirmation,
        projectId: ids.project,
      }),
      context(["projects", ids.project, "specifications", "from-c12-confirmation"]),
    );
    expect(forgedCreation.status).toBe(400);
    const mismatch = await POST(
      request("POST", { ...confirmBody(), previewId: ids.viewer }),
      context([
        "projects",
        ids.project,
        "specifications",
        ids.specification,
        "substitutions",
        ids.preview,
        "confirm",
      ]),
    );
    expect(mismatch.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on foreign or malformed upstream data and redacts private problem bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...specificationsResponse,
          projectId: ids.viewer,
          specifications: [{ ...specification, projectId: ids.viewer }],
        }),
      ),
    );
    const foreign = await GET(request(), context(["projects", ids.project, "specifications"]));
    expect(foreign.status).toBe(502);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          artifactId: ids.model,
          byteLength: 512,
          expiresAt: "2027-07-18T13:00:00.000Z",
          mediaType: "model/gltf-binary",
          objectKey: "catalog/private/object-key",
          sha256: "a".repeat(64),
          url: "https://user:secret@catalog.example.test/artifact#private",
        }),
      ),
    );
    const unsafeArtifact = await GET(
      request(),
      context(["projects", ids.project, "catalog", "artifacts", ids.model]),
    );
    expect(unsafeArtifact.status).toBe(502);
    expect(JSON.stringify(await unsafeArtifact.json())).not.toMatch(/object-key|secret|private/iu);

    const privateMarker = "PRIVATE_NOTE_RIGHTS_RECEIPT_AND_TOKEN";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "STALE_RIGHTS", detail: privateMarker, notes: [privateMarker] },
            { status: 409 },
          ),
        ),
    );
    const stale = await GET(request(), context(["projects", ids.project, "specifications"]));
    const serialized = JSON.stringify(await stale.json());
    expect(stale.status).toBe(409);
    expect(serialized).toContain("STALE_RIGHTS");
    expect(serialized).toContain("Reload exact state");
    expect(serialized).not.toContain(privateMarker);
    expect(serialized).not.toMatch(/notes|receipt|token/iu);
  });
});

function confirmBody() {
  return {
    expectedCandidateSnapshotSha256: preview.candidateSnapshotSha256,
    expectedSpecificationRevision: 1,
    previewId: ids.preview,
  };
}
