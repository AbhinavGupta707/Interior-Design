import type { PlanFixture } from "../../../packages/test-fixtures/src/plans/types.js";

import type { AdapterObservation, PlanEvaluationAdapter } from "./types.js";

export async function runAdapter(
  adapter: PlanEvaluationAdapter,
  fixtures: readonly PlanFixture[],
): Promise<readonly AdapterObservation[]> {
  const observations: AdapterObservation[] = [];
  for (const fixture of fixtures) {
    const observation = await adapter.evaluate(fixture);
    if (observation.fixtureId !== fixture.id) {
      throw new Error(`Adapter returned fixture ${observation.fixtureId} for ${fixture.id}.`);
    }
    if (
      observation.adapterId !== adapter.manifest.adapterId ||
      observation.adapterVersion !== adapter.manifest.adapterVersion
    ) {
      throw new Error(`Adapter manifest mismatch for fixture ${fixture.id}.`);
    }
    observations.push(observation);
  }
  return Object.freeze(observations);
}
