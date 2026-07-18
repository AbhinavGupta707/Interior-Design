import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerDesignOptionRoutes } from "../../src/modules/design-options/routes.js";
import { FixtureProjectRepository, actors, fixtureIdentity, tokenFor } from "../c6/support.js";
import { projectId, request, testRuntime } from "./support.js";

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

describe("C12 public design-option routes", () => {
  let server: FastifyInstance;
  let runtime: ReturnType<typeof testRuntime>;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    runtime = testRuntime();
    registerDesignOptionRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      runtime.service,
    );
  });

  afterEach(async () => {
    delete actors["machine:c12-worker"];
    await server.close();
  });

  it("creates and replays exactly while viewer reads remain mutation-free", async () => {
    const idempotencyKey = "c12-route-create-0001";
    const route = `/v1/projects/${projectId}/design-option-jobs`;
    const create = {
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": idempotencyKey,
      },
      method: "POST" as const,
      payload: request,
      url: route,
    };
    const first = await server.inject(create);
    const replay = await server.inject(create);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
    const job = first.json<{ readonly id: string }>();

    const listed = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: route,
    });
    const fetched = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${route}/${job.id}`,
    });
    const options = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${route}/${job.id}/options`,
    });
    expect(listed.statusCode).toBe(200);
    expect(fetched.statusCode).toBe(200);
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({ options: [] });
    expect(runtime.repository.branches).toHaveLength(0);
  });

  it("enforces viewer mutation denial and foreign-tenant non-disclosure", async () => {
    const route = `/v1/projects/${projectId}/design-option-jobs`;
    const viewer = await server.inject({
      headers: {
        ...authorization("fixture|viewer-alpha"),
        "idempotency-key": "c12-viewer-create-0001",
      },
      method: "POST",
      payload: request,
      url: route,
    });
    const foreignList = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url: route,
    });
    const foreignGuess = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url: `${route}/${randomUUID()}`,
    });
    expect(viewer.statusCode).toBe(403);
    expect(foreignList.statusCode).toBe(404);
    expect(foreignGuess.statusCode).toBe(404);
    expect(runtime.repository.jobs).toHaveLength(0);
  });

  it("rejects client-authored constraints and machine-principal confirmation", async () => {
    const route = `/v1/projects/${projectId}/design-option-jobs`;
    const directConstraint = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c12-direct-constraint-0001",
      },
      method: "POST",
      payload: { ...request, constraints: [{ passed: true }] },
      url: route,
    });
    expect(directConstraint.statusCode).toBe(400);

    const owner = actors["fixture|owner-alpha"];
    if (owner === undefined) {
      throw new Error("owner fixture is required");
    }
    actors["machine:c12-worker"] = {
      ...owner,
      displayName: "Synthetic machine principal",
      subject: "machine:c12-worker",
    };
    const machine = await server.inject({
      headers: authorization("machine:c12-worker"),
      method: "POST",
      payload: {
        expectedBriefContentSha256: "a".repeat(64),
        expectedBriefRevision: 3,
        expectedJobVersion: 1,
        expectedOptionSetSha256: "b".repeat(64),
        expectedOptionStatus: "pending",
        expectedSourceSnapshotSha256: "c".repeat(64),
        idempotencyKey: randomUUID(),
      },
      url: `${route}/${randomUUID()}/options/${randomUUID()}/confirm`,
    });
    expect(machine.statusCode).toBe(403);
    expect(runtime.repository.branches).toHaveLength(0);
  });

  it("requires one matching UUID idempotency key at the direct confirmation boundary", async () => {
    const bodyKey = randomUUID();
    const url = `/v1/projects/${projectId}/design-option-jobs/${randomUUID()}/options/${randomUUID()}/confirm`;
    const payload = {
      expectedBriefContentSha256: "a".repeat(64),
      expectedBriefRevision: 3,
      expectedJobVersion: 1,
      expectedOptionSetSha256: "b".repeat(64),
      expectedOptionStatus: "pending",
      expectedSourceSnapshotSha256: "c".repeat(64),
      idempotencyKey: bodyKey,
    };
    const missing = await server.inject({
      headers: authorization("fixture|owner-alpha"),
      method: "POST",
      payload,
      url,
    });
    const invalid = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "not-a-uuid",
      },
      method: "POST",
      payload,
      url,
    });
    const mismatch = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": randomUUID(),
      },
      method: "POST",
      payload,
      url,
    });
    expect([missing.statusCode, invalid.statusCode, mismatch.statusCode]).toEqual([400, 400, 400]);
    expect(mismatch.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_MISMATCH" });
    expect(runtime.repository.effects).toHaveLength(0);
    expect(runtime.repository.branches).toHaveLength(0);
  });
});
