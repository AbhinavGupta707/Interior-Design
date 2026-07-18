import { c10ScenePolicy } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  RenderSceneError,
  buildRenderScene,
  c4MillimetresToBlenderMetres,
  deriveBlenderCamera,
  mapC4PointMmToBlenderMetres,
  parseProtectedC10Glb,
  segmentationColourForIndex,
  segmentationPaletteForElementIds,
} from "../src/index.js";
import {
  glbFromJsonAndBinary,
  glbFromJsonText,
  hash,
  ids,
  renderFixture,
  replaceFixtureGlb,
} from "./support.js";

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof RenderSceneError ? error.code : undefined;
  }
}

function clonedRecord<T>(value: T): T {
  return structuredClone(value);
}

describe("deterministic declarative render-scene builder", () => {
  it("builds one canonical non-self-referential manifest and external hash envelope", () => {
    const fixture = renderFixture();
    const result = buildRenderScene(fixture.input);

    expect(result.manifest).toMatchObject({
      authority: "derived-visualisation-only",
      coordinateMapping: "c4-z-up-to-blender-z-up-v1",
      schemaVersion: "c14-render-scene-manifest-v1",
      unknownPolicy: "omit-and-report",
      worldAssumption: "neutral-studio-no-address-or-daylight-inference-v1",
    });
    expect(result.envelope).toEqual({
      byteLength: result.canonicalBytes().byteLength,
      manifestSchemaVersion: "c14-render-scene-manifest-v1",
      schemaVersion: "c14-render-scene-external-sha256-v1",
      sha256: result.envelope.sha256,
    });
    expect(result.envelope.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.hasOwn(result.manifest, "manifestSha256")).toBe(false);
    expect(result.canonicalJson).not.toContain(result.envelope.sha256);
    expect(result.manifest.materials).toHaveLength(1);
    expect(result.manifest.materials[0]).toMatchObject({
      assetVersionSha256: (fixture.input.catalogAssetVersions[0] as { versionSha256: string })
        .versionSha256,
      elementId: ids.furnishing,
      representation: "validated-catalog-material",
      rightsRecordSha256: hash("rights"),
    });
    expect(result.manifest.lights.map(({ lightId }) => lightId)).toEqual([ids.pointLight]);
    expect(result.manifest.findings.map(({ code }) => code)).toEqual([
      "UNSUPPORTED_CANONICAL_LIGHT_KIND",
      "DAYLIGHT_REFERENCE_OMITTED",
    ]);
    expect(result.manifest.segmentationPalette).toEqual([
      { elementId: ids.furnishing, rgb8: [1, 0, 0] },
    ]);
    expect(result.manifest.protectedElementIds).toEqual(
      [...result.manifest.protectedElementIds].sort(),
    );

    const mutableCopy = result.canonicalBytes();
    mutableCopy[0] = 0;
    expect(result.canonicalBytes()[0]).toBe("{".charCodeAt(0));
  });

  it("uses a fixed neutral fallback while retaining exact C13 texture and rights hashes", () => {
    const fixture = renderFixture({ withTexture: true });
    const result = buildRenderScene(fixture.input);
    const material = result.manifest.materials[0];

    expect(material).toMatchObject({
      baseColourSrgb8: [153, 153, 153],
      emissiveSrgb8: [0, 0, 0],
      metallicBasisPoints: 0,
      representation: "status-aware-neutral-fallback",
      rightsRecordSha256: hash("rights"),
      roughnessBasisPoints: 8_000,
    });
    expect(material?.textureArtifactSha256).toEqual([hash("texture")]);
    expect(result.manifest.findings.map(({ code }) => code)).toContain("MATERIAL_UV_UNAVAILABLE");
  });

  it("is stable when authoritative JavaScript object keys arrive in reverse order", () => {
    const fixture = renderFixture();
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .reverse()
          .map(([key, child]) => [key, reverseKeys(child)]),
      );
    };
    const first = buildRenderScene(fixture.input);
    const reordered = {
      ...fixture.input,
      canonicalSnapshot: reverseKeys(
        fixture.input.canonicalSnapshot,
      ) as typeof fixture.input.canonicalSnapshot,
      catalogAssetVersions: reverseKeys(
        fixture.input.catalogAssetVersions,
      ) as typeof fixture.input.catalogAssetVersions,
      catalogRelease: reverseKeys(
        fixture.input.catalogRelease,
      ) as typeof fixture.input.catalogRelease,
      profile: reverseKeys(fixture.input.profile) as typeof fixture.input.profile,
      scene: reverseKeys(fixture.input.scene) as typeof fixture.input.scene,
      sceneJob: reverseKeys(fixture.input.sceneJob) as typeof fixture.input.sceneJob,
      specification: reverseKeys(fixture.input.specification) as typeof fixture.input.specification,
    };
    const second = buildRenderScene(reordered);
    expect(second.canonicalJson).toBe(first.canonicalJson);
    expect(second.envelope).toEqual(first.envelope);
  });

  it("rejects path- or environment-shaped profile pins before manifest construction", () => {
    const fixture = renderFixture();
    expect(
      errorCode(() =>
        buildRenderScene({
          ...fixture.input,
          profile: { ...fixture.input.profile, blenderVersion: "${HOME}/renderer.blend" },
        }),
      ),
    ).toBe("INPUT_INVALID");
  });
});

