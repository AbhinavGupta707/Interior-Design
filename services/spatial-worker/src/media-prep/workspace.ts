import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import path from "node:path";

import type { RGBMediaSource } from "./types.js";
import { MediaPreparationError } from "./types.js";

const extensionByType: Readonly<Record<RGBMediaSource["detectedMimeType"], string>> = {
  "image/heic": "heic",
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/json": "bin",
  "application/octet-stream": "bin",
};

export class MediaPreparationWorkspace {
  readonly directory: string;
  readonly #maximumBytes: number;
  readonly #root: string;
  #cleaned = false;

  private constructor(root: string, directory: string, maximumBytes: number) {
    this.#root = root;
    this.directory = directory;
    this.#maximumBytes = maximumBytes;
  }

  static async create(root: string, maximumBytes: number): Promise<MediaPreparationWorkspace> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new MediaPreparationError("DISK_LIMIT_EXCEEDED");
    }
    const resolvedRoot = path.resolve(root);
    await mkdir(resolvedRoot, { mode: 0o700, recursive: true });
    const directory = await mkdtemp(path.join(resolvedRoot, "c8-media-prep-"));
    await chmod(directory, 0o700);
    return new MediaPreparationWorkspace(resolvedRoot, directory, maximumBytes);
  }

  sourcePath(index: number, descriptor: RGBMediaSource): string {
    return this.resolve(
      `source-${String(index).padStart(4, "0")}.${extensionByType[descriptor.detectedMimeType]}`,
    );
  }

  framePattern(sourceIndex: number): string {
    return this.resolve(`frame-${String(sourceIndex).padStart(4, "0")}-%06d.png`);
  }

  resolve(fileName: string): string {
    if (!/^[a-z0-9][a-z0-9_.%+-]{0,99}$/u.test(fileName)) {
      throw new MediaPreparationError("PROCESS_FAILED");
    }
    const candidate = path.resolve(this.directory, fileName);
    if (path.dirname(candidate) !== this.directory) {
      throw new MediaPreparationError("PROCESS_FAILED");
    }
    return candidate;
  }

  assertOwnedPath(candidate: string): void {
    const resolved = path.resolve(candidate);
    if (path.dirname(resolved) !== this.directory || resolved === this.directory) {
      throw new MediaPreparationError("PROCESS_FAILED");
    }
  }

  async streamSource(
    source: AsyncIterable<Uint8Array>,
    destination: string,
    expectedBytes: number,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertOwnedPath(destination);
    const handle = await open(destination, "wx", 0o600);
    const hash = createHash("sha256");
    let byteSize = 0;
    try {
      for await (const chunk of source) {
        if (signal?.aborted === true) throw new MediaPreparationError("CANCELLED");
        byteSize += chunk.byteLength;
        if (byteSize > expectedBytes || byteSize > this.#maximumBytes) {
          throw new MediaPreparationError("SOURCE_SIZE_MISMATCH");
        }
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (byteSize !== expectedBytes) throw new MediaPreparationError("SOURCE_SIZE_MISMATCH");
    if (hash.digest("hex") !== expectedSha256) throw new MediaPreparationError("HASH_MISMATCH");
    await this.assertWithinQuota();
  }

  framePaths(sourceIndex: number): Promise<readonly string[]> {
    const prefix = `frame-${String(sourceIndex).padStart(4, "0")}-`;
    return readdir(this.directory).then((entries) =>
      entries
        .filter((entry) => new RegExp(`^${prefix}[0-9]{6}\\.png$`, "u").test(entry))
        .sort()
        .map((entry) => this.resolve(entry)),
    );
  }

  openFile(filePath: string): AsyncIterable<Uint8Array> {
    this.assertOwnedPath(filePath);
    return createReadStream(filePath);
  }

  async sha256(filePath: string, signal?: AbortSignal): Promise<string> {
    this.assertOwnedPath(filePath);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
      if (signal?.aborted === true) throw new MediaPreparationError("CANCELLED");
      if (!(chunk instanceof Uint8Array)) throw new MediaPreparationError("PROCESS_FAILED");
      hash.update(chunk);
    }
    return hash.digest("hex");
  }

  async assertWithinQuota(): Promise<number> {
    let total = 0;
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      const entryPath = path.join(this.directory, entry.name);
      const metadata = await lstat(entryPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new MediaPreparationError("PROCESS_FAILED");
      }
      total += metadata.size;
      if (total > this.#maximumBytes) throw new MediaPreparationError("DISK_LIMIT_EXCEEDED");
    }
    return total;
  }

  async cleanup(): Promise<void> {
    if (this.#cleaned) return;
    const expectedPrefix = path.join(this.#root, "c8-media-prep-");
    if (!this.directory.startsWith(expectedPrefix) || this.directory === this.#root) {
      throw new MediaPreparationError("PROCESS_FAILED");
    }
    await rm(this.directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
    this.#cleaned = true;
  }
}
