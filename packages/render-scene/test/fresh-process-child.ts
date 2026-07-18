import { buildRenderScene } from "../src/index.js";
import { renderFixture } from "./support.js";

const result = buildRenderScene(renderFixture().input);
process.stdout.write(
  JSON.stringify({
    envelope: result.envelope,
    manifestBase64: Buffer.from(result.canonicalBytes()).toString("base64"),
  }),
);
