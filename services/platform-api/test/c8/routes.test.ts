import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerReconstructionRoutes } from "../../src/modules/reconstruction/routes.js";
import { ReconstructionService } from "../../src/modules/reconstruction/service.js";
import { FixtureProjectRepository, c6Project, fixtureIdentity, tokenFor } from "../c6/support.js";
import {
  abstainedResult,
  completedResult,
  MemoryReconstructionRepository,
  reconstructionRequest,
} from "./support.js";

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

describe("C8 public reconstruction routes", () => {
  let repository: MemoryReconstructionRepository;
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new MemoryReconstructionRepository();
    registerReconstructionRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      new ReconstructionService(repository),
    );
  });

  afterEach(async () => server.close());

  it("creates and exactly replays, then lets a viewer list and read without mutation", async () => {
    const url = `/v1/projects/${c6Project.id}/reconstruction-jobs`;
    const create = {
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c8-route-create-0001",
      },
      method: "POST" as const,
      payload: reconstructionRequest,
      url,
    };
    const created = await server.inject(create);
    const replayed = await server.inject(create);
    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(created.json());
    const job = created.json<{ readonly id: string }>();

    const listed = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ readonly jobs: unknown[] }>().jobs).toHaveLength(1);
    expect(
      (
        await server.inject({
          headers: authorization("fixture|viewer-alpha"),
          method: "GET",
          url: `${url}/${job.id}`,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("enforces viewer read-only behavior and foreign-tenant non-disclosure", async () => {
    const url = `/v1/projects/${c6Project.id}/reconstruction-jobs`;
    const denied = await server.inject({
      headers: {
        ...authorization("fixture|viewer-alpha"),
        "idempotency-key": "c8-viewer-create-0001",
      },
      method: "POST",
      payload: reconstructionRequest,
      url,
    });
    expect(denied.statusCode).toBe(403);
    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url,
    });
    expect(foreign.statusCode).toBe(404);
    expect(repository.jobs.size).toBe(0);
  });

  it("requires optimistic versions and allows a cancelled job to create one fenced retry attempt", async () => {
    const url = `/v1/projects/${c6Project.id}/reconstruction-jobs`;
    const created = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c8-transition-create-0001",
      },
      method: "POST",
      payload: reconstructionRequest,
      url,
    });
    const first = created.json<{ readonly id: string; readonly version: number }>();
    const stale = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c8-transition-stale-0001",
      },
      method: "POST",
      payload: { expectedVersion: 99 },
      url: `${url}/${first.id}/cancel`,
    });
    expect(stale.statusCode).toBe(409);
    const cancelled = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c8-transition-cancel-0001",
      },
      method: "POST",
      payload: { expectedVersion: first.version },
      url: `${url}/${first.id}/cancel`,
    });
    const terminal = cancelled.json<{ readonly version: number }>();
    const retried = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c8-transition-retry-0001",
      },
      method: "POST",
      payload: { expectedVersion: terminal.version },
      url: `${url}/${first.id}/retry`,
    });
    expect(retried.json()).toMatchObject({ attempt: 2, state: "created", retryable: false });
  });

  it("returns only validated completed and abstained result envelopes", async () => {
    const url = `/v1/projects/${c6Project.id}/reconstruction-jobs`;
    const create = async (key: string) => {
      const response = await server.inject({
        headers: {
          ...authorization("fixture|owner-alpha"),
          "idempotency-key": key,
        },
        method: "POST",
        payload: reconstructionRequest,
        url,
      });
      return response.json<{ readonly id: string }>();
    };
    const completedJob = await create("c8-result-completed-0001");
    const sourceManifestSha256 = repository.lastCreate?.sourceManifestSha256;
    if (!sourceManifestSha256) throw new Error("Synthetic source manifest hash was not captured.");
    repository.results.set(
      completedJob.id,
      completedResult({ jobId: completedJob.id, sourceManifestSha256 }),
    );
    const completed = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${url}/${completedJob.id}/result`,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: "completed" });

    const abstainedJob = await create("c8-result-abstained-0001");
    repository.results.set(
      abstainedJob.id,
      abstainedResult({ jobId: abstainedJob.id, sourceManifestSha256 }),
    );
    const abstained = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${url}/${abstainedJob.id}/result`,
    });
    expect(abstained.statusCode).toBe(200);
    expect(abstained.json()).toMatchObject({
      safeCode: "INSUFFICIENT_OVERLAP",
      status: "abstained",
    });
    expect(JSON.stringify([completed.json(), abstained.json()])).not.toMatch(
      /sourceObjectKey|objectKey|signedUrl|rawMedia|credential/u,
    );
  });
});
