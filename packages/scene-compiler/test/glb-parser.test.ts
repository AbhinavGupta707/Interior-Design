import { c10DefaultCompileConfiguration } from "@interior-design/contracts";
import { beforeAll, describe, expect, it } from "vitest";

import { compileCanonicalScene, parseGlb } from "../src/index.js";
import { canonicalFixture, fixtureReference } from "./fixture.js";

let golden: Uint8Array;

beforeAll(async () => {
  const snapshot = canonicalFixture();
  golden = (
    await compileCanonicalScene({
      configuration: c10DefaultCompileConfiguration,
      snapshot,
      sourceSnapshot: fixtureReference(snapshot),
    })
  ).glb;
});

function corrupt(offset: number, value: number): Uint8Array {
  const bytes = golden.slice();
  new DataView(bytes.buffer).setUint32(offset, value, true);
  return bytes;
}

describe("independent bounded GLB parser", () => {
  it("recomputes accessor and mesh counts", () => {
    expect(parseGlb(golden).counts).toEqual({
      accessors: 27,
      bufferViews: 27,
      materials: 6,
      meshes: 9,
      nodes: 14,
      triangles: 281,
      vertices: 561,
    });
  });

  it.each([
    ["magic", 0, 0],
    ["version", 4, 1],
    ["declared length", 8, 20],
    ["JSON chunk type", 16, 0],
    ["JSON chunk length", 12, 3],
  ])("rejects a corrupt %s", (_label, offset, value) => {
    expect(() => parseGlb(corrupt(offset, value))).toThrow(/GLB/u);
  });

  it("rejects a Float32 NaN accessor", () => {
    const parsed = parseGlb(golden);
    const jsonLength = new DataView(golden.buffer, golden.byteOffset, golden.byteLength).getUint32(
      12,
      true,
    );
    const binaryStart = 20 + jsonLength + 8;
    const accessors = parsed.json.accessors as Record<string, unknown>[];
    const bufferViews = parsed.json.bufferViews as Record<string, unknown>[];
    const first = accessors[0];
    if (first === undefined) throw new Error("golden accessor missing");
    const bufferView = bufferViews[first.bufferView as number];
    if (bufferView === undefined) throw new Error("golden buffer view missing");
    const bytes = golden.slice();
    new DataView(bytes.buffer).setUint32(
      binaryStart + (bufferView.byteOffset as number),
      0x7fc0_0000,
      true,
    );
    expect(() => parseGlb(bytes)).toThrow(/NaN|infinity/u);
  });

  it("rejects an out-of-range triangle index", () => {
    const parsed = parseGlb(golden);
    const jsonLength = new DataView(golden.buffer, golden.byteOffset, golden.byteLength).getUint32(
      12,
      true,
    );
    const binaryStart = 20 + jsonLength + 8;
    const meshes = parsed.json.meshes as Record<string, unknown>[];
    const firstMesh = meshes[0];
    if (firstMesh === undefined) throw new Error("golden mesh missing");
    const primitive = (firstMesh.primitives as Record<string, unknown>[])[0];
    if (primitive === undefined) throw new Error("golden primitive missing");
    const accessors = parsed.json.accessors as Record<string, unknown>[];
    const indexAccessor = accessors[primitive.indices as number];
    if (indexAccessor === undefined) throw new Error("golden index accessor missing");
    const bufferViews = parsed.json.bufferViews as Record<string, unknown>[];
    const indexView = bufferViews[indexAccessor.bufferView as number];
    if (indexView === undefined) throw new Error("golden index view missing");
    const bytes = golden.slice();
    new DataView(bytes.buffer).setUint32(
      binaryStart + (indexView.byteOffset as number),
      0xffff_ffff,
      true,
    );
    expect(() => parseGlb(bytes)).toThrow(/triangle index/u);
  });

  it("rejects an accessor that exceeds its buffer view", () => {
    const bytes = golden.slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const json = new TextDecoder().decode(bytes.slice(20, 20 + jsonLength));
    const changed = json.replace('"count":24', '"count":99');
    expect(changed).not.toBe(json);
    bytes.set(new TextEncoder().encode(changed), 20);
    expect(() => parseGlb(bytes)).toThrow(/accessor exceeds/u);
  });
});
