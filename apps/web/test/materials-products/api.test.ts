import { describe, expect, it, vi } from "vitest";

import {
  MaterialsProductsProblem,
  createMaterialsProductsClient,
} from "../../src/features/materials-products/api";
import {
  assetsResponse,
  confirmation,
  ids,
  preview,
  releasesResponse,
  requestedConfirmation,
  retryRequiredConfirmation,
  specification,
  specificationRevisionTwo,
  specificationsResponse,
} from "./fixtures";

const mutationId = "c1300000-0000-4000-8000-000000000099";

describe("C13 typed browser client", () => {
  it("builds bounded catalog filters and validates exact list responses", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(assetsResponse));
    const client = createMaterialsProductsClient(transport, () => mutationId);
    const result = await client.listCatalogAssets(ids.project, ids.release, {
      cursor: "opaque-cursor",
      kind: "furnishing",
      pageSize: 9,
      query: "generic sofa",
      rights: "approved",
      source: "licensed-local",
    });
    expect(result.total).toBe(5);
    const [url] = transport.mock.calls[0] as [string];
    expect(url).toContain("query=generic+sofa");
    expect(url).toContain("cursor=opaque-cursor");
    expect(url).toContain("source=licensed-local");
  });

  it("pins board updates, preview, and confirmation to exact revisions and hashes", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(specificationRevisionTwo))
      .mockResolvedValueOnce(Response.json(preview))
      .mockResolvedValueOnce(Response.json(requestedConfirmation));
    const client = createMaterialsProductsClient(transport, () => mutationId);
    await client.updateSelectionBoard(
      ids.project,
      specification,
      specification.selectionBoard.entries,
    );
    await client.createSubstitutionPreview(
      ids.project,
      specification,
      ids.assetSofa,
      ids.elementChair,
    );
    await client.confirmSubstitution(ids.project, specification, preview);
    const bodies = transport.mock.calls.map(([, init]) => {
      const body = (init as RequestInit).body;
      if (typeof body !== "string") throw new Error("Expected a JSON mutation body");
      return JSON.parse(body) as Record<string, unknown>;
    });
    expect(bodies[0]).toMatchObject({ expectedRevision: 1 });
    expect(bodies[1]).toMatchObject({
      elementId: ids.elementChair,
      expectedBranchRevision: 2,
      expectedSpecificationRevision: 1,
      replacementAssetVersionId: ids.assetSofa,
    });
    expect(bodies[2]).toMatchObject({
      expectedCandidateSnapshotSha256: preview.candidateSnapshotSha256,
      previewId: preview.previewId,
    });
    for (const [, init] of transport.mock.calls) {
      expect(new Headers((init as RequestInit).headers).get("idempotency-key")).toBe(mutationId);
    }
  });

  it("distinguishes scene states and retries the committed exact scene ID in a strict body", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(requestedConfirmation))
      .mockResolvedValueOnce(Response.json(retryRequiredConfirmation))
      .mockResolvedValueOnce(Response.json({ sceneJobId: ids.sceneJob }));
    const client = createMaterialsProductsClient(transport, () => mutationId);

    await expect(client.confirmSubstitution(ids.project, specification, preview)).resolves.toEqual(
      requestedConfirmation,
    );
    await expect(client.confirmSubstitution(ids.project, specification, preview)).resolves.toEqual(
      retryRequiredConfirmation,
    );
    await expect(
      client.requestExactScene(ids.project, ids.specification, 2, ids.sceneJob),
    ).resolves.toEqual({ sceneJobId: ids.sceneJob });

    const [retryUrl, retryInit] = transport.mock.calls[2] as [string, RequestInit];
    expect(retryUrl).toContain(`/specifications/${ids.specification}/revisions/2/scene-jobs`);
    expect(retryInit.method).toBe("POST");
    expect(retryInit.body).toBe(JSON.stringify({ sceneJobId: ids.sceneJob }));
    expect(new Headers(retryInit.headers).get("idempotency-key")).toBe(mutationId);
  });

  it("rejects raw or malformed confirmation envelopes and malformed or mismatched retry results", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(confirmation))
      .mockResolvedValueOnce(
        Response.json({ ...requestedConfirmation, sceneRequestState: "scene-ready" }),
      )
      .mockResolvedValueOnce(Response.json({ jobId: ids.sceneJob }))
      .mockResolvedValueOnce(Response.json({ sceneJobId: ids.viewer }));
    const client = createMaterialsProductsClient(transport);

    await expect(
      client.confirmSubstitution(ids.project, specification, preview),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    await expect(
      client.confirmSubstitution(ids.project, specification, preview),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    await expect(
      client.requestExactScene(ids.project, ids.specification, 2, ids.sceneJob),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    await expect(
      client.requestExactScene(ids.project, ids.specification, 2, ids.sceneJob),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("validates release/specification collections and rejects malformed upstream data", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(releasesResponse))
      .mockResolvedValueOnce(Response.json(specificationsResponse))
      .mockResolvedValueOnce(Response.json({ ...specificationsResponse, projectId: "foreign" }));
    const client = createMaterialsProductsClient(transport);
    await expect(client.listCatalogReleases(ids.project)).resolves.toEqual(releasesResponse);
    await expect(client.listSpecifications(ids.project)).resolves.toEqual(specificationsResponse);
    await expect(client.listSpecifications(ids.project)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("distinguishes offline, interruption, session expiry, and stale state", async () => {
    const offline = createMaterialsProductsClient(
      vi.fn().mockRejectedValue(new TypeError("offline")),
    );
    await expect(offline.listCatalogReleases(ids.project)).rejects.toMatchObject({
      kind: "offline",
    });
    const interrupted = createMaterialsProductsClient(
      vi.fn().mockRejectedValue(new DOMException("stopped", "AbortError")),
    );
    await expect(interrupted.listCatalogReleases(ids.project)).rejects.toMatchObject({
      kind: "interrupted",
    });
    const expired = createMaterialsProductsClient(
      vi.fn().mockResolvedValue(Response.json({ detail: "private" }, { status: 401 })),
    );
    await expect(expired.listCatalogReleases(ids.project)).rejects.toBeInstanceOf(
      MaterialsProductsProblem,
    );
    const stale = createMaterialsProductsClient(
      vi.fn().mockResolvedValue(Response.json({ code: "STALE_SPEC" }, { status: 409 })),
    );
    await expect(stale.listCatalogReleases(ids.project)).rejects.toMatchObject({
      code: "STALE_SPEC",
      kind: "conflict",
    });
  });
});
