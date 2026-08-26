import { describe, expect, it } from "vitest";

import {
  PortBackedRenderSourceResolver,
  type AuthoritativeSucceededScene,
  type AuthoritativeSpecificationBinding,
} from "../../../src/modules/render-stills/source.js";
import { createHash } from "node:crypto";
import { hash, ids, request, source } from "./support.js";

const glbBytes = Buffer.from("authoritative-glb");
const glbSha256 = createHash("sha256").update(glbBytes).digest("hex");
const scene: AuthoritativeSucceededScene = {
  cameraIds: [ids.camera],
  glbBytes,
  projectId: ids.project,
  sceneArtifactId: ids.sceneArtifact,
  sceneGlbSha256: glbSha256,
  sceneId: ids.scene,
  sceneJobId: ids.sceneJob,
  sceneManifestSha256: hash("b"),
  sourceSnapshotSha256: hash("c"),
};
const authoritativeSource = { ...source, sceneGlbSha256: glbSha256 };

const binding: AuthoritativeSpecificationBinding = {
  allReferencedRightsActive: true,
  catalogReleaseId: ids.catalog,
  catalogReleaseSha256: hash("d"),
  specificationId: ids.specification,
  specificationRevision: 2,
  specificationRevisionSha256: hash("e"),
};

function resolver(
  overrides: {
    readonly binding?: AuthoritativeSpecificationBinding | null;
    readonly embeddedBinding?: AuthoritativeSpecificationBinding | null;
    readonly scene?: AuthoritativeSucceededScene;
  } = {},
) {
  const selectedBinding = overrides.binding === null ? undefined : (overrides.binding ?? binding);
  const selectedEmbeddedBinding =
    overrides.embeddedBinding === null ? undefined : (overrides.embeddedBinding ?? selectedBinding);
  return new PortBackedRenderSourceResolver({
    embedded: { inspect: () => Promise.resolve(selectedEmbeddedBinding) },
    profiles: {
      resolve: () => ({ estimatedJobBytes: 1_000_000, requiredCapability: "cycles.cpu.v1" }),
    },
    scenes: {
      findSucceededScene: () => Promise.resolve(overrides.scene ?? scene),
      listSucceededScenes: () => Promise.resolve([overrides.scene ?? scene]),
    },
    specifications: {
      resolveSceneBinding: () => Promise.resolve(selectedBinding),
    },
  });
}

