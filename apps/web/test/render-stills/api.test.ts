import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRenderStillsClient,
  RenderStillsProblem,
} from "../../src/features/render-stills/api";
import {
  access,
  availableCapabilities,
  enhancement,
  eligibleSources,
  hostCapabilities,
  ids,
  job,
  result,
  safeArtifact,
} from "./fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

function requestBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body) as unknown;
}

describe("C14 strict render-stills client", () => {
  it("uses exact routes, fresh idempotency and frozen create pins", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(hostCapabilities))
      .mockResolvedValueOnce(Response.json(eligibleSources))
      .mockResolvedValueOnce(Response.json({ jobs: [job] }))
      .mockResolvedValueOnce(Response.json(job, { status: 201 }))
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json(result))
      .mockResolvedValueOnce(Response.json(enhancement))
      .mockResolvedValueOnce(Response.json(access));
    const client = createRenderStillsClient(
      transport,
      () => "c1400000-0000-4000-8000-000000000099",
    );

    await expect(client.getCapabilities(ids.project)).resolves.toEqual(availableCapabilities);
    await expect(client.listJobs(ids.project)).resolves.toEqual({ jobs: [job] });
    await expect(client.createJob(ids.project, job.request)).resolves.toEqual(job);
    await expect(client.getJob(ids.project, ids.job)).resolves.toEqual(job);
    await expect(client.getResult(ids.project, ids.job)).resolves.toEqual(result);
    await expect(client.getEnhancement(ids.project, ids.job)).resolves.toEqual(enhancement);
    await expect(client.getArtifactAccess(ids.project, ids.job, safeArtifact)).resolves.toEqual(
      access,
    );

    const [, createInit] = transport.mock.calls[3] as [string, RequestInit];
    expect(new Headers(createInit.headers).get("idempotency-key")).toBe(
      "c1400000-0000-4000-8000-000000000099",
    );
    expect(requestBody(createInit)).toEqual(job.request);
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/c14/projects/${ids.project}/render-capabilities`,
      `/api/c14/projects/${ids.project}/render-eligible-sources`,
      `/api/c14/projects/${ids.project}/render-jobs`,
      `/api/c14/projects/${ids.project}/render-jobs`,
      `/api/c14/projects/${ids.project}/render-jobs/${ids.job}`,
      `/api/c14/projects/${ids.project}/render-jobs/${ids.job}/result`,
      `/api/c14/projects/${ids.project}/render-jobs/${ids.job}/enhancement`,
      `/api/c14/projects/${ids.project}/render-jobs/${ids.job}/artifacts/${safeArtifact.id}/access`,
    ]);
  });

  it("maps stale/offline/session failures without accepting malformed success", async () => {
    const stale = createRenderStillsClient(
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "STALE_RENDER_VERSION", detail: "Reload exact job." },
            { status: 409 },
          ),
        ),
    );
    await expect(stale.retry(ids.project, job)).rejects.toMatchObject({
      code: "STALE_RENDER_VERSION",
      kind: "conflict",
    });

    const offline = createRenderStillsClient(vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(offline.listJobs(ids.project)).rejects.toMatchObject({ kind: "offline" });

    const malformed = createRenderStillsClient(
      vi.fn().mockResolvedValue(Response.json({ jobs: [{ privateUrl: "PRIVATE" }] })),
    );
    await expect(malformed.listJobs(ids.project)).rejects.toBeInstanceOf(RenderStillsProblem);
    await expect(malformed.listJobs(ids.project)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });
});
