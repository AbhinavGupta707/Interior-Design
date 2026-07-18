import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../../src/correlation.js";
import { registerErrorHandling } from "../../../src/errors.js";
import { InMemoryCatalogRepository } from "../../../src/modules/catalog/memory.js";
import { registerCatalogRoutes } from "../../../src/modules/catalog/routes.js";
import { CatalogService } from "../../../src/modules/catalog/service.js";
import { InMemoryCatalogArtifactStorage } from "../../../src/modules/catalog/storage.js";
import { alphaProjectId } from "../../c4/fixtures.js";
import { FixtureProjectRepository, fixtureIdentity, tokenFor } from "../../c6/support.js";
import { createCatalogApiFixture, type CatalogApiFixture } from "./support.js";

const now = new Date("2026-07-18T12:00:00.000Z");

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog API fixture is incomplete.");
  return value;
}

function authorization(subject: Parameters<typeof tokenFor>[0]): {
  readonly authorization: string;
} {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

describe("C13 isolated catalog routes", () => {
  let fixture: CatalogApiFixture;
  let repository: InMemoryCatalogRepository;
  let server: FastifyInstance;
  let storage: InMemoryCatalogArtifactStorage;

  beforeAll(async () => {
    fixture = await createCatalogApiFixture();
  });

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new InMemoryCatalogRepository([
      { assets: fixture.publication.assets, release: fixture.publication.release },
    ]);
    storage = new InMemoryCatalogArtifactStorage({ now: () => now });
    for (const asset of fixture.publication.assets) {
      for (const artifact of asset.artifacts) {
        storage.putForTest(artifact, required(fixture.artifactBytes.get(artifact.artifactId)));
      }
    }
    registerCatalogRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      new CatalogService({ clock: { now: () => now }, repository, storage }),
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it("serves the sorted release and rights-safe assets to an authorised project viewer", async () => {
    const headers = authorization("fixture|viewer-alpha");
    const releases = await server.inject({
      headers,
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/catalog/releases`,
    });
    expect(releases.statusCode).toBe(200);
    expect(releases.json<{ releases: unknown[] }>().releases).toEqual([
      fixture.publication.release,
    ]);

    const assets = await server.inject({
      headers,
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/catalog/releases/${fixture.publication.release.releaseId}/assets`,
    });
    expect(assets.statusCode).toBe(200);
    const body = assets.json<{ assets: typeof fixture.publication.assets }>();
    expect(body.assets).toHaveLength(11);
    expect(assets.json()).toMatchObject({
      releaseId: fixture.publication.release.releaseId,
      total: 11,
    });
    expect(body.assets.map(({ versionId }) => versionId)).toEqual(
      [...body.assets.map(({ versionId }) => versionId)].sort(),
    );
    for (const asset of body.assets) {
      expect(asset.commercialData).toEqual({
        delivery: "not-provided",
        liveAvailability: "not-provided",
        price: "not-provided",
        supplier: "not-provided",
      });
      expect(asset.rights.policy.trainingAllowed).toBe(false);
    }
  });

  it("filters deterministically and paginates a stable sorted result with an opaque cursor", async () => {
    const baseUrl = `/v1/projects/${alphaProjectId}/catalog/releases/${fixture.publication.release.releaseId}/assets`;
    const headers = authorization("fixture|viewer-alpha");
    const filtered = await server.inject({
      headers,
      method: "GET",
      url: `${baseUrl}?kind=finish&rights=approved&source=creator-owned-synthetic&query=FLOOR&limit=1`,
    });
    expect(filtered.statusCode).toBe(200);
    const first = filtered.json<{
      assets: typeof fixture.publication.assets;
      nextCursor?: string;
      releaseId: string;
      total: number;
    }>();
    expect(first).toMatchObject({ releaseId: fixture.publication.release.releaseId, total: 2 });
    expect(first.assets).toHaveLength(1);
    expect(first.assets[0]?.kind).toBe("finish");
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    const cursor = required(first.nextCursor);

    const secondResponse = await server.inject({
      headers,
      method: "GET",
      url: `${baseUrl}?kind=finish&rights=approved&source=creator-owned-synthetic&query=FLOOR&limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(secondResponse.statusCode).toBe(200);
    const second = secondResponse.json<{
      assets: typeof fixture.publication.assets;
      nextCursor?: string;
      total: number;
    }>();
    expect(second.total).toBe(2);
    expect(second.assets).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    const versionIds = [first.assets[0]?.versionId, second.assets[0]?.versionId];
    expect(new Set(versionIds).size).toBe(2);
    expect(versionIds).toEqual([...versionIds].sort());
  });

  it("accepts the exact L3 default query wire shape as an unfiltered first page", async () => {
    const response = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/catalog/releases/${fixture.publication.release.releaseId}/assets?kind=all&rights=all&source=all&query=&limit=24`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      assets: fixture.publication.assets,
      releaseId: fixture.publication.release.releaseId,
      total: 11,
    });
  });

  it("accepts one exact non-default kind filter while preserving the response envelope", async () => {
    const response = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/catalog/releases/${fixture.publication.release.releaseId}/assets?kind=light&rights=all&source=all&query=&limit=24`,
    });
    expect(response.statusCode).toBe(200);
    const page = response.json<{ assets: typeof fixture.publication.assets; total: number }>();
    expect(page.total).toBe(
      fixture.publication.assets.filter(({ kind }) => kind === "light").length,
    );
    expect(page.assets.every(({ kind }) => kind === "light")).toBe(true);
  });

  it("strictly rejects unbounded filters and does not disclose cursor or project state", async () => {
    const baseUrl = `/v1/projects/${alphaProjectId}/catalog/releases/${fixture.publication.release.releaseId}/assets`;
    const headers = authorization("fixture|owner-alpha");
    for (const query of [
      "limit=25",
      "limit=01",
      "kind=product",
      "rights=pending",
      "source=remote",
      "query=%3Cscript%3E",
      "unknown=value",
    ]) {
      const response = await server.inject({ headers, method: "GET", url: `${baseUrl}?${query}` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    const attackedCursor = "synthetic-private-cursor";
    const invalidCursor = await server.inject({
      headers,
      method: "GET",
      url: `${baseUrl}?cursor=${attackedCursor}`,
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json()).toMatchObject({ code: "INVALID_CATALOG_CURSOR" });
    expect(invalidCursor.body).not.toContain(attackedCursor);

    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url: `${baseUrl}?limit=25`,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("redacts an internal licensed-source URI from every public asset response", async () => {
    const asset = required(fixture.publication.assets[0]);
    const internalUri = "https://rights-ledger.invalid/internal/receipt/creator-fixture";
    const repositoryWithUri = new InMemoryCatalogRepository([
      {
        assets: fixture.publication.assets.map((candidate) =>
          candidate.versionId === asset.versionId
            ? { ...candidate, rights: { ...candidate.rights, sourceUri: internalUri } }
            : candidate,
        ),
        release: fixture.publication.release,
      },
    ]);
    const isolated = Fastify({ logger: false });
    registerRequestCorrelation(isolated);
    registerErrorHandling(isolated);
    registerCatalogRoutes(
      isolated,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      new CatalogService({ repository: repositoryWithUri, storage }),
    );
    const response = await isolated.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/catalog/releases/${fixture.publication.release.releaseId}/assets/${asset.versionId}`,
    });
    await isolated.close();
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(internalUri);
    expect(response.json<{ rights: { sourceUri?: string } }>().rights.sourceUri).toBeUndefined();
  });

  it("returns short-lived no-store artifact access and records a redacted audit identity", async () => {
    const artifact = required(required(fixture.publication.assets[0]).artifacts[0]);
    const response = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "x-request-id": "catalog-request-0001",
      },
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/catalog/artifacts/${artifact.artifactId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      artifactId: artifact.artifactId,
      byteLength: artifact.byteLength,
      expiresAt: "2026-07-18T12:05:00.000Z",
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
    });
    expect(repository.accessEvents).toEqual([
      expect.objectContaining({
        artifactId: artifact.artifactId,
        correlationId: "req-1",
        projectId: alphaProjectId,
      }),
    ]);
  });

  it("authenticates and checks project membership before catalog disclosure", async () => {
    const url = `/v1/projects/${alphaProjectId}/catalog/releases`;
    const anonymous = await server.inject({ method: "GET", url });
    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url,
    });
    const malformed = await server.inject({
      headers: authorization("fixture|owner-alpha"),
      method: "GET",
      url: "/v1/projects/not-a-project/catalog/releases",
    });
    expect(anonymous.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(400);
  });
});
