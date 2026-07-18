import {
  c10DefaultCompileConfiguration,
  sceneArtifactSchema,
  sceneManifestSchema,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { compileCanonicalScene, parseGlb, sha256Hex } from "../src/index.js";
import { canonicalFixture, fixtureIds, fixtureReference, unknown } from "./fixture.js";

function arrayMember(
  json: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown>[] {
  return json[key] as Record<string, unknown>[];
}

describe("canonical scene compiler", () => {
  it("emits a validator-clean strict GLB, manifest, artifact, and exact golden metrics", async () => {
    const snapshot = canonicalFixture();
    expect(fixtureReference(snapshot).snapshotSha256).toBe(
      "b2f07cf0f7ffe56ea851f272c740f3951238656fb9577bdadc9ddc668ee1bbb3",
    );
    const result = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    });

    expect(sceneManifestSchema.parse(result.manifest)).toEqual(result.manifest);
    expect(sceneArtifactSchema.parse(result.artifact)).toEqual(result.artifact);
    expect(result.validation).toMatchObject({
      issueCodes: [],
      numErrors: 0,
      numWarnings: 0,
      validatorVersion: "2.0.0-dev.3.10",
    });
    expect(result.glb.byteLength).toBe(29_456);
    expect(result.manifest.counts).toEqual({
      materials: 6,
      meshes: 9,
      nodes: 14,
      triangles: 281,
      vertices: 561,
    });
    expect(result.manifest.boundsMm).toEqual({
      maximum: { xMm: 5_100, yMm: 4_100, zMm: 3_800 },
      minimum: { xMm: -100, yMm: -100, zMm: 0 },
    });
    expect(result.artifact).toMatchObject({
      byteSize: 29_456,
      glbSha256: "730e0b6b20d1a5438d17b15a592d4fda52b8d15c41fd76e5b54411f98f817a7a",
      mimeType: "model/gltf-binary",
    });
    expect(result.artifact.manifestSha256).toBe(sha256Hex(result.manifestBytes));
    expect(result.findings.map(({ code }) => code)).toEqual([
      "BOUNDED_PROXY_GEOMETRY",
      "BOUNDED_PROXY_GEOMETRY",
    ]);
  });

  it("maps canonical axes, cuts the host wall, and emits stable one-owner metadata", async () => {
    const snapshot = canonicalFixture();
    const result = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    });
    const parsed = parseGlb(result.glb);
    const nodes = arrayMember(parsed.json, "nodes");
    const camera = nodes.find(
      (node) => (node.extras as Record<string, unknown>).canonicalElementId === fixtureIds.camera,
    );
    const opening = nodes.find(
      (node) => (node.extras as Record<string, unknown>).canonicalElementId === fixtureIds.opening,
    );
    const wall = nodes.find(
      (node) =>
        (node.extras as Record<string, unknown>).canonicalElementId === fixtureIds.wallSouth,
    );
    const multiSegmentWall = nodes.find(
      (node) => (node.extras as Record<string, unknown>).canonicalElementId === fixtureIds.wallEast,
    );
    expect((wall?.extras as Record<string, unknown>).levelId).toBe(fixtureIds.ground);
    expect((opening?.extras as Record<string, unknown>).levelId).toBe(fixtureIds.ground);
    expect(camera?.translation).toEqual([1, 1.600000023841858, -1]);
    expect(opening?.translation).toEqual([1.4500000476837158, 1.0499999523162842, 0]);
    const mesh = arrayMember(parsed.json, "meshes")[wall?.mesh as number];
    const primitive = (mesh?.primitives as Record<string, unknown>[])[0];
    const positionAccessor = (primitive?.attributes as Record<string, unknown>).POSITION as number;
    expect(arrayMember(parsed.json, "accessors")[positionAccessor]?.count).toBe(72);
    const multiSegmentMesh = arrayMember(parsed.json, "meshes")[multiSegmentWall?.mesh as number];
    const multiSegmentPrimitive = (multiSegmentMesh?.primitives as Record<string, unknown>[])[0];
    const multiSegmentPosition = (multiSegmentPrimitive?.attributes as Record<string, unknown>)
      .POSITION as number;
    expect(arrayMember(parsed.json, "accessors")[multiSegmentPosition]?.count).toBe(48);
    expect(
      result.manifest.elementMappings.find(({ elementId }) => elementId === fixtureIds.opening),
    ).toMatchObject({
      meshIndices: [],
      nodeIndices: [5],
      status: "mapped",
    });
    expect(
      new Set(result.manifest.elementMappings.flatMap(({ nodeIndices }) => nodeIndices)).size,
    ).toBe(result.manifest.elementMappings.flatMap(({ nodeIndices }) => nodeIndices).length);
  });

  it("respects left-face and right-face wall alignment", async () => {
    const alignedValues: number[][] = [];
    for (const alignment of ["left-face", "right-face"] as const) {
      const snapshot = structuredClone(canonicalFixture());
      const wall = snapshot.elements.walls.find(({ id }) => id === fixtureIds.wallSouth);
      if (wall === undefined) throw new Error("fixture wall missing");
      wall.alignment = alignment;
      const result = await compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot,
        sourceSnapshot: fixtureReference(snapshot),
      });
      alignedValues.push(positionAxisValues(parseGlb(result.glb), fixtureIds.wallSouth, 2));
    }
    const left = alignedValues[0];
    const right = alignedValues[1];
    if (left === undefined || right === undefined) throw new Error("aligned wall values missing");
    expect(Math.min(...left)).toBeCloseTo(0, 6);
    expect(Math.max(...left)).toBeCloseTo(0.2, 6);
    expect(Math.min(...right)).toBeCloseTo(-0.2, 6);
    expect(Math.max(...right)).toBeCloseTo(0, 6);
  });

  it("sorts every canonical collection and remains byte-identical", async () => {
    const snapshot = canonicalFixture();
    const reversed = structuredClone(snapshot);
    for (const collection of Object.values(reversed.elements)) collection.reverse();
    reversed.knownLimitations.reverse();

    const first = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    });
    const second = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot: reversed,
      sourceSnapshot: fixtureReference(reversed),
    });
    expect(second.glb).toEqual(first.glb);
    expect(second.manifestBytes).toEqual(first.manifestBytes);
    expect(second.artifact).toEqual(first.artifact);
  });

  it("emits a validator-clean metadata-only GLB when all optional geometry is unknown", async () => {
    const snapshot = structuredClone(canonicalFixture());
    const level = snapshot.elements.levels[0];
    if (level === undefined) throw new Error("fixture level missing");
    level.elevationMm = unknown();
    snapshot.elements = {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [],
      levels: [level],
      lights: [],
      openings: [],
      spaces: [],
      stairs: [],
      surfaces: [],
      walls: [],
    };
    const result = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    });
    expect(result.validation).toMatchObject({ numErrors: 0, numWarnings: 0 });
    expect(result.manifest.counts).toEqual({
      materials: 0,
      meshes: 0,
      nodes: 0,
      triangles: 0,
      vertices: 0,
    });
    expect(result.manifest.elementMappings[0]).toMatchObject({
      elementId: fixtureIds.ground,
      findingCodes: ["ELEMENT_GEOMETRY_OMITTED", "LEVEL_ELEVATION_UNKNOWN"],
      status: "omitted",
    });
    expect(parseGlb(result.glb).binaryChunk.byteLength).toBe(0);
  });

  it("omits unknown host geometry and its opening with explicit mappings", async () => {
    const snapshot = structuredClone(canonicalFixture());
    const opening = snapshot.elements.openings.find(({ id }) => id === fixtureIds.opening);
    if (opening === undefined) throw new Error("fixture opening missing");
    opening.widthMm = unknown();
    const result = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    });
    const wallMapping = result.manifest.elementMappings.find(
      ({ elementId }) => elementId === fixtureIds.wallSouth,
    );
    const openingMapping = result.manifest.elementMappings.find(
      ({ elementId }) => elementId === fixtureIds.opening,
    );
    expect(wallMapping?.status).toBe("omitted");
    expect(wallMapping?.findingCodes).toContain("WALL_OMITTED_UNKNOWN_OPENING");
    expect(openingMapping?.status).toBe("omitted");
    expect(openingMapping?.findingCodes).toContain("ELEMENT_GEOMETRY_OMITTED");
    expect(openingMapping?.findingCodes).toContain("OPENING_WIDTH_UNKNOWN");
    expect(
      result.manifest.findings.every(({ affectedElementIds }) => affectedElementIds.length > 0),
    ).toBe(true);
  });

  it("cuts a second opening that ends exactly at the host-wall endpoint", async () => {
    const snapshot = withSecondOpening(4_100, 900);
    const result = await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    });
    expect(result.validation).toMatchObject({ numErrors: 0, numWarnings: 0 });
    expect(result.manifest.counts).toMatchObject({ nodes: 15, triangles: 293, vertices: 585 });
    expect(
      result.manifest.elementMappings.find(({ elementId }) => elementId.endsWith("00aa")),
    ).toMatchObject({
      status: "mapped",
    });
  });

  it.each([
    ["overlapping", 1_500, 900],
    ["outside-host", 4_500, 900],
  ])("rejects %s opening intervals", async (_label, offsetMm, widthMm) => {
    const snapshot = withSecondOpening(offsetMm, widthMm);
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot,
        sourceSnapshot: fixtureReference(snapshot),
      }),
    ).rejects.toMatchObject({ code: "GEOMETRY_INVALID" });
  });

  it("rejects derived proxy bounds outside the manifest's integer range", async () => {
    const snapshot = structuredClone(canonicalFixture());
    const fixedObject = snapshot.elements.fixedObjects[0];
    if (fixedObject?.dimensions.knowledge !== "known") throw new Error("fixture object missing");
    if (fixedObject.placement.position.knowledge !== "known")
      throw new Error("fixture position missing");
    fixedObject.dimensions.value = {
      ...fixedObject.dimensions.value,
      depthMm: 1_000_000,
      widthMm: 1_000_000,
    };
    fixedObject.placement.position.value = {
      ...fixedObject.placement.position.value,
      xMm: 10_000_000,
    };
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot,
        sourceSnapshot: fixtureReference(snapshot),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
  });

  it("rejects exact-source mismatch, self-intersection, host mismatch, and non-finite input", async () => {
    const snapshot = canonicalFixture();
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot,
        sourceSnapshot: { ...fixtureReference(snapshot), snapshotSha256: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_SNAPSHOT_MISMATCH" });

    const selfIntersecting = structuredClone(snapshot);
    const wall = selfIntersecting.elements.walls[0];
    if (wall?.path.knowledge !== "known") throw new Error("fixture wall missing");
    wall.path = {
      ...wall.path,
      value: [
        { xMm: 0, yMm: 0 },
        { xMm: 2_000, yMm: 2_000 },
        { xMm: 0, yMm: 2_000 },
        { xMm: 2_000, yMm: 0 },
      ],
    };
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot: selfIntersecting,
        sourceSnapshot: fixtureReference(selfIntersecting),
      }),
    ).rejects.toMatchObject({ code: "GEOMETRY_INVALID" });

    const missingHost = structuredClone(snapshot);
    const opening = missingHost.elements.openings[0];
    if (opening === undefined) throw new Error("fixture opening missing");
    opening.hostWallId = "20000000-0000-4000-8000-00000000ffff";
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot: missingHost,
        sourceSnapshot: fixtureReference(missingHost),
      }),
    ).rejects.toMatchObject({ code: "GEOMETRY_INVALID" });

    const nonFinite = structuredClone(snapshot) as unknown as Record<string, unknown>;
    const typed = nonFinite as unknown as typeof snapshot;
    const surface = typed.elements.surfaces[0];
    if (surface?.boundary.knowledge !== "known") throw new Error("fixture surface missing");
    const firstPoint = surface.boundary.value[0];
    if (firstPoint === undefined) throw new Error("fixture surface point missing");
    surface.boundary.value[0] = { ...firstPoint, xMm: Number.POSITIVE_INFINITY };
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot: nonFinite,
        sourceSnapshot: fixtureReference(snapshot),
      }),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("enforces material limits before mesh allocation", async () => {
    const snapshot = structuredClone(canonicalFixture());
    const template = snapshot.elements.finishes[0];
    const surfaceTemplate = snapshot.elements.surfaces[0];
    if (template === undefined || surfaceTemplate === undefined)
      throw new Error("fixture finish missing");
    snapshot.elements.surfaces = Array.from({ length: 1_025 }, (_, index) => ({
      ...structuredClone(surfaceTemplate),
      id: `30000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    }));
    snapshot.elements.finishes = Array.from({ length: 1_025 }, (_, index) => ({
      ...structuredClone(template),
      id: `40000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      material: { ...template.material, value: `Material ${String(index)}` },
      targetElementId: snapshot.elements.surfaces[index]?.id ?? fixtureIds.surface,
    }));
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot,
        sourceSnapshot: fixtureReference(snapshot),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
  });

  it("honours cancellation before validation and publication", async () => {
    const controller = new AbortController();
    controller.abort();
    const snapshot = canonicalFixture();
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        signal: controller.signal,
        snapshot,
        sourceSnapshot: fixtureReference(snapshot),
      }),
    ).rejects.toMatchObject({ code: "COMPILATION_CANCELLED" });
  });

  it("rejects named properties on otherwise schema-shaped arrays", async () => {
    const snapshot = canonicalFixture();
    const sourceSnapshot = fixtureReference(snapshot);
    Object.defineProperty(snapshot.elements.walls, "privateLocator", {
      configurable: true,
      enumerable: true,
      value: "/tmp/should-never-be-read",
    });
    await expect(
      compileCanonicalScene({
        configuration: c10DefaultCompileConfiguration,
        snapshot,
        sourceSnapshot,
      }),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

function withSecondOpening(offsetMm: number, widthMm: number) {
  const snapshot = structuredClone(canonicalFixture());
  const template = snapshot.elements.openings[0];
  if (template?.offsetAlongHostMm.knowledge !== "known" || template.widthMm.knowledge !== "known") {
    throw new Error("fixture opening missing");
  }
  snapshot.elements.openings.push({
    ...structuredClone(template),
    id: "20000000-0000-4000-8000-0000000000aa",
    offsetAlongHostMm: { ...template.offsetAlongHostMm, value: offsetMm },
    widthMm: { ...template.widthMm, value: widthMm },
  });
  return snapshot;
}

function positionAxisValues(
  parsed: ReturnType<typeof parseGlb>,
  elementId: string,
  axis: 0 | 1 | 2,
): number[] {
  const nodes = arrayMember(parsed.json, "nodes");
  const node = nodes.find(
    (candidate) => (candidate.extras as Record<string, unknown>).canonicalElementId === elementId,
  );
  const mesh = arrayMember(parsed.json, "meshes")[node?.mesh as number];
  const primitive = (mesh?.primitives as Record<string, unknown>[])[0];
  const positionIndex = (primitive?.attributes as Record<string, unknown>).POSITION as number;
  const accessor = arrayMember(parsed.json, "accessors")[positionIndex];
  const bufferView = arrayMember(parsed.json, "bufferViews")[accessor?.bufferView as number];
  if (accessor === undefined || bufferView === undefined)
    throw new Error("position accessor missing");
  const offset =
    (bufferView.byteOffset as number) + ((accessor.byteOffset as number | undefined) ?? 0);
  const count = accessor.count as number;
  const view = new DataView(
    parsed.binaryChunk.buffer,
    parsed.binaryChunk.byteOffset,
    parsed.binaryChunk.byteLength,
  );
  return Array.from({ length: count }, (_, index) =>
    view.getFloat32(offset + index * 12 + axis * 4, true),
  );
}
