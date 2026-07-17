import { describe, expect, it, vi } from "vitest";

import { createSceneClient, SceneProblem } from "../../src/features/viewer-3d/api";
import { job, project, session, sourceSnapshot } from "./fixtures";

describe("C10 browser client", () => {
  it("validates workspace responses and never accepts browser-provided role authority", async () => {
    const transport = vi.fn().mockResolvedValue(
      Response.json({
        evidenceClassification: "real-backend",
        jobs: [job],
        project,
        session,
        snapshots: [sourceSnapshot],
      }),
    );
    await expect(createSceneClient(transport).loadWorkspace(project.id)).resolves.toMatchObject({
      project: { id: project.id },
    });
    expect(String(transport.mock.calls[0]?.[0])).toContain(encodeURIComponent(project.id));
  });

  it("rejects malformed upstream data and classifies offline state without leaking URLs", async () => {
    const malformed = createSceneClient(() =>
      Promise.resolve(Response.json({ jobs: [], role: "owner" })),
    );
    await expect(malformed.loadWorkspace(project.id)).rejects.toMatchObject({
      kind: "invalid-response",
    });
    const offline = createSceneClient(() =>
      Promise.reject(new Error("https://signed.invalid/secret")),
    );
    const failure = await offline.loadWorkspace(project.id).catch((reason: unknown) => reason);
    expect(failure).toBeInstanceOf(SceneProblem);
    expect(String(failure)).not.toContain("signed.invalid");
  });

  it("adds an opaque idempotency key to short-lived access requests", async () => {
    const transport = vi.fn().mockResolvedValue(
      Response.json({
        byteSize: 1024,
        expiresAt: "2099-07-17T20:10:00.000Z",
        glbSha256: "a".repeat(64),
        manifestSha256: "b".repeat(64),
        mimeType: "model/gltf-binary",
        sceneId: job.sceneId,
        url: "http://127.0.0.1:4321/artifact.glb?signature=ephemeral",
      }),
    );
    await createSceneClient(transport).requestAccess(project.id, job.id);
    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(init.body).toBe("{}");
  });
});
