import { expect, it } from "vitest";

import { hashCanonicalHomeSnapshot } from "../src/index.js";
import { syntheticCanonicalSnapshot } from "./fixture.js";
import { GOLDEN_SNAPSHOT_BYTE_LENGTH, GOLDEN_SNAPSHOT_SHA256 } from "./golden.js";

it("matches the retained canonical snapshot digest in this process", () => {
  expect(hashCanonicalHomeSnapshot(syntheticCanonicalSnapshot)).toEqual({
    canonicalByteLength: GOLDEN_SNAPSHOT_BYTE_LENGTH,
    snapshotSha256: GOLDEN_SNAPSHOT_SHA256,
  });
});
