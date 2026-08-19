import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  normalizeExrContainer,
  normalizePngContainer,
  renderContainerNormalizationPolicy,
} from "../src/container-normalization.js";

function pngChunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, "ascii");
  data.copy(output, 8);
  return output;
}

function fakePng(date: string, renderTime: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", Buffer.from(`Date\0${date}`, "latin1")),
    pngChunk("tEXt", Buffer.from(`RenderTime\0${renderTime}`, "latin1")),
    pngChunk("tEXt", Buffer.from("Software\0Blender", "latin1")),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 1, 2, 3, 4]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function exrAttribute(name: string, type: string, value: string): Buffer {
  const valueBytes = Buffer.from(value, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32LE(valueBytes.length);
  return Buffer.concat([Buffer.from(`${name}\0${type}\0`, "ascii"), size, valueBytes]);
}

function fakeExr(date: string, renderTime: string): Buffer {
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32LE(20000630, 0);
  prefix.writeUInt32LE(2, 4);
  return Buffer.concat([
    prefix,
    exrAttribute("Date", "string", date),
    exrAttribute("RenderTime", "string", renderTime),
    exrAttribute("owner", "string", "stable"),
    Buffer.from([0]),
    Buffer.from("pixel-payload", "ascii"),
  ]);
}

describe("render container normalization", () => {
  it("removes only volatile Blender PNG text chunks and preserves compressed pixels", () => {
    const first = normalizePngContainer(fakePng("2026/08/12 20:00:01", "00:00.11"));
    const second = normalizePngContainer(fakePng("2026/08/12 20:01:59", "00:00.42"));

    expect(first).toEqual(second);
    expect(first.includes(Buffer.from("Software\0Blender", "latin1"))).toBe(true);
    expect(first.includes(Buffer.from("Date\0", "latin1"))).toBe(false);
    expect(normalizePngContainer(first)).toEqual(first);
  });

  it("canonicalizes equal-length Blender EXR timing strings without moving pixel payload", () => {
    const first = normalizeExrContainer(fakeExr("2026/08/12 20:00:01", "00:00.11"));
    const second = normalizeExrContainer(fakeExr("2026/08/12 20:01:59", "00:00.42"));

    expect(first).toEqual(second);
    expect(first.subarray(-13).toString("ascii")).toBe("pixel-payload");
    expect(first.includes(Buffer.from(renderContainerNormalizationPolicy.exr.Date))).toBe(true);
    expect(normalizeExrContainer(first)).toEqual(first);
  });
});