describe("C14 authoritative source resolution", () => {
  it("discovers exact sorted source, camera and C13 pins from server authority", async () => {
    const eligible = await resolver({
      scene: { ...scene, cameraIds: [ids.camera, ids.camera] },
    }).listEligibleSources(ids.tenant, ids.project);
    expect(eligible).toEqual({
      projectId: ids.project,
      schemaVersion: "c14-render-eligible-sources-v1",
      sources: [
        {
          cameras: [{ cameraId: ids.camera, label: `Camera ${ids.camera.slice(-6)}` }],
          label: `Scene ${ids.sceneJob.slice(-6)}`,
          source: authoritativeSource,
        },
      ],
    });
  });

  it("omits sources with no mapped camera or inactive C13 rights", async () => {
    await expect(
      resolver({ scene: { ...scene, cameraIds: [] } }).listEligibleSources(ids.tenant, ids.project),
    ).resolves.toMatchObject({ sources: [] });
    await expect(
      resolver({ binding: { ...binding, allReferencedRightsActive: false } }).listEligibleSources(
        ids.tenant,
        ids.project,
      ),
    ).resolves.toMatchObject({ sources: [] });
  });

  it("fails discovery on malformed authority instead of fabricating empty eligibility", async () => {
    await expect(
      resolver({ scene: { ...scene, sceneGlbSha256: "invalid" } }).listEligibleSources(
        ids.tenant,
        ids.project,
      ),
    ).rejects.toBeDefined();
  });

  it("discovers unbound C10 scenes without fabricating a specification", async () => {
    const eligible = await resolver({ binding: null }).listEligibleSources(ids.tenant, ids.project);
    expect(eligible.sources[0]?.source.specification).toBeUndefined();
  });

  it("fails discovery when an embedded C13 binding is missing or mismatched in authority", async () => {
    await expect(
      resolver({ binding: null, embeddedBinding: binding }).listEligibleSources(
        ids.tenant,
        ids.project,
      ),
    ).rejects.toThrow(/do not match/u);
    await expect(
      resolver({
        embeddedBinding: { ...binding, specificationRevisionSha256: hash("9") },
      }).listEligibleSources(ids.tenant, ids.project),
    ).rejects.toThrow(/do not match/u);
  });

  it("rejects a selection whose rights become stale after discovery", async () => {
    let current = binding;
    const mutable = new PortBackedRenderSourceResolver({
      embedded: { inspect: () => Promise.resolve(binding) },
      profiles: {
        resolve: () => ({ estimatedJobBytes: 1_000_000, requiredCapability: "cycles.cpu.v1" }),
      },
      scenes: {
        findSucceededScene: () => Promise.resolve(scene),
        listSucceededScenes: () => Promise.resolve([scene]),
      },
      specifications: { resolveSceneBinding: () => Promise.resolve(current) },
    });
    await expect(mutable.listEligibleSources(ids.tenant, ids.project)).resolves.toMatchObject({
      sources: [{ source: { specification: { specificationRevision: 2 } } }],
    });
    current = { ...binding, allReferencedRightsActive: false };
    await expect(mutable.resolveForNewJob(ids.tenant, ids.project, request)).rejects.toMatchObject({
      code: "RENDER_C13_BINDING_MISMATCH",
    });
  });

  it("rejects a camera that is not in the authoritative mapped C10 camera set", async () => {
    await expect(
      resolver().resolveForNewJob(ids.tenant, ids.project, {
        ...request,
        cameraId: "c1400000-0000-4000-8000-000000000099",
      }),
    ).resolves.toBeUndefined();
  });

  it("derives every hash and rights pin from C10, C13 and GLB authority", async () => {
    const resolved = await resolver().resolveForNewJob(ids.tenant, ids.project, request);
    expect(resolved?.source).toEqual(authoritativeSource);
    expect(resolved?.estimatedJobBytes).toBe(1_000_000);
    expect(Object.keys(request)).not.toContain("sceneGlbSha256");
  });

  it("fails closed when the reviewed rights record is withdrawn", async () => {
    await expect(
      resolver({ binding: { ...binding, allReferencedRightsActive: false } }).resolveForNewJob(
        ids.tenant,
        ids.project,
        request,
      ),
    ).rejects.toMatchObject({ code: "RENDER_C13_BINDING_MISMATCH" });
  });

  it("does not disclose a foreign or missing C10 job", async () => {
    const isolated = new PortBackedRenderSourceResolver({
      embedded: { inspect: () => Promise.resolve(undefined) },
      profiles: { resolve: () => ({ estimatedJobBytes: 1, requiredCapability: "cycles.cpu.v1" }) },
      scenes: {
        findSucceededScene: () => Promise.resolve(undefined),
        listSucceededScenes: () => Promise.resolve([]),
      },
      specifications: { resolveSceneBinding: () => Promise.resolve(undefined) },
    });
    await expect(
      isolated.resolveForNewJob(ids.tenant, ids.project, request),
    ).resolves.toBeUndefined();
  });

  it("fails closed when authoritative C10 bytes do not match the retained GLB hash", async () => {
    await expect(
      resolver({ scene: { ...scene, glbBytes: Buffer.from("corrupt-glb") } }).resolveForNewJob(
        ids.tenant,
        ids.project,
        request,
      ),
    ).resolves.toBeUndefined();
  });

  it("revalidates the same immutable pins before publication", async () => {
    await expect(
      resolver().revalidatePinnedSource(ids.tenant, ids.project, authoritativeSource),
    ).resolves.toBe(true);
    await expect(
      resolver({
        binding: { ...binding, specificationRevisionSha256: hash("9") },
      }).revalidatePinnedSource(ids.tenant, ids.project, authoritativeSource),
    ).resolves.toBe(false);
  });
});
