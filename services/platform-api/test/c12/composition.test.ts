import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerC12Module } from "../../src/c12.js";
import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { FixtureProjectRepository, fixtureIdentity, tokenFor } from "../c6/support.js";
import { constraintDeriver, projectId, request, testRuntime } from "./support.js";

describe("C12 production composition", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("registers the production catalog, service, worker boundary, routes and readiness", async () => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    const runtime = testRuntime();
    const module = registerC12Module(
      server,
      "test",
      {},
      {
        constraintDeriver,
        identity: fixtureIdentity(),
        projects: new FixtureProjectRepository(),
        repository: runtime.repository,
        sourceVerifier: runtime.sources,
      },
    );

    for (const readiness of module.readinessChecks) {
      await readiness.check({ signal: new AbortController().signal });
    }
    const response = await server.inject({
      headers: {
        authorization: `Bearer ${tokenFor("fixture|owner-alpha")}`,
        "idempotency-key": "c1200000-0000-4000-8000-000000000099",
      },
      method: "POST",
      payload: request,
      url: `/v1/projects/${projectId}/design-option-jobs`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ projectId, state: "queued" });
    expect(await module.worker.claimNext({ workerId: "c12-composition-worker" })).toMatchObject({
      job: { projectId },
    });
  });
});
