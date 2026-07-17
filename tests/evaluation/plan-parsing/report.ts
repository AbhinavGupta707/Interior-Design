import {
  holdoutHardNegativePlanFixtures,
  holdoutInBoxPlanFixtures,
} from "../../../packages/test-fixtures/src/plans/holdout/catalog.js";

import { runAdapter } from "./adapter-seam.js";
import { ReferenceBaselineAdapter } from "./reference-baseline-adapter.js";
import { evaluatePlanAdapter } from "./reference-evaluator.js";

export async function createReferenceBaselineReport() {
  const adapter = new ReferenceBaselineAdapter();
  const fixtures = [...holdoutInBoxPlanFixtures, ...holdoutHardNegativePlanFixtures];
  const observations = await runAdapter(adapter, fixtures);
  return evaluatePlanAdapter({
    adapter: adapter.manifest,
    dataset: {
      hardNegatives: holdoutHardNegativePlanFixtures,
      inBox: holdoutInBoxPlanFixtures,
    },
    observations,
  });
}