describe("C10/C13/GLB trust boundary", () => {
  it("rejects forged and stale C10 and C13 pins", () => {
    const fixture = renderFixture();
    const forgedScene = clonedRecord(fixture.input.scene);
    (forgedScene.artifact as { manifestSha256: string }).manifestSha256 =
      hash("forged-c10-manifest");
    expect(errorCode(() => buildRenderScene({ ...fixture.input, scene: forgedScene }))).toBe(
      "SOURCE_HASH_MISMATCH",
    );

    const staleSnapshot = clonedRecord(fixture.input.canonicalSnapshot);
    const limitation = staleSnapshot.knownLimitations[0];
    if (limitation === undefined) throw new Error("C14 fixture snapshot needs one limitation.");
    (limitation as { detail: string }).detail = "Stale canonical input.";
    expect(
      errorCode(() => buildRenderScene({ ...fixture.input, canonicalSnapshot: staleSnapshot })),
    ).toBe("CANONICAL_SOURCE_MISMATCH");

    const staleSpecification = clonedRecord(fixture.input.specification);
    (
      staleSpecification.currentRevision as typeof staleSpecification.currentRevision & {
        revisionSha256: string;
      }
    ).revisionSha256 = hash("stale-specification");
    expect(
      errorCode(() => buildRenderScene({ ...fixture.input, specification: staleSpecification })),
    ).toBe("C13_BINDING_MISMATCH");

    const forgedJson = clonedRecord(fixture.glbJson);
    const asset = forgedJson.asset as {
      extras: { c13SpecificationBinding: { catalogReleaseSha256: string } };
    };
    asset.extras.c13SpecificationBinding.catalogReleaseSha256 = hash("forged-release");
    const forgedGlb = glbFromJsonAndBinary(forgedJson, fixture.binary);
    const forgedFixture = replaceFixtureGlb(fixture, forgedGlb);
    expect(errorCode(() => buildRenderScene(forgedFixture.input))).toBe("C13_BINDING_MISMATCH");
  });

  it("rejects absent or duplicate GLB C13 bindings", () => {
    const fixture = renderFixture();
    const absentJson = clonedRecord(fixture.glbJson);
    delete (absentJson.asset as { extras?: unknown }).extras;
    const absent = replaceFixtureGlb(fixture, glbFromJsonAndBinary(absentJson, fixture.binary));
    expect(errorCode(() => buildRenderScene(absent.input))).toBe("C13_BINDING_MISMATCH");

    const duplicateJson = clonedRecord(fixture.glbJson);
    const nodes = duplicateJson.nodes as Array<{ extras: Record<string, unknown> }>;
    const materials = duplicateJson.materials as Array<{ extras: Record<string, unknown> }>;
    const firstMaterial = materials[0];
    const furnishingNode = nodes[1];
    if (firstMaterial === undefined || furnishingNode === undefined) {
      throw new Error("C14 fixture GLB is missing its material binding.");
    }
    firstMaterial.extras = {
      authority: "derived-visualisation-only",
      c13CatalogBinding: furnishingNode.extras.c13CatalogBinding,
      canonicalElementId: ids.furnishing,
      canonicalElementType: "finish",
      face: "all",
      materialSha256: hash("finish-material"),
    };
    const duplicate = replaceFixtureGlb(
      fixture,
      glbFromJsonAndBinary(duplicateJson, fixture.binary),
    );
    expect(errorCode(() => buildRenderScene(duplicate.input))).toBe("C13_BINDING_MISMATCH");

    const missingLineJson = clonedRecord(fixture.glbJson);
    const missingBindingNode = (
      missingLineJson.nodes as Array<{ extras: Record<string, unknown> }>
    )[1];
    if (missingBindingNode === undefined) {
      throw new Error("C14 fixture GLB is missing furnishing data.");
    }
    delete missingBindingNode.extras.c13CatalogBinding;
    const missingLine = replaceFixtureGlb(
      fixture,
      glbFromJsonAndBinary(missingLineJson, fixture.binary),
    );
    expect(errorCode(() => buildRenderScene(missingLine.input))).toBe("C13_BINDING_MISMATCH");
  });

  it("rechecks active C13 render rights instead of trusting historical scene metadata", () => {
    const fixture = renderFixture();
    const withdrawnAssets = clonedRecord(fixture.input.catalogAssetVersions);
    const asset = withdrawnAssets[0];
    if (asset === undefined) throw new Error("C14 fixture is missing its catalog asset.");
    (asset as typeof asset & { lifecycle: "withdrawn" }).lifecycle = "withdrawn";
    (asset.rights.review as typeof asset.rights.review & { state: "withdrawn" }).state =
      "withdrawn";
    expect(
      errorCode(() =>
        buildRenderScene({ ...fixture.input, catalogAssetVersions: withdrawnAssets }),
      ),
    ).toBe("C13_RIGHTS_DENIED");
  });

  it("rejects malformed, truncated, duplicate-key, external-resource, and unsafe GLB input", () => {
    const fixture = renderFixture();
    expect(errorCode(() => parseProtectedC10Glb(fixture.input.sceneGlb.slice(0, 19)))).toBe(
      "GLB_INVALID",
    );

    const duplicateKeyText = JSON.stringify(fixture.glbJson).replace(
      '"asset":{',
      '"asset":{"version":"2.0",',
    );
    expect(
      errorCode(() => parseProtectedC10Glb(glbFromJsonText(duplicateKeyText, fixture.binary))),
    ).toBe("GLB_INVALID");

    const externalJson = clonedRecord(fixture.glbJson);
    const firstBuffer = (externalJson.buffers as Array<Record<string, unknown>>)[0];
    if (firstBuffer === undefined) throw new Error("C14 fixture GLB is missing its buffer.");
    firstBuffer.uri = "https://invalid.test/x";
    expect(
      errorCode(() => parseProtectedC10Glb(glbFromJsonAndBinary(externalJson, fixture.binary))),
    ).toBe("GLB_EXTERNAL_RESOURCE");

    const unsafeJson = clonedRecord(fixture.glbJson);
    const firstNode = (unsafeJson.nodes as Array<{ extras: Record<string, unknown> }>)[0];
    if (firstNode === undefined) throw new Error("C14 fixture GLB is missing its first node.");
    firstNode.extras.python = "bpy.data.objects";
    expect(
      errorCode(() => parseProtectedC10Glb(glbFromJsonAndBinary(unsafeJson, fixture.binary))),
    ).toBe("GLB_UNSAFE_CONTENT");
  });

  it("rejects non-finite binary accessors and the frozen GLB byte ceiling", () => {
    const fixture = renderFixture();
    const binary = fixture.binary.slice();
    new DataView(binary.buffer).setFloat32(0, Number.NaN, true);
    expect(
      errorCode(() => parseProtectedC10Glb(glbFromJsonAndBinary(fixture.glbJson, binary))),
    ).toBe("GLB_INVALID");

    expect(
      errorCode(() =>
        parseProtectedC10Glb(new Uint8Array(c10ScenePolicy.maximumArtifactBytes + 1)),
      ),
    ).toBe("GLB_RESOURCE_LIMIT");
  });

  it("keeps diagnostics bounded and free of hostile source content", () => {
    const fixture = renderFixture();
    const unsafeJson = clonedRecord(fixture.glbJson);
    const firstNode = (unsafeJson.nodes as Array<{ extras: Record<string, unknown> }>)[0];
    if (firstNode === undefined) throw new Error("C14 fixture GLB is missing its first node.");
    firstNode.extras.script = "PRIVATE_ADDRESS_MARKER /Users/private/customer.blend";
    try {
      parseProtectedC10Glb(glbFromJsonAndBinary(unsafeJson, fixture.binary));
      throw new Error("Expected the unsafe GLB to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderSceneError);
      const diagnostic = (error as RenderSceneError).diagnostic();
      expect(JSON.stringify(diagnostic)).not.toMatch(
        /PRIVATE_ADDRESS_MARKER|Users|customer|\.blend|60000000/iu,
      );
      expect(diagnostic.code).toBe("GLB_UNSAFE_CONTENT");
    }
  });
});

describe("millimetres, camera, photometry, and segmentation", () => {
  it("maps exact 1 mm boundaries without changing C4 axes", () => {
    expect(c4MillimetresToBlenderMetres(1)).toBe(0.001);
    expect(c4MillimetresToBlenderMetres(-1)).toBe(-0.001);
    expect(mapC4PointMmToBlenderMetres({ xMm: 1, yMm: -1, zMm: 2 })).toEqual({
      x: 0.001,
      y: -0.001,
      z: 0.002,
    });
  });

  it("uses the named camera collinearity fallback and rejects degeneracy/clip errors", () => {
    const vertical = deriveBlenderCamera({
      cameraId: ids.camera,
      clipEndMm: 10_000,
      clipStartMm: 1,
      position: { xMm: 0, yMm: 0, zMm: 0 },
      target: { xMm: 0, yMm: 0, zMm: 1 },
      verticalFovMilliDegrees: 60_000,
    });
    expect(vertical.collinearityPolicy).toBe("positive-y-world-up-fallback-v1");
    expect(vertical.rotationMatrix3x3.every(Number.isFinite)).toBe(true);

    const degenerate = renderFixture({ cameraTarget: { xMm: 1_000, yMm: 1_000, zMm: 1_600 } });
    expect(errorCode(() => buildRenderScene(degenerate.input))).toBe("CAMERA_INVALID");
    const fixture = renderFixture();
    expect(
      errorCode(() =>
        buildRenderScene({
          ...fixture.input,
          camera: { cameraId: ids.camera, clipEndMm: 10, clipStartMm: 10 },
        }),
      ),
    ).toBe("CAMERA_INVALID");
    expect(
      errorCode(() =>
        deriveBlenderCamera({
          cameraId: ids.camera,
          clipEndMm: 10_000,
          clipStartMm: 1,
          position: { xMm: 0, yMm: 0, zMm: 0 },
          target: { xMm: 0, yMm: 1, zMm: 0 },
          verticalFovMilliDegrees: 0,
        }),
      ),
    ).toBe("CAMERA_INVALID");
  });

  it("allocates collision-free palette colours across byte carry boundaries", () => {
    const indices = [0, 1, 255, 256, 65_535, 65_536, 99_999];
    const colours = indices.map((index) => segmentationColourForIndex(index).join(","));
    expect(new Set(colours).size).toBe(indices.length);
    expect(segmentationColourForIndex(0)).toEqual([1, 0, 0]);
    expect(segmentationColourForIndex(65_536)).toEqual([2, 0, 0]);

    const elementIds = Array.from(
      { length: 100_000 },
      (_, index) => `element-${String(index).padStart(6, "0")}`,
    );
    const palette = segmentationPaletteForElementIds(elementIds.toReversed());
    expect(palette).toHaveLength(100_000);
    expect(new Set(palette.map(({ rgb8 }) => rgb8.join(","))).size).toBe(100_000);
    expect(palette.map(({ elementId }) => elementId)).toEqual(elementIds);
  });
});
