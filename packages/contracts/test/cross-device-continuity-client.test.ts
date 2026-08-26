import { describe, expect, it, vi } from "vitest";

import {
  ContinuityApiError,
  CrossDeviceContinuityClient,
  continuityContract,
  createFetchContinuityTransport,
  type ContinuityTransport,
} from "../src/index.js";

const ids = {
  artifact: "14000000-0000-4000-8000-000000000001",
  branch: "12000000-0000-4000-8000-000000000001",
  camera: "14000000-0000-4000-8000-000000000002",
  commit: "12000000-0000-4000-8000-000000000002",
  confirmation: "12000000-0000-4000-8000-000000000003",
  job: "12000000-0000-4000-8000-000000000004",
  option: "12000000-0000-4000-8000-000000000005",
  preview: "12000000-0000-4000-8000-000000000006",
  project: "14000000-0000-4000-8000-000000000003",
  scene: "14000000-0000-4000-8000-000000000004",
  sceneJob: "14000000-0000-4000-8000-000000000005",
  user: "12000000-0000-4000-8000-000000000007",
} as const;
const hash = (character: string) => character.repeat(64);

describe("generated cross-device continuity TypeScript client", () => {
  it("embeds exact generator and OpenAPI pins", () => {
    expect(continuityContract.generatorVersion).toBe("interior-design-continuity-generator-1.0.1");
    expect(continuityContract.openApiVersion).toBe("3.1.2");
    expect(continuityContract.openApiSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("builds the canonical C12 path and validates response scope", async () => {
    const requests: string[] = [];
    const transport: ContinuityTransport = (request) => {
      requests.push(request.path);
      return Promise.resolve({
        body: {
          branchId: ids.branch,
          branchRevision: 1,
          commitId: ids.commit,
          confirmedAt: "2026-08-26T00:00:00.000Z",
          confirmedBy: ids.user,
          id: ids.confirmation,
          idempotencyKey: ids.confirmation,
          optionId: ids.option,
          previewId: ids.preview,
          projectId: ids.project,
          resultSnapshotSha256: hash("a"),
          schemaVersion: "c12-option-confirmation-v1",
        },
        status: 200,
      });
    };
    const client = new CrossDeviceContinuityClient(transport);
    await expect(
      client.getOptionConfirmation(ids.project, ids.job, ids.option),
    ).resolves.toMatchObject({ id: ids.confirmation });
    expect(requests).toEqual([
      `/v1/projects/${ids.project}/design-option-jobs/${ids.job}/options/${ids.option}/confirmation`,
    ]);
  });

  it("fails closed on cross-project eligibility", async () => {
    const client = new CrossDeviceContinuityClient(() =>
      Promise.resolve({
        body: {
          projectId: ids.project,
          schemaVersion: "c14-render-eligible-sources-v1",
          sources: [
            {
              cameras: [{ cameraId: ids.camera, label: "Camera 000002" }],
              label: "Scene 000005",
              source: {
                projectId: ids.job,
                sceneArtifactId: ids.artifact,
                sceneGlbSha256: hash("a"),
                sceneId: ids.scene,
                sceneJobId: ids.sceneJob,
                sceneManifestSha256: hash("b"),
                sourceSnapshotSha256: hash("c"),
              },
            },
          ],
        },
        status: 200,
      }),
    );
    await expect(client.listRenderEligibleSources(ids.project)).rejects.toBeInstanceOf(
      ContinuityApiError,
    );
  });

  it("uses an authenticated uncached JSON GET transport", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("{}", {
          headers: { "content-type": "application/json" },
          status: 404,
        }),
      ),
    );
    const transport = createFetchContinuityTransport({
      baseUrl: "https://continuity.example",
      bearerToken: () => Promise.resolve("fixture-token"),
      fetch: fetchMock,
    });
    await expect(
      transport({
        method: "GET",
        operationId: "listRenderEligibleSources",
        path: `/v1/projects/${ids.project}/render-eligible-sources`,
      }),
    ).resolves.toMatchObject({ body: {}, status: 404 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://continuity.example/v1/projects/${ids.project}/render-eligible-sources`,
    );
    expect(init).toMatchObject({ cache: "no-store", method: "GET" });
    expect(new Headers(init.headers).get("accept")).toBe(
      "application/json, application/problem+json",
    );
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-token");
  });
});
