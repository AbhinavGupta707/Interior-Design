import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerC10Module } from "../../src/c10.js";
import { InMemorySceneObjectStorage } from "../../src/modules/scenes/storage.js";
import { alphaProjectId } from "../c4/fixtures.js";
import { actors, FixtureProjectRepository, fixtureIdentity } from "../c6/support.js";
import { MemorySceneRepository, MemorySceneSnapshotVerifier, sceneRequest } from "./support.js";

const servers = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(async (server) => {
      await server.close();
    }),
  );
  servers.clear();
});

function options() {
  return {
    identity: fixtureIdentity(),
    projects: new FixtureProjectRepository(),
    repository: new MemorySceneRepository(),
    snapshotVerifier: new MemorySceneSnapshotVerifier(),
    storage: new InMemorySceneObjectStorage(),
  };
}

function createCommand() {
  const actor = actors["fixture|owner-alpha"];
  if (actor === undefined) throw new Error("C10 owner fixture is missing.");
  return {
    actor,
    correlation: {
      requestId: "c10-composition-request",
      spanId: "a".repeat(16),
      traceId: "b".repeat(32),
      traceParent: `00-${"b".repeat(32)}-${"a".repeat(16)}-01`,
    },
    idempotencyKey: "c10-composition-key",
    projectId: alphaProjectId,
    request: sceneRequest,
  };
}

describe("C10 executable compiler composition", () => {
  it("enables the exact production compiler descriptor only through explicit configuration", async () => {
    const server = Fastify({ logger: false });
    servers.add(server);
    const module = registerC10Module(
      server,
      "test",
      { C10_SCENE_WORKER_ENABLED: "true" },
      options(),
    );
    await expect(module.service.createJob(createCommand())).resolves.toMatchObject({
      job: { state: "queued" },
      replayed: false,
    });
    const compilerReadiness = module.readinessChecks.at(-1);
    if (compilerReadiness === undefined) throw new Error("C10 compiler readiness is missing.");
    await compilerReadiness.check({ signal: new AbortController().signal });
  });

  it("keeps no-worker mode honest and rejects malformed activation", async () => {
    const disabledServer = Fastify({ logger: false });
    servers.add(disabledServer);
    const disabled = registerC10Module(
      disabledServer,
      "test",
      { C10_SCENE_WORKER_ENABLED: "false" },
      options(),
    );
    await expect(disabled.service.createJob(createCommand())).rejects.toMatchObject({
      code: "SCENE_COMPILER_UNAVAILABLE",
    });
    const invalidServer = Fastify({ logger: false });
    servers.add(invalidServer);
    expect(() =>
      registerC10Module(invalidServer, "test", { C10_SCENE_WORKER_ENABLED: "yes" }, options()),
    ).toThrow("C10_SCENE_WORKER_ENABLED must be true or false");
  });
});
