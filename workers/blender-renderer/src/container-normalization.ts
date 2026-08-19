import { rendererFailure } from "./errors.js";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const volatilePngTextKeys = new Set([
  "Date",
  "RenderTime",
  "cycles.ViewLayer.render_time",
  "cycles.ViewLayer.synchronization_time",
  "cycles.ViewLayer.total_time",
]);
const exrMagic = 20000630;
const exrMultipartFlag = 0x1000;

export const renderContainerNormalizationPolicy = {
  exr: {
    Date: "1970/01/01 00:00:00",
    RenderTime: "00:00.00",
  },
  pngRemovedTextKeys: [...volatilePngTextKeys].sort(),
  version: "c14-render-container-normalization-v1",
} as const;

function invalidContainer(): never {
  rendererFailure("RENDER_CONTAINER_NORMALIZATION_INVALID");
}

function pngChunkCrc(type: Buffer, data: Buffer): Buffer {
  let crc = 0xffffffff;
  for (const value of Buffer.concat([type, data])) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  const output = Buffer.allocUnsafe(4);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return output;
}

export function normalizePngContainer(bytes: Uint8Array): Buffer {
  const input = Buffer.from(bytes);
  if (input.length < pngSignature.length || !input.subarray(0, 8).equals(pngSignature)) {
    return invalidContainer();
  }
  const output: Buffer[] = [pngSignature];
  let cursor = 8;
  let sawIend = false;
  while (cursor < input.length) {
    if (cursor + 12 > input.length) return invalidContainer();
    const length = input.readUInt32BE(cursor);
    const end = cursor + 12 + length;
    if (end > input.length) return invalidContainer();
    const type = input.subarray(cursor + 4, cursor + 8);
    const data = input.subarray(cursor + 8, cursor + 8 + length);
    const typeName = type.toString("ascii");
    let keep = true;
    if (typeName === "tEXt") {
      const separator = data.indexOf(0);
      if (separator < 1) return invalidContainer();
      keep = !volatilePngTextKeys.has(data.subarray(0, separator).toString("latin1"));
    }
    if (keep) {
      const header = Buffer.allocUnsafe(8);
      header.writeUInt32BE(length, 0);
      type.copy(header, 4);
      output.push(header, data, pngChunkCrc(type, data));
    }
    cursor = end;
    if (typeName === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend || cursor !== input.length) return invalidContainer();
  return Buffer.concat(output);
}

function readNullTerminated(buffer: Buffer, start: number): { end: number; value: string } {
  const end = buffer.indexOf(0, start);
  if (end < start) return invalidContainer();
  return { end, value: buffer.subarray(start, end).toString("utf8") };
}

function normalizeExrHeader(buffer: Buffer, start: number): number {
  let cursor = start;
  while (cursor < buffer.length) {
    const name = readNullTerminated(buffer, cursor);
    cursor = name.end + 1;
    if (name.value.length === 0) return cursor;
    const type = readNullTerminated(buffer, cursor);
    cursor = type.end + 1;
    if (cursor + 4 > buffer.length) return invalidContainer();
    const size = buffer.readUInt32LE(cursor);
    cursor += 4;
    if (cursor + size > buffer.length) return invalidContainer();
    const replacement =
      name.value === "Date"
        ? renderContainerNormalizationPolicy.exr.Date
        : name.value === "RenderTime"
          ? renderContainerNormalizationPolicy.exr.RenderTime
          : undefined;
    if (replacement !== undefined) {
      const replacementBytes = Buffer.from(replacement, "ascii");
      if (type.value !== "string" || replacementBytes.length !== size) return invalidContainer();
      replacementBytes.copy(buffer, cursor);
    }
    cursor += size;
  }
  return invalidContainer();
}

export function normalizeExrContainer(bytes: Uint8Array): Buffer {
  const output = Buffer.from(bytes);
  if (output.length < 9 || output.readUInt32LE(0) !== exrMagic) return invalidContainer();
  const versionFlags = output.readUInt32LE(4);
  let cursor = normalizeExrHeader(output, 8);
  if ((versionFlags & exrMultipartFlag) !== 0) {
    while (cursor < output.length && output[cursor] !== 0) {
      cursor = normalizeExrHeader(output, cursor);
    }
    if (cursor >= output.length) return invalidContainer();
  }
  return output;
}

export function normalizeRenderArtifactContainer(
  role: "geometry-safe-png" | "multilayer-exr" | "depth-exr" | "normal-exr" | "segmentation-png",
  bytes: Uint8Array,
): Buffer {
  return role.endsWith("png") ? normalizePngContainer(bytes) : normalizeExrContainer(bytes);
}
