import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";

import type { CanonicalSnapshotCodec, CanonicalSnapshotEncoding } from "./types.js";

/**
 * Production C4 codec adapter. The domain package is the single canonical-byte
 * authority; the API never maintains a second serializer or hashes JSONB text.
 */
export class DomainCanonicalSnapshotCodec implements CanonicalSnapshotCodec {
  encode(snapshot: Parameters<CanonicalSnapshotCodec["encode"]>[0]): CanonicalSnapshotEncoding {
    const canonical = canonicalizeHomeSnapshot(snapshot);
    return Object.freeze({
      canonicalByteLength: canonical.canonicalByteLength,
      canonicalJson: canonical.canonicalJson,
      snapshot: canonical.snapshot,
      snapshotSha256: canonical.snapshotSha256,
    });
  }
}
