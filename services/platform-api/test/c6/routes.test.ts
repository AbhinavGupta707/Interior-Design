import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerPlanProcessingRoutes } from "../../src/modules/plan-processing/routes.js";
import { PlanProcessingService } from "../../src/modules/plan-processing/service.js";
import {
  FixtureProjectRepository,
  MemoryPlanProcessingRepository,
  c6Project,
  fixtureIdentity,
  planAssetId,
  tokenFor,
} from "./support.js";

function authorization(token: string): { readonly authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe("C6 public plan-processing routes", () => {
  let server: FastifyInstance;
  let repository: MemoryPlanProcessingRepository;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new MemoryPlanProcessingRepository();
    registerPlanProcessingRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      new PlanProcessingService(repository),
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it("creates, replays, lists, reads and monotonically cancels one tenant-scoped job", async () => {
    const owner = tokenFor("fixture|owner-alpha");
    const request = {
      headers: { ...authorization(owner), "idempotency-key": "c6-create-job-0001" },
      method: "POST" as const,
      payload: { assetId: planAssetId, pageIndex: 0, parserPreference: "auto" },
      url: `/v1/projects/${c6Project.id}/plan-processing-jobs`,
    };
    const created = await server.inject(request);
    const replayed = await server.inject(request);
    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(created.json());
    const job = created.json<{ readonly id: string; readonly version: number }>();

    const listed = await server.inject({
      headers: authorization(tokenFor("fixture|viewer-alpha")),
      method: "GET",
      url: request.url,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ readonly jobs: readonly unknown[] }>().jobs).toHaveLength(1);

    const read = await server.inject({
      headers: authorization(tokenFor("fixture|viewer-alpha")),
      method: "GET",
      url: `${request.url}/${job.id}`,
    });
    expect(read.statusCode).toBe(200);

    const cancelled = await server.inject({
      headers: { ...authorization(owner), "idempotency-key": "c6-cancel-job-0001" },
      method: "POST",
      payload: { expectedVersion: job.version },
      url: `${request.url}/${job.id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ state: "cancelled", version: 2 });
  });

  it("reauthenticates role and project membership before mutation or disclosure", async () => {
    const viewerCreate = await server.inject({
      headers: {
        ...authorization(tokenFor("fixture|viewer-alpha")),
        "idempotency-key": "c6-viewer-denied-01",
      },
      method: "POST",
      payload: { assetId: planAssetId },
      url: `/v1/projects/${c6Project.id}/plan-processing-jobs`,
    });
    expect(viewerCreate.statusCode).toBe(403);

    const foreignRead = await server.inject({
      headers: authorization(tokenFor("fixture|owner-beta")),
      method: "GET",
      url: `/v1/projects/${c6Project.id}/plan-processing-jobs`,
    });
    expect(foreignRead.statusCode).toBe(404);
    expect(repository.jobs.size).toBe(0);
  });

  it("requires the frozen idempotency key bounds before any create", async () => {
    const response = await server.inject({
      headers: { ...authorization(tokenFor("fixture|owner-alpha")), "idempotency-key": "short" },
      method: "POST",
      payload: { assetId: planAssetId },
      url: `/v1/projects/${c6Project.id}/plan-processing-jobs`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(repository.jobs.size).toBe(0);
  });
});
