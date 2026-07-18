import { c13CatalogPolicy } from "@interior-design/contracts";
import { deflateSync, inflateSync } from "node:zlib";

import { CatalogError } from "./errors.js";
import type { ValidatedPng } from "./types.js";

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const safeChunkTypes = new Set(["IDAT", "IEND", "IHDR"]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let number = 0; number < table.length; number += 1) {
    let value = number;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[number] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function invalid(): never {
  throw new CatalogError("CATALOG_PNG_INVALID");
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) invalid();
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}

function decodeScanlines(inflated: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const expected = height * (rowBytes + 1);
  if (inflated.byteLength !== expected) invalid();
  const pixels = new Uint8Array(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    if (filter === undefined || filter > 4) invalid();
    const rowOffset = row * rowBytes;
    const previousOffset = rowOffset - rowBytes;
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = inflated[sourceOffset + column];
      if (encoded === undefined) invalid();
      const left = column >= bytesPerPixel ? (pixels[rowOffset + column - bytesPerPixel] ?? 0) : 0;
      const above = row > 0 ? (pixels[previousOffset + column] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? (pixels[previousOffset + column - bytesPerPixel] ?? 0)
          : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      pixels[rowOffset + column] = (encoded + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }
  return pixels;
}

function chunk(type: "IDAT" | "IEND" | "IHDR", data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength, false);
  output.set(typeBytes, 4);
  output.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.byteLength + data.byteLength);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.byteLength);
  view.setUint32(8 + data.byteLength, crc32(crcInput), false);
  return output;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function encodeDeterministicRgbaPng(
  pixels: Uint8Array,
  widthPx: number,
  heightPx: number,
): Uint8Array {
  if (
    !Number.isInteger(widthPx) ||
    !Number.isInteger(heightPx) ||
    widthPx < 1 ||
    heightPx < 1 ||
    widthPx > c13CatalogPolicy.maximumImageDimensionPixels ||
    heightPx > c13CatalogPolicy.maximumImageDimensionPixels ||
    pixels.byteLength !== widthPx * heightPx * 4
  ) {
    invalid();
  }
  const raw = new Uint8Array(heightPx * (1 + widthPx * 4));
  for (let row = 0; row < heightPx; row += 1) {
    const rawOffset = row * (1 + widthPx * 4);
    raw[rawOffset] = 0;
    raw.set(pixels.subarray(row * widthPx * 4, (row + 1) * widthPx * 4), rawOffset + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, widthPx, false);
  view.setUint32(4, heightPx, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const compressed = Uint8Array.from(deflateSync(raw, { level: 9 }));
  const output = concatenate([
    pngSignature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  ]);
  if (output.byteLength > c13CatalogPolicy.maximumImageEncodedBytes) {
    throw new CatalogError("CATALOG_RESOURCE_LIMIT");
  }
  return output;
}

export function validateAndCanonicalizePng(bytes: Uint8Array): ValidatedPng {
  if (
    bytes.byteLength < 45 ||
    bytes.byteLength > c13CatalogPolicy.maximumImageEncodedBytes ||
    pngSignature.some((byte, index) => bytes[index] !== byte)
  ) {
    invalid();
  }
  let offset = pngSignature.byteLength;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  const compressedParts: Uint8Array[] = [];
  while (offset < bytes.byteLength) {
    const length = readU32(bytes, offset);
    if (
      length > c13CatalogPolicy.maximumImageEncodedBytes ||
      offset + 12 + length > bytes.byteLength
    ) {
      invalid();
    }
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder("ascii", { fatal: true }).decode(typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = readU32(bytes, offset + 8 + length);
    const crcInput = new Uint8Array(4 + length);
    crcInput.set(typeBytes);
    crcInput.set(data, 4);
    if (crc32(crcInput) !== expectedCrc || !safeChunkTypes.has(type)) invalid();
    if (type === "IHDR") {
      if (sawHeader || sawImageData || length !== 13) invalid();
      width = readU32(data, 0);
      height = readU32(data, 4);
      if (
        width < 1 ||
        height < 1 ||
        width > c13CatalogPolicy.maximumImageDimensionPixels ||
        height > c13CatalogPolicy.maximumImageDimensionPixels ||
        data[8] !== 8 ||
        data[9] !== 6 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        invalid();
      }
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || sawEnd || length < 1) invalid();
      sawImageData = true;
      compressedParts.push(Uint8Array.from(data));
    } else {
      if (
        !sawHeader ||
        !sawImageData ||
        sawEnd ||
        length !== 0 ||
        offset + 12 !== bytes.byteLength
      ) {
        invalid();
      }
      sawEnd = true;
    }
    offset += 12 + length;
  }
  if (!sawHeader || !sawImageData || !sawEnd || width * height > 16_777_216) invalid();
  const compressed = concatenate(compressedParts);
  let inflated: Uint8Array;
  try {
    inflated = Uint8Array.from(
      inflateSync(compressed, { maxOutputLength: height * (1 + width * 4) }),
    );
  } catch (error) {
    throw new CatalogError("CATALOG_PNG_INVALID", { cause: error });
  }
  const pixels = decodeScanlines(inflated, width, height);
  return {
    bytes: encodeDeterministicRgbaPng(pixels, width, height),
    heightPx: height,
    widthPx: width,
  };
}
