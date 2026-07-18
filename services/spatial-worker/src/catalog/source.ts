import { CatalogError } from "@interior-design/catalog";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface CatalogSourceReader {
  read(relativePath: string, maximumBytes: number): Promise<Uint8Array>;
}

function safeRelativePath(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 512 &&
    !isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..") &&
    /^[a-zA-Z0-9._/-]+$/u.test(value)
  );
}

export class RepositoryCatalogSource implements CatalogSourceReader {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async create(root: string): Promise<RepositoryCatalogSource> {
    const canonicalRoot = await realpath(root);
    const rootStat = await lstat(canonicalRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new CatalogError("CATALOG_SOURCE_PATH_INVALID");
    }
    return new RepositoryCatalogSource(canonicalRoot);
  }

  async read(relativePath: string, maximumBytes: number): Promise<Uint8Array> {
    if (
      !safeRelativePath(relativePath) ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1
    ) {
      throw new CatalogError("CATALOG_SOURCE_PATH_INVALID");
    }
    const candidate = resolve(this.#root, relativePath);
    const fromRoot = relative(this.#root, candidate);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
      throw new CatalogError("CATALOG_SOURCE_PATH_INVALID");
    }
    let current = this.#root;
    for (const component of relativePath.split("/")) {
      current = resolve(current, component);
      let stat;
      try {
        stat = await lstat(current);
      } catch (error) {
        throw new CatalogError("CATALOG_SOURCE_PATH_INVALID", { cause: error });
      }
      if (stat.isSymbolicLink()) throw new CatalogError("CATALOG_SOURCE_PATH_INVALID");
    }
    const canonicalCandidate = await realpath(candidate);
    if (canonicalCandidate !== candidate) throw new CatalogError("CATALOG_SOURCE_PATH_INVALID");
    const stat = await lstat(candidate);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) {
      throw new CatalogError("CATALOG_RESOURCE_LIMIT");
    }
    const bytes = await readFile(candidate);
    if (bytes.byteLength !== stat.size || bytes.byteLength > maximumBytes) {
      throw new CatalogError("CATALOG_RESOURCE_LIMIT");
    }
    return Uint8Array.from(bytes);
  }
}
