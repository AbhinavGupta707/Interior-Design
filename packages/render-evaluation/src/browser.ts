export interface PngHeaderInspection {
  readonly bitDepth: number;
  readonly colourType: number;
  readonly compressionMethod: number;
  readonly filterMethod: number;
  readonly heightPx: number;
  readonly interlaceMethod: number;
  readonly widthPx: number;
}

export interface ExrChannelInspection {
  readonly name: string;
  readonly pixelType: "float" | "half" | "uint" | "unknown";
  readonly xSampling: number;
  readonly ySampling: number;
}

export interface ExrHeaderInspection {
  readonly channels: readonly ExrChannelInspection[];
  readonly dataWindow: {
    readonly maximumX: number;
    readonly maximumY: number;
    readonly minimumX: number;
    readonly minimumY: number;
  };
  readonly headerByteLength: number;
  readonly heightPx: number;
  readonly versionField: number;
  readonly widthPx: number;
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const exrSignature = [0x76, 0x2f, 0x31, 0x01] as const;

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new Error("Image metadata is truncated.");
  return value;
}

export function inspectPngHeader(
  bytes: Uint8Array,
  options: { readonly maximumPixels?: number } = {},
): PngHeaderInspection {
  if (bytes.byteLength < 33 || !hasPrefix(bytes, pngSignature)) {
    throw new Error("PNG signature or mandatory IHDR bytes are missing.");
  }
  const view = dataView(bytes);
  if (
    view.getUint32(8, false) !== 13 ||
    String.fromCharCode(
      byteAt(bytes, 12),
      byteAt(bytes, 13),
      byteAt(bytes, 14),
      byteAt(bytes, 15),
    ) !== "IHDR"
  ) {
    throw new Error("PNG IHDR must be the first 13-byte chunk.");
  }
  const widthPx = view.getUint32(16, false);
  const heightPx = view.getUint32(20, false);
  const maximumPixels = options.maximumPixels ?? 16_777_216;
  if (
    widthPx === 0 ||
    heightPx === 0 ||
    widthPx > maximumPixels ||
    heightPx > maximumPixels ||
    widthPx * heightPx > maximumPixels
  ) {
    throw new Error("PNG dimensions exceed the bounded pixel budget.");
  }
  const bitDepth = byteAt(bytes, 24);
  const colourType = byteAt(bytes, 25);
  if (![0, 2, 3, 4, 6].includes(colourType)) throw new Error("PNG colour type is unsupported.");
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error("PNG bit depth is unsupported.");
  return {
    bitDepth,
    colourType,
    compressionMethod: byteAt(bytes, 26),
    filterMethod: byteAt(bytes, 27),
    heightPx,
    interlaceMethod: byteAt(bytes, 28),
    widthPx,
  };
}

interface CStringResult {
  readonly nextOffset: number;
  readonly value: string;
}

function readCString(
  bytes: Uint8Array,
  offset: number,
  ceiling: number,
  maximumNameBytes: number,
): CStringResult {
  const start = offset;
  while (offset < ceiling && bytes[offset] !== 0) {
    offset += 1;
    if (offset - start > maximumNameBytes) throw new Error("EXR header name exceeds its bound.");
  }
  if (offset >= ceiling) throw new Error("EXR header contains an unterminated name.");
  const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, offset));
  return { nextOffset: offset + 1, value };
}

function parseExrChannels(
  bytes: Uint8Array,
  start: number,
  end: number,
  maximumChannels: number,
): readonly ExrChannelInspection[] {
  const channels: ExrChannelInspection[] = [];
  const view = dataView(bytes);
  let offset = start;
  while (offset < end) {
    const name = readCString(bytes, offset, end, 255);
    offset = name.nextOffset;
    if (name.value === "") break;
    if (channels.length >= maximumChannels || offset + 16 > end) {
      throw new Error("EXR channel list is truncated or exceeds its bound.");
    }
    const pixelTypeValue = view.getInt32(offset, true);
    const xSampling = view.getInt32(offset + 8, true);
    const ySampling = view.getInt32(offset + 12, true);
    if (xSampling <= 0 || ySampling <= 0) throw new Error("EXR channel sampling is invalid.");
    channels.push({
      name: name.value,
      pixelType:
        pixelTypeValue === 0
          ? "uint"
          : pixelTypeValue === 1
            ? "half"
            : pixelTypeValue === 2
              ? "float"
              : "unknown",
      xSampling,
      ySampling,
    });
    offset += 16;
  }
  if (channels.length === 0) throw new Error("EXR channel list is empty.");
  return channels;
}

export function inspectExrHeader(
  bytes: Uint8Array,
  options: {
    readonly maximumChannels?: number;
    readonly maximumHeaderBytes?: number;
    readonly maximumPixels?: number;
  } = {},
): ExrHeaderInspection {
  if (bytes.byteLength < 9 || !hasPrefix(bytes, exrSignature)) {
    throw new Error("OpenEXR magic bytes are missing.");
  }
  const view = dataView(bytes);
  const maximumHeaderBytes = Math.min(bytes.byteLength, options.maximumHeaderBytes ?? 1024 * 1024);
  const maximumChannels = options.maximumChannels ?? 128;
  const maximumPixels = options.maximumPixels ?? 16_777_216;
  const versionField = view.getUint32(4, true);
  let offset = 8;
  let dataWindow: ExrHeaderInspection["dataWindow"] | undefined;
  let channels: readonly ExrChannelInspection[] | undefined;
  let headerComplete = false;
  while (offset < maximumHeaderBytes) {
    const name = readCString(bytes, offset, maximumHeaderBytes, 255);
    offset = name.nextOffset;
    if (name.value === "") {
      headerComplete = true;
      break;
    }
    const type = readCString(bytes, offset, maximumHeaderBytes, 255);
    offset = type.nextOffset;
    if (offset + 4 > maximumHeaderBytes) throw new Error("EXR attribute size is truncated.");
    const size = view.getUint32(offset, true);
    offset += 4;
    if (size > maximumHeaderBytes || offset + size > maximumHeaderBytes) {
      throw new Error("EXR attribute exceeds the bounded header or is truncated.");
    }
    if (name.value === "dataWindow" && type.value === "box2i" && size === 16) {
      dataWindow = {
        maximumX: view.getInt32(offset + 8, true),
        maximumY: view.getInt32(offset + 12, true),
        minimumX: view.getInt32(offset, true),
        minimumY: view.getInt32(offset + 4, true),
      };
    }
    if (name.value === "channels" && type.value === "chlist") {
      channels = parseExrChannels(bytes, offset, offset + size, maximumChannels);
    }
    offset += size;
  }
  if (!headerComplete) throw new Error("EXR header terminator is missing within its byte bound.");
  if (!dataWindow || !channels) throw new Error("EXR dataWindow or channels metadata is missing.");
  const widthPx = dataWindow.maximumX - dataWindow.minimumX + 1;
  const heightPx = dataWindow.maximumY - dataWindow.minimumY + 1;
  if (
    !Number.isSafeInteger(widthPx) ||
    !Number.isSafeInteger(heightPx) ||
    widthPx <= 0 ||
    heightPx <= 0 ||
    widthPx * heightPx > maximumPixels
  ) {
    throw new Error("EXR data window exceeds the bounded pixel budget.");
  }
  return { channels, dataWindow, headerByteLength: offset, heightPx, versionField, widthPx };
}
