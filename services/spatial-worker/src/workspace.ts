import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { MediaRejection, RetryableWorkerError } from "./errors.js";

export interface SourceFingerprint {
  readonly byteSize: number;
  readonly sha256: string;
}

export class IsolatedWorkspace {
  readonly directory: string;
  readonly #maximumBytes: number;
  readonly #root: string;
  #cleaned = false;

  private constructor(root: string, directory: string, maximumBytes: number) {
    this.#root = root;
    this.directory = directory;
    this.#maximumBytes = maximumBytes;
  }

  static async create(root: string, maximumBytes: number): Promise<IsolatedWorkspace> {
    const resolvedRoot = path.resolve(root);
    await mkdir(resolvedRoot, { mode: 0o700, recursive: true });
    const directory = await mkdtemp(path.join(resolvedRoot, "c2-ingest-"));
    await chmod(directory, 0o700);
    return new IsolatedWorkspace(resolvedRoot, directory, maximumBytes);
  }

  resolve(fileName: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(fileName)) {
      throw new Error("Workspace file names must be safe basenames.");
    }
    const candidate = path.resolve(this.directory, fileName);
    if (path.dirname(candidate) !== this.directory) {
      throw new Error("Workspace path escaped its isolated directory.");
    }
    return candidate;
  }

  async streamSource(
    source: AsyncIterable<Uint8Array>,
    fileName = "source.bin",
    signal?: AbortSignal,
  ): Promise<SourceFingerprint> {
    const destination = this.resolve(fileName);
    const handle = await open(destination, "wx", 0o600);
    const hash = createHash("sha256");
    let byteSize = 0;
    try {
      for await (const chunk of source) {
        if (signal?.aborted === true) throw signal.reason;
        byteSize += chunk.byteLength;
        if (byteSize > this.#maximumBytes) {
          throw new MediaRejection("resource-limit");
        }
        hash.update(chunk);
        await handle.writeFile(chunk);
      }
      await handle.sync();
    } catch (error) {
      if (error instanceof MediaRejection) throw error;
      throw new RetryableWorkerError("source-stream-failed", error);
    } finally {
      await handle.close();
    }
    return { byteSize, sha256: hash.digest("hex") };
  }

  async assertWithinQuota(): Promise<number> {
    const measure = async (directory: string): Promise<number> => {
      let total = 0;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const metadata = await lstat(entryPath);
        if (metadata.isSymbolicLink()) {
          throw new MediaRejection("processing-failed");
        }
        if (metadata.isDirectory()) {
          total += await measure(entryPath);
        } else if (metadata.isFile()) {
          total += metadata.size;
        } else {
          throw new MediaRejection("processing-failed");
        }
        if (total > this.#maximumBytes) {
          throw new MediaRejection("resource-limit");
        }
      }
      return total;
    };
    return measure(this.directory);
  }

  async fingerprintFile(filePath: string): Promise<SourceFingerprint> {
    const resolved = path.resolve(filePath);
    if (path.dirname(resolved) !== this.directory) {
      throw new Error("Only direct workspace artifacts can be fingerprinted.");
    }
    const hash = createHash("sha256");
    let byteSize = 0;
    for await (const chunk of createReadStream(resolved) as AsyncIterable<Buffer>) {
      byteSize += chunk.byteLength;
      hash.update(chunk);
    }
    return { byteSize, sha256: hash.digest("hex") };
  }

  async cleanup(): Promise<void> {
    if (this.#cleaned) return;
    const expectedPrefix = path.join(this.#root, "c2-ingest-");
    if (!this.directory.startsWith(expectedPrefix) || this.directory === this.#root) {
      throw new Error("Refusing to clean an unrecognised workspace path.");
    }
    await rm(this.directory, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 });
    this.#cleaned = true;
  }
}
