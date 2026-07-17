import { fusionAcceptanceFixtures } from "../../../packages/test-fixtures/src/fusion/catalog.js";

import { runFusionAdapter } from "./adapter-seam.js";
import { FusionReferenceAdapter } from "./reference-adapter.js";
import { evaluateFusion } from "./reference-evaluator.js";

export async function createFusionReferenceReport() {
  const adapter = new FusionReferenceAdapter();
  const observations = await runFusionAdapter(adapter, fusionAcceptanceFixtures);
  return evaluateFusion({
    adapter: adapter.manifest,
    fixtures: fusionAcceptanceFixtures,
    observations,
  });
}
