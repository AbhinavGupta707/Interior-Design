import { describe, expect, it } from "vitest";

import {
  catalogArtifactResponseSchema,
  catalogAssetPageSchema,
  materialsProductsWorkspaceSchema,
  specificationScheduleLinesSchema,
} from "../../src/features/materials-products/contracts";
import { materialsProductsLaunchContextFromSearchParams } from "../../src/features/materials-products/launch-context";
import {
  assetsResponse,
  ids,
  ownerSession,
  project,
  releasesResponse,
  scheduleResponse,
  specificationsResponse,
} from "./fixtures";

describe("C13 web projection contracts", () => {
  it("binds session, project, release, specification, catalog page, and schedule", () => {
    expect(
      materialsProductsWorkspaceSchema.parse({
        evidenceClassification: "synthetic-fixture",
        project,
        releases: releasesResponse,
        session: ownerSession,
        specifications: specificationsResponse,
      }),
    ).toBeDefined();
    expect(catalogAssetPageSchema.parse(assetsResponse).total).toBe(5);
    expect(specificationScheduleLinesSchema.parse(scheduleResponse).lines).toHaveLength(3);
  });

  it("rejects foreign project data and fabricated commercial fields", () => {
    expect(
      materialsProductsWorkspaceSchema.safeParse({
        evidenceClassification: "synthetic-fixture",
        project,
        releases: releasesResponse,
        session: ownerSession,
        specifications: { ...specificationsResponse, projectId: ids.viewer },
      }).success,
    ).toBe(false);
    expect(
      catalogAssetPageSchema.safeParse({
        ...assetsResponse,
        assets: [
          {
            ...assetsResponse.assets[0],
            commercialData: {
              ...assetsResponse.assets[0]?.commercialData,
              price: "£500",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("treats confirmationId as validated request context only", () => {
    expect(
      materialsProductsLaunchContextFromSearchParams({ confirmationId: ids.confirmation }),
    ).toEqual({ confirmationId: ids.confirmation });
    expect(
      materialsProductsLaunchContextFromSearchParams({ confirmationId: "forged" }),
    ).toBeUndefined();
    expect(
      materialsProductsLaunchContextFromSearchParams({
        confirmationId: [ids.confirmation, ids.viewer],
      }),
    ).toEqual({ confirmationId: ids.confirmation });
  });

  it("accepts only privacy-minimised, bounded signed artifact access", () => {
    const access = {
      artifactId: ids.model,
      byteLength: 512,
      expiresAt: "2027-07-18T13:00:00.000Z",
      mediaType: "model/gltf-binary",
      sha256: "a".repeat(64),
      url: `http://127.0.0.1:4351/signed/catalog/${ids.model}?signature=synthetic`,
    };
    expect(catalogArtifactResponseSchema.parse(access)).toEqual(access);
    expect(
      catalogArtifactResponseSchema.safeParse({ ...access, objectKey: "catalog/private/key" })
        .success,
    ).toBe(false);
    expect(
      catalogArtifactResponseSchema.safeParse({
        ...access,
        url: "http://catalog.example.test/private.glb",
      }).success,
    ).toBe(false);
    expect(
      catalogArtifactResponseSchema.safeParse({
        ...access,
        url: "https://user:secret@catalog.example.test/private.glb#token",
      }).success,
    ).toBe(false);
    expect(
      catalogArtifactResponseSchema.safeParse({
        ...access,
        byteLength: 64 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
    expect(
      catalogArtifactResponseSchema.safeParse({
        ...access,
        url: `https://catalog.example.test/${"a".repeat(8_192)}`,
      }).success,
    ).toBe(false);
  });
});
