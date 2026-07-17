import { c10DefaultCompileConfiguration } from "@interior-design/contracts";

import { compileCanonicalScene } from "../src/index.js";
import { canonicalFixture, fixtureReference } from "./fixture.js";

const snapshot = canonicalFixture();
const result = await compileCanonicalScene({
  configuration: c10DefaultCompileConfiguration,
  snapshot,
  sourceSnapshot: fixtureReference(snapshot),
});

process.stdout.write(
  JSON.stringify({
    artifact: result.artifact,
    glbBase64: Buffer.from(result.glb).toString("base64"),
    manifestBase64: Buffer.from(result.manifestBytes).toString("base64"),
  }),
);
