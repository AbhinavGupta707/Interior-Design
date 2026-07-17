import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export interface RasterSegment {
  readonly from: readonly [number, number];
  readonly shade?: number;
  readonly to: readonly [number, number];
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function syntheticUuid(sequence: number): string {
  return `c6000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export function createSvgPlan(body: string, width = 600, height = 450): Uint8Array {
  return utf8(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}">` +
      `<title>Synthetic C6 plan fixture</title>${body}</svg>`,
  );
}

export function createMinimalPdf(contentStream: string, catalogSuffix = ""): Uint8Array {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogSuffix} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 450] /Contents 4 0 R >>",
    `<< /Length ${String(Buffer.byteLength(contentStream, "utf8"))} >>\nstream\n${contentStream}\nendstream`,
  ];
  let document = "%PDF-1.7\n% synthetic-rights-cleared\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, "utf8"));
    document += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "utf8");
  document += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return utf8(document);
}

export function createGrayscalePng(
  width: number,
  height: number,
  segments: readonly RasterSegment[],
): Uint8Array {
  const pixels = new Uint8Array(width * height);
  pixels.fill(255);
  for (const segment of segments) {
    drawSegment(pixels, width, height, segment);
  }

  const scanlines = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (width + 1);
    scanlines[outputOffset] = 0;
    scanlines.set(pixels.subarray(y * width, (y + 1) * width), outputOffset + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export function createPngHeader(width: number, height: number, suffix = ""): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      Buffer.from(suffix, "utf8"),
    ]),
  );
}

export function createMinimalJpeg(): Uint8Array {
  return new Uint8Array(
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
      "base64",
    ),
  );
}

function drawSegment(
  pixels: Uint8Array,
  width: number,
  height: number,
  segment: RasterSegment,
): void {
  let [x, y] = segment.from;
  const [endX, endY] = segment.to;
  const deltaX = Math.abs(endX - x);
  const stepX = x < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - y);
  const stepY = y < endY ? 1 : -1;
  let error = deltaX + deltaY;
  const shade = segment.shade ?? 0;
  for (;;) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      pixels[y * width + x] = shade;
    }
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const payload = Buffer.from(data);
  const output = Buffer.alloc(12 + payload.length);
  output.writeUInt32BE(payload.length, 0);
  typeBytes.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
