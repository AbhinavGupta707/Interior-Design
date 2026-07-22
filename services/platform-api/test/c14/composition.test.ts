import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { registerC14Module } from "../../src/c14.js";
import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { InMemoryRenderObjectStorage } from "../../src/modules/render-stills/storage.js";
import { FixtureProjectRepository, fixtureIdentity, tokenFor } from "../c6/support.js";
import { alphaProjectId } from "../c4/fixtures.js";
import { StubRenderRepository } from "./render-stills/support.js";

const capabilityResponseSchema = z.looseObject({
  acceptingNewJobs: z.boolean(),
  enhancementProvider: z.enum(["disabled", "enabled"]),
  hardwareEvidence: z.enum(["deferred", "verified-authorised-host"]),
  profiles: z.array(z.looseObject({ available: z.boolean() })),
});

describe("C14 API composition", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("registers a truthful disabled capability route without a configured worker", async () => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    const module = registerC14Module(server, "test", {}, {
      identity: fixtureIdentity(),
      projects: new FixtureProjectRepository(),
      repository: new StubRenderRepository(),
      storage: new InMemoryRenderObjectStorage(),
    });

    for (const readiness of module.readinessChecks) {
      await readiness.check({ signal: new AbortController().signal });
    }
    const response = await server.inject({
      headers: { authorization: `Bearer ${tokenFor("fixture|owner-alpha")}` },
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/render-capabilities`,
    });

    expect(response.statusCode).toBe(200);
    const body = capabilityResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      acceptingNewJobs: false,
      enhancementProvider: "disabled",
      hardwareEvidence: "verified-authorised-host",
    });
    expect(body.profiles).toHaveLength(5);
    expect(body.profiles.every((profile) => !profile.available)).toBe(true);
  });
});
