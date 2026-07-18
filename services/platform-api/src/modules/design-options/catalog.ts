import type { InteriorAssetRef } from "@interior-design/contracts";
import {
  assetSha256,
  findAssetRecord,
  type ValidatedAssetCatalog,
} from "@interior-design/interior-assets";

import type { DesignAssetVerificationPort } from "./types.js";

export interface CatalogDesignAssetVerifierOptions {
  readonly catalog: ValidatedAssetCatalog;
}

/** Verifies the complete immutable asset reference, not merely its public identifiers. */
export class CatalogDesignAssetVerifier implements DesignAssetVerificationPort {
  readonly #catalog: ValidatedAssetCatalog;

  constructor(options: CatalogDesignAssetVerifierOptions) {
    this.#catalog = options.catalog;
  }

  verifyExact(asset: InteriorAssetRef): Promise<boolean> {
    const record = findAssetRecord(this.#catalog, asset.id, asset.versionId);
    return Promise.resolve(record !== undefined && assetSha256(record.ref) === assetSha256(asset));
  }
}
