import { createHash } from "node:crypto";

import { renderArtifactSchema } from "@interior-design/contracts";
import type { RenderArtifact, RenderArtifactRole } from "@interior-design/contracts";
import sharp from "sharp";

export const artifactId = "c1400000-0000-4000-8000-000000000001";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function artifactFor(
  bytes: Uint8Array,
  role: RenderArtifactRole,
  widthPx = 64,
  heightPx = 64,
): RenderArtifact {
  return renderArtifactSchema.parse({
    byteLength: bytes.byteLength,
    heightPx,
    id: artifactId,
    mediaType: role.endsWith("-png") ? "image/png" : "image/x-exr",
    role,
    schemaVersion: "c14-render-artifact-v1",
    sha256: sha256(bytes),
    widthPx,
  });
}

export async function solidPng(
  colour: { readonly alpha?: number; readonly b: number; readonly g: number; readonly r: number },
  width = 64,
  height = 64,
): Promise<Uint8Array> {
  return sharp({
    create: {
      background: { alpha: colour.alpha ?? 1, b: colour.b, g: colour.g, r: colour.r },
      channels: 4,
      height,
      width,
    },
  })
    .png({ adaptiveFiltering: false, compressionLevel: 9 })
    .toBuffer();
}

function cString(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function attribute(name: string, type: string, value: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(value.byteLength);
  return Buffer.concat([cString(name), cString(type), size, value]);
}

export function minimalExr(
  options: {
    readonly channels?: readonly string[];
    readonly height?: number;
    readonly width?: number;
  } = {},
): Uint8Array {
  const width = options.width ?? 64;
  const height = options.height ?? 64;
  const dataWindow = Buffer.alloc(16);
  dataWindow.writeInt32LE(0, 0);
  dataWindow.writeInt32LE(0, 4);
  dataWindow.writeInt32LE(width - 1, 8);
  dataWindow.writeInt32LE(height - 1, 12);
  const channelEntries = (options.channels ?? ["R", "G", "B", "A"]).map((name) => {
    const body = Buffer.alloc(16);
    body.writeInt32LE(2, 0);
    body.writeUInt8(0, 4);
    body.writeInt32LE(1, 8);
    body.writeInt32LE(1, 12);
    return Buffer.concat([cString(name), body]);
  });
  const channels = Buffer.concat([...channelEntries, Buffer.from([0])]);
  const magicAndVersion = Buffer.from([0x76, 0x2f, 0x31, 0x01, 0x02, 0, 0, 0]);
  return Buffer.concat([
    magicAndVersion,
    attribute("channels", "chlist", channels),
    attribute("dataWindow", "box2i", dataWindow),
    Buffer.from([0]),
    Buffer.alloc(32),
  ]);
}
