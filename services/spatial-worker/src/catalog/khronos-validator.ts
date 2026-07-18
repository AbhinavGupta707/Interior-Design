import {
  CatalogError,
  pinnedKhronosValidatorVersion,
  sha256Bytes,
  type KhronosValidatorEvidence,
  type KhronosValidatorPort,
} from "@interior-design/catalog";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

interface ValidatorMessage {
  readonly code: string;
}

interface ValidatorReport {
  readonly issues: {
    readonly messages: readonly ValidatorMessage[];
    readonly numErrors: number;
    readonly numWarnings: number;
  };
}

interface KhronosValidatorModule {
  readonly validateBytes: (
    bytes: Uint8Array,
    options: {
      readonly format: "glb";
      readonly maxIssues: number;
      readonly uri: string;
      readonly writeTimestamp: false;
    },
  ) => Promise<ValidatorReport>;
  readonly version: () => string;
}

function loadPinnedModule(): KhronosValidatorModule {
  const localRequire = createRequire(import.meta.url);
  const candidates: string[] = [];
  try {
    candidates.push(localRequire.resolve("@interior-design/scene-compiler"));
  } catch {
    // Source-mode tests have no built default export; the next package-owned anchors cover them.
  }
  candidates.push(
    fileURLToPath(new URL("../../../../packages/scene-compiler/src/index.ts", import.meta.url)),
    fileURLToPath(new URL("../../../../../packages/scene-compiler/src/index.ts", import.meta.url)),
  );
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const loaded = createRequire(candidate)("gltf-validator") as KhronosValidatorModule;
      if (
        typeof loaded.validateBytes === "function" &&
        typeof loaded.version === "function" &&
        loaded.version() === pinnedKhronosValidatorVersion
      ) {
        return loaded;
      }
    } catch {
      // Try the next exact package-owned anchor and fail closed below.
    }
  }
  throw new CatalogError("CATALOG_VALIDATOR_FAILED");
}

export class PinnedKhronosValidator implements KhronosValidatorPort {
  readonly #module: KhronosValidatorModule;

  constructor(module: KhronosValidatorModule = loadPinnedModule()) {
    if (module.version() !== pinnedKhronosValidatorVersion) {
      throw new CatalogError("CATALOG_VALIDATOR_FAILED");
    }
    this.#module = module;
  }

  async validate(bytes: Uint8Array, artifactSha256: string): Promise<KhronosValidatorEvidence> {
    if (!/^[a-f0-9]{64}$/u.test(artifactSha256) || sha256Bytes(bytes) !== artifactSha256) {
      throw new CatalogError("CATALOG_VALIDATOR_FAILED");
    }
    try {
      const report = await this.#module.validateBytes(bytes, {
        format: "glb",
        maxIssues: 10_000,
        uri: `${artifactSha256}.glb`,
        writeTimestamp: false,
      });
      return {
        issueCodes: report.issues.messages.map(({ code }) => code).sort(),
        numErrors: report.issues.numErrors,
        numWarnings: report.issues.numWarnings,
        validatorVersion: this.#module.version(),
      };
    } catch (error) {
      throw new CatalogError("CATALOG_VALIDATOR_FAILED", { cause: error });
    }
  }
}
