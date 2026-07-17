import { describe, expect, it } from "vitest";

import {
  assertWithinClientBudget,
  fetchVerifiedGlb,
  inspectGlb,
  SceneIntegrityError,
  sha256Hex,
  verifySceneTuple,
} from "../../src/features/viewer-3d/scene-verification";
import { access, job, makeGlb, manifest, scene } from "./fixtures";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported canonical value.");
}

describe("C10 scene tuple and GLB verification", () => {
  it("accepts one exact source/scene/access tuple and rejects manifest or scene mismatches", async () => {
    const manifestSha256 = await sha256Hex(canonicalJson(manifest));
    const exactScene = {
      ...scene,
      artifact: { ...scene.artifact, manifestSha256 },
    };
    const exactAccess = { ...access, manifestSha256 };
    await expect(verifySceneTuple(job, exactScene, exactAccess)).resolves.toBeUndefined();
    await expect(
      verifySceneTuple(
        job,
        { ...exactScene, id: "a1000000-0000-4000-8000-000000000099" },
        exactAccess,
      ),
    ).rejects.toMatchObject({ code: "SCENE_TUPLE_MISMATCH" });
    await expect(
      verifySceneTuple(
        job,
        { ...exactScene, artifact: { ...exactScene.artifact, manifestSha256: "f".repeat(64) } },
        exactAccess,
      ),
    ).rejects.toBeInstanceOf(SceneIntegrityError);
  });

  it("rejects malformed headers, count mismatches, external URIs, active content and extensions", () => {
    const corrupt = makeGlb();
    new DataView(corrupt).setUint32(0, 0, true);
    expect(() => inspectGlb(corrupt, manifest)).toThrow(/invalid GLB header/u);
    expect(() => inspectGlb(makeGlb({ nodes: [{}] }), manifest)).toThrow(
      /immutable manifest counts/u,
    );
    expect(() =>
      inspectGlb(makeGlb({ images: [{ uri: "https://attacker.invalid/a.png" }] }), manifest),
    ).toThrow(/external or data URI/u);
    expect(() =>
      inspectGlb(makeGlb({ extras: { note: "javascript:alert(1)" } }), manifest),
    ).toThrow(/active-content/u);
    expect(() =>
      inspectGlb(makeGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] }), manifest),
    ).toThrow(/requires an extension/u);
  });

  it("downloads exact GLB bytes, reports progress and rejects hash/content/length mismatch", async () => {
    const glb = makeGlb();
    const glbSha256 = await sha256Hex(glb);
    const exactAccess = { ...access, byteSize: glb.byteLength, glbSha256 };
    const progress: string[] = [];
    const transport = () =>
      Promise.resolve(
        new Response(glb, {
          headers: {
            "content-length": String(glb.byteLength),
            "content-type": "model/gltf-binary",
          },
        }),
      );
    const verified = await fetchVerifiedGlb(exactAccess, manifest, {
      onProgress: ({ phase }) => {
        progress.push(phase);
      },
      transport,
    });
    expect(verified.bytes).toBeInstanceOf(ArrayBuffer);
    expect(progress).toContain("verifying");
    await expect(
      fetchVerifiedGlb({ ...exactAccess, glbSha256: "0".repeat(64) }, manifest, { transport }),
    ).rejects.toMatchObject({ code: "GLB_HASH_MISMATCH" });
    await expect(
      fetchVerifiedGlb(exactAccess, manifest, {
        transport: () =>
          Promise.resolve(new Response(glb, { headers: { "content-type": "text/html" } })),
      }),
    ).rejects.toMatchObject({ code: "CONTENT_TYPE_MISMATCH" });
  });

  it("routes scenes above the frozen interactive client budget to fallback", () => {
    expect(() => {
      assertWithinClientBudget(
        {
          ...manifest,
          counts: { ...manifest.counts, triangles: 750_001 },
        },
        1_024,
      );
    }).toThrow(/interactive device budget/u);
  });
});
