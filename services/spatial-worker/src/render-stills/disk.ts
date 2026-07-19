import { statfs } from "node:fs/promises";
import path from "node:path";

import type { RenderDiskPort } from "./types.js";

export class StatfsRenderDisk implements RenderDiskPort {
  async freeBytes(volumePath: string): Promise<number> {
    if (!path.isAbsolute(volumePath)) throw new Error("Render disk paths must be absolute.");
    const stats = await statfs(volumePath, { bigint: true });
    const bytes = stats.bavail * stats.bsize;
    if (bytes < 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Render disk free bytes are outside the exact integer range.");
    }
    return Number(bytes);
  }
}
