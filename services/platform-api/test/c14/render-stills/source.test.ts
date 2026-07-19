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
    readonly binding?: AuthoritativeSpecificationBinding;
    readonly scene?: AuthoritativeSucceededScene;
  } = {},
) {
  return new PortBackedRenderSourceResolver({
    embedded: { inspect: () => Promise.resolve(overrides.binding ?? binding) },
    profiles: {
      resolve: () => ({ estimatedJobBytes: 1_000_000, requiredCapability: "cycles.cpu.v1" }),
    },
    scenes: { findSucceededScene: () => Promise.resolve(overrides.scene ?? scene) },
    specifications: {
      resolveSceneBinding: () => Promise.resolve(overrides.binding ?? binding),
    },
  });
}

describe("C14 authoritative source resolution", () => {
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
      scenes: { findSucceededScene: () => Promise.resolve(undefined) },
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
