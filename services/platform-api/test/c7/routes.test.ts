import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerCaptureRoutes } from "../../src/modules/capture/routes.js";
import { FixtureProjectRepository, c6Project, fixtureIdentity, tokenFor } from "../c6/support.js";
import { MemoryCaptureBackend, c7CaptureSessionId, c7UploadSessionId } from "./support.js";

const createBody = {
  captureLabel: "Visibly synthetic route capture",
  deviceCapability: "roomplan-lidar",
  expectedRoomCount: 1,
  mode: "single-room",
  rights: {
    basis: "owned-by-user",
    serviceProcessingConsent: true,
    trainingUseConsent: "denied",
  },
} as const;

function authorization(subject: Parameters<typeof tokenFor>[0]): {
  readonly authorization: string;
} {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

function mutationHeaders(subject: Parameters<typeof tokenFor>[0], key: string) {
  return { ...authorization(subject), "idempotency-key": key };
}

describe("C7 frozen native capture routes", () => {
  let server: FastifyInstance;
  let backend: MemoryCaptureBackend;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    backend = new MemoryCaptureBackend();
    registerCaptureRoutes(server, fixtureIdentity(), new FixtureProjectRepository(), backend);
  });

  afterEach(async () => {
    await server.close();
  });

  it("registers exactly the frozen capture route inventory", () => {
    const routes = server.printRoutes({ commonPrefix: false });
    for (const suffix of [
      "capture-sessions (POST, GET, HEAD)",
      ":captureSessionId (GET, HEAD)",
      "cancel (POST)",
      "retry (POST)",
      "artifact-upload-sessions (POST)",
      ":uploadSessionId (GET, HEAD)",
      "parts (POST)",
      "complete (POST)",
      "packages (POST)",
      "proposal (GET, HEAD)",
    ]) {
      expect(routes).toContain(suffix);
    }
  });

  it("creates, exactly replays, lists, reads, and cancels a scoped session", async () => {
    const request = {
      headers: mutationHeaders("fixture|owner-alpha", "c7-create-session-0001"),
      method: "POST" as const,
      payload: createBody,
      url: `/v1/projects/${c6Project.id}/capture-sessions`,
    };
    const created = await server.inject(request);
    const replayed = await server.inject(request);
    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(created.json());

    const listed = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: request.url,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const read = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${request.url}/${c7CaptureSessionId}`,
    });
    expect(read.statusCode).toBe(200);

    const cancelled = await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c7-cancel-session-0001"),
      method: "POST",
      payload: {},
      url: `${request.url}/${c7CaptureSessionId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ state: "cancelled", version: 2 });
  });

  it("rejects idempotency substitution and malformed frozen request fields", async () => {
    const url = `/v1/projects/${c6Project.id}/capture-sessions`;
    const headers = mutationHeaders("fixture|owner-alpha", "c7-conflicting-session-01");
    expect(
      (await server.inject({ headers, method: "POST", payload: createBody, url })).statusCode,
    ).toBe(201);
    const conflict = await server.inject({
      headers,
      method: "POST",
      payload: { ...createBody, captureLabel: "Different synthetic bytes" },
      url,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const invalid = await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c7-invalid-session-0001"),
      method: "POST",
      payload: {
        ...createBody,
        rights: { ...createBody.rights, trainingUseConsent: "granted" },
      },
      url,
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("authorizes before tenant/project disclosure and denies viewer mutation", async () => {
    const url = `/v1/projects/${c6Project.id}/capture-sessions`;
    const denied = await server.inject({
      headers: mutationHeaders("fixture|viewer-alpha", "c7-viewer-denied-0001"),
      method: "POST",
      payload: createBody,
      url,
    });
    expect(denied.statusCode).toBe(403);
    expect(backend.sessions.size).toBe(0);

    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates and serves the checksum-bound artifact upload route sequence", async () => {
    const sessionsUrl = `/v1/projects/${c6Project.id}/capture-sessions`;
    await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c7-create-for-upload-01"),
      method: "POST",
      payload: createBody,
      url: sessionsUrl,
    });
    const uploadUrl = `${sessionsUrl}/${c7CaptureSessionId}/artifact-upload-sessions`;
    const upload = await server.inject({
      headers: mutationHeaders("fixture|editor-alpha", "c7-create-upload-0001"),
      method: "POST",
      payload: {
        byteSize: 1,
        contentType: "application/json",
        kind: "captured-room-json",
        roomId: "87000000-0000-4000-8000-000000000004",
        sha256: "a".repeat(64),
      },
      url: uploadUrl,
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({ state: "initiated", uploadSessionId: c7UploadSessionId });

    const checksum = Buffer.alloc(32, 1).toString("base64");
    const part = await server.inject({
      headers: mutationHeaders("fixture|editor-alpha", "c7-sign-upload-part-01"),
      method: "POST",
      payload: { byteSize: 1, checksumSha256: checksum, partNumber: 1 },
      url: `${uploadUrl}/${c7UploadSessionId}/parts`,
    });
    expect(part.statusCode).toBe(200);
    expect(part.json()).toMatchObject({ partNumber: 1 });

    const read = await server.inject({
      headers: authorization("fixture|editor-alpha"),
      method: "GET",
      url: `${uploadUrl}/${c7UploadSessionId}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ recordedPartNumbers: [1], state: "uploading" });

    const completed = await server.inject({
      headers: mutationHeaders("fixture|editor-alpha", "c7-complete-upload-001"),
      method: "POST",
      payload: { parts: [{ checksumSha256: checksum, etag: "synthetic-etag", partNumber: 1 }] },
      url: `${uploadUrl}/${c7UploadSessionId}/complete`,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ state: "completed" });
  });

  it("does not disclose absent proposals and requires a strict empty transition body", async () => {
    const sessionsUrl = `/v1/projects/${c6Project.id}/capture-sessions`;
    await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c7-create-for-proposal-1"),
      method: "POST",
      payload: createBody,
      url: sessionsUrl,
    });
    const absent = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${sessionsUrl}/${c7CaptureSessionId}/proposal`,
    });
    expect(absent.statusCode).toBe(404);

    const invalid = await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c7-cancel-invalid-body"),
      method: "POST",
      payload: { force: true },
      url: `${sessionsUrl}/${c7CaptureSessionId}/cancel`,
    });
    expect(invalid.statusCode).toBe(400);
  });
});
