import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../../src/correlation.js";
import { registerErrorHandling } from "../../../src/errors.js";
import { registerSpecificationRoutes } from "../../../src/modules/specifications/routes.js";
import { FixtureProjectRepository, actors, fixtureIdentity, tokenFor } from "../../c6/support.js";
import {
  actor,
  correlation,
  createSpecification,
  creationRequest,
  only,
  projectId,
  seedReplacement,
  testRuntime,
} from "./support.js";

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

describe("C13 specification routes", () => {
  let server: FastifyInstance;
  let runtime: ReturnType<typeof testRuntime>;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    runtime = testRuntime();
    registerSpecificationRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      runtime.service,
    );
  });

  afterEach(async () => {
    delete actors["machine:c13-worker"];
    await server.close();
  });

  it("allows owner creation/replay and viewer read-only schedules/history", async () => {
    const route = `/v1/projects/${projectId}/specifications/from-c12-confirmation`;
    const create = {
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c13-route-create-0001",
      },
      method: "POST" as const,
      payload: creationRequest,
      url: route,
    };
    const first = await server.inject(create);
    const replay = await server.inject(create);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    const specification = first.json<{ readonly specificationId: string }>();
    const base = `/v1/projects/${projectId}/specifications/${specification.specificationId}`;
    const list = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `/v1/projects/${projectId}/specifications`,
    });
    expect(list.statusCode).toBe(200);
    expect(Object.keys(list.json()).sort()).toEqual(["projectId", "specifications"]);
    expect(list.json()).toMatchObject({
      projectId,
      specifications: [{ specificationId: specification.specificationId }],
    });

    const get = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: base,
    });
    expect(get.statusCode).toBe(200);
    const revision = get.json<{
      readonly currentRevision: { readonly lines: unknown[]; readonly revision: number };
    }>().currentRevision;

    const revisions = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${base}/revisions`,
    });
    expect(revisions.statusCode).toBe(200);
    expect(Object.keys(revisions.json()).sort()).toEqual(["revisions", "specificationId"]);
    expect(revisions.json()).toMatchObject({
      revisions: [{ revision: 1 }],
      specificationId: specification.specificationId,
    });

    const scheduleLines = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${base}/schedule-lines`,
    });
    expect(scheduleLines.statusCode).toBe(200);
    expect(Object.keys(scheduleLines.json()).sort()).toEqual([
      "lines",
      "revision",
      "specificationId",
    ]);
    expect(scheduleLines.json()).toEqual({
      lines: revision.lines,
      revision: revision.revision,
      specificationId: specification.specificationId,
    });
  });

  it("denies viewer mutations and returns non-disclosing foreign-tenant not-found", async () => {
    const create = await server.inject({
      headers: {
        ...authorization("fixture|viewer-alpha"),
        "idempotency-key": "c13-viewer-create-0001",
      },
      method: "POST",
      payload: creationRequest,
      url: `/v1/projects/${projectId}/specifications/from-c12-confirmation`,
    });
    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url: `/v1/projects/${projectId}/specifications/${randomUUID()}`,
    });
    expect(create.statusCode).toBe(403);
    expect(foreign.statusCode).toBe(404);
    expect(runtime.repository.specifications.size).toBe(0);
  });

  it("updates the selection board by PUT, replays exactly, and leaves POST unavailable", async () => {
    const created = await createSpecification(runtime);
    const line = only(created.specification.currentRevision.lines);
    const url = `/v1/projects/${projectId}/specifications/${created.specification.specificationId}/selection-board`;
    const request = {
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c13-selection-put-0001",
      },
      method: "PUT" as const,
      payload: {
        entries: [
          {
            assetVersionId: line.assetVersionId,
            elementId: line.elementId,
            note: "Synthetic PUT decision",
            state: "shortlisted",
          },
        ],
        expectedRevision: 1,
      },
      url,
    };
    const first = await server.inject(request);
    const replay = await server.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ currentRevision: { revision: 2 } });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.json()).toEqual(first.json());

    const post = await server.inject({ ...request, method: "POST" });
    expect(post.statusCode).toBe(404);
    expect(
      await runtime.service.revisions(
        actor.tenantId,
        projectId,
        created.specification.specificationId,
      ),
    ).toHaveLength(2);
  });

  it("rejects client source pins beyond confirmation/release and mismatched preview IDs", async () => {
    const forged = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c13-forged-source-0001",
      },
      method: "POST",
      payload: { ...creationRequest, branchId: randomUUID(), modelSnapshotSha256: "0".repeat(64) },
      url: `/v1/projects/${projectId}/specifications/from-c12-confirmation`,
    });
    expect(forged.statusCode).toBe(400);

    const created = await createSpecification(runtime);
    const asset = seedReplacement(created);
    const preview = await created.service.createPreview({
      actor,
      correlation: {
        requestId: "c13-route-preview",
        spanId: "1".repeat(16),
        traceId: "1".repeat(32),
        traceParent: `00-${"1".repeat(32)}-${"1".repeat(16)}-00`,
      },
      idempotencyKey: randomUUID(),
      projectId,
      request: {
        elementId: only(created.specification.currentRevision.lines).elementId,
        expectedBranchRevision: 1,
        expectedSpecificationRevision: 1,
        replacementAssetVersionId: asset.versionId,
      },
      specificationId: created.specification.specificationId,
    });
    const mismatch = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c13-confirm-mismatch-0001",
      },
      method: "POST",
      payload: {
        expectedCandidateSnapshotSha256: preview.preview.candidateSnapshotSha256,
        expectedSpecificationRevision: 1,
        previewId: preview.preview.previewId,
      },
      url: `/v1/projects/${projectId}/specifications/${created.specification.specificationId}/substitutions/${randomUUID()}/confirm`,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: "PREVIEW_ID_MISMATCH" });
  });

  it("forbids machine/service-principal confirmation", async () => {
    const owner = actors["fixture|owner-alpha"];
    if (owner === undefined) throw new Error("Owner fixture missing.");
    actors["machine:c13-worker"] = { ...owner, subject: "machine:c13-worker" };
    const previewId = randomUUID();
    const response = await server.inject({
      headers: {
        ...authorization("machine:c13-worker"),
        "idempotency-key": "c13-machine-confirm-0001",
      },
      method: "POST",
      payload: {
        expectedCandidateSnapshotSha256: "0".repeat(64),
        expectedSpecificationRevision: 1,
        previewId,
      },
      url: `/v1/projects/${projectId}/specifications/${randomUUID()}/substitutions/${previewId}/confirm`,
    });
    expect(response.statusCode).toBe(403);
  });

  it("retries the exact scene binding and rejects a mismatched specification/revision URL", async () => {
    const [sourceKey, verified] = only([...runtime.repository.creationSources.entries()]);
    runtime.repository.creationSources.set(sourceKey, {
      ...verified,
      source: { ...verified.source, branchRevision: 7 },
    });
    const created = await createSpecification(runtime);
    const asset = seedReplacement(created);
    const proposed = await created.service.createPreview({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId,
      request: {
        elementId: only(created.specification.currentRevision.lines).elementId,
        expectedBranchRevision: 7,
        expectedSpecificationRevision: 1,
        replacementAssetVersionId: asset.versionId,
      },
      specificationId: created.specification.specificationId,
    });
    const confirmed = await created.service.confirm({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId,
      request: {
        expectedCandidateSnapshotSha256: proposed.preview.candidateSnapshotSha256,
        expectedSpecificationRevision: 1,
        previewId: proposed.preview.previewId,
      },
      specificationId: created.specification.specificationId,
    });
    const exactUrl = `/v1/projects/${projectId}/specifications/${created.specification.specificationId}/revisions/2/scene-jobs`;
    const exact = await server.inject({
      headers: authorization("fixture|owner-alpha"),
      method: "POST",
      payload: { sceneJobId: confirmed.confirmation.sceneJobId },
      url: exactUrl,
    });
    expect(exact.statusCode).toBe(202);
    expect(runtime.sceneRequests).toHaveLength(2);
    expect(runtime.sceneRequests[1]).toMatchObject({ branchRevision: 8, specificationRevision: 2 });

    for (const url of [
      exactUrl.replace("/revisions/2/", "/revisions/3/"),
      exactUrl.replace(created.specification.specificationId, randomUUID()),
    ]) {
      const mismatch = await server.inject({
        headers: authorization("fixture|owner-alpha"),
        method: "POST",
        payload: { sceneJobId: confirmed.confirmation.sceneJobId },
        url,
      });
      expect(mismatch.statusCode).toBe(404);
      expect(mismatch.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(runtime.sceneRequests).toHaveLength(2);
  });
});
