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
    const module = registerC14Module(
      server,
      "test",
      {},
      {
        identity: fixtureIdentity(),
        projects: new FixtureProjectRepository(),
        repository: new StubRenderRepository(),
        storage: new InMemoryRenderObjectStorage(),
      },
    );

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
      hardwareEvidence: "deferred",
    });
    expect(body.profiles).toHaveLength(5);
    expect(body.profiles.every((profile) => !profile.available)).toBe(true);
  });

  it("advertises exactly one profile only with complete authorised-host pins", async () => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    registerC14Module(
      server,
      "test",
      {
        C14_BLENDER_BUILD_HASH: "fbe6228777e7",
        C14_BLENDER_VERSION: "5.2.0 LTS",
        C14_RENDER_EXECUTABLE_SHA256: "a".repeat(64),
        C14_RENDER_OCIO_SHA256: "e".repeat(64),
        C14_RENDER_HARDWARE_EVIDENCE: "verified-authorised-host",
        C14_RENDER_HOST_ACCEPTANCE_SHA256: "b".repeat(64),
        C14_RENDER_HOST_FINGERPRINT_SHA256: "c".repeat(64),
        C14_RENDER_PROFILE_ID: "cycles-cpu-geometry-safe-v1",
        C14_RENDERER_SCRIPT_SHA256: "d".repeat(64),
        C14_RENDER_WORKER_ENABLED: "true",
      },
      {
        identity: fixtureIdentity(),
        projects: new FixtureProjectRepository(),
        repository: new StubRenderRepository(),
        storage: new InMemoryRenderObjectStorage(),
      },
    );

    const response = await server.inject({
      headers: { authorization: `Bearer ${tokenFor("fixture|owner-alpha")}` },
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/render-capabilities`,
    });

    const body = capabilityResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      acceptingNewJobs: true,
      enhancementProvider: "disabled",
      hardwareEvidence: "verified-authorised-host",
    });
    expect(body.profiles.filter((profile) => profile.available)).toEqual([
      expect.objectContaining({ profileId: "cycles-cpu-geometry-safe-v1" }),
    ]);
  });

  it("fails closed when an otherwise complete enabled worker lacks the OCIO attestation", () => {
    const incomplete = {
      C14_BLENDER_BUILD_HASH: "fbe6228777e7",
      C14_BLENDER_VERSION: "5.2.0 LTS",
      C14_RENDER_EXECUTABLE_SHA256: "a".repeat(64),
      C14_RENDER_HARDWARE_EVIDENCE: "verified-authorised-host",
      C14_RENDER_HOST_ACCEPTANCE_SHA256: "b".repeat(64),
      C14_RENDER_HOST_FINGERPRINT_SHA256: "c".repeat(64),
      C14_RENDER_PROFILE_ID: "cycles-cpu-geometry-safe-v1",
      C14_RENDERER_SCRIPT_SHA256: "d".repeat(64),
      C14_RENDER_WORKER_ENABLED: "true",
    };
    server = Fastify({ logger: false });
    expect(() =>
      registerC14Module(server as FastifyInstance, "test", incomplete, {
        identity: fixtureIdentity(),
        projects: new FixtureProjectRepository(),
        repository: new StubRenderRepository(),
        storage: new InMemoryRenderObjectStorage(),
      }),
    ).toThrow(/verified authorised-host acceptance pins/u);
  });
});
