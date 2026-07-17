import type { FusionAcceptanceFixture } from "../../../packages/test-fixtures/src/fusion/types.js";

import type {
  FusionCaseObservation,
  FusionEvaluationAdapter,
  SingleSourceObservation,
} from "./types.js";

export async function runFusionAdapter(
  adapter: FusionEvaluationAdapter,
  fixtures: readonly FusionAcceptanceFixture[],
): Promise<readonly FusionCaseObservation[]> {
  const observations: FusionCaseObservation[] = [];
  for (const fixture of [...fixtures].sort((left, right) => left.id.localeCompare(right.id))) {
    const observation = await adapter.evaluate(fixture);
    observations.push(freezeObservation(observation));
  }
  return Object.freeze(observations);
}

function freezeObservation(observation: FusionCaseObservation): FusionCaseObservation {
  return Object.freeze({
    ...observation,
    fusionCandidate: Object.freeze(observation.fusionCandidate),
    singleSourceObservations: Object.freeze(
      observation.singleSourceObservations.map((source): SingleSourceObservation =>
        Object.freeze({ ...source, candidate: Object.freeze(source.candidate) }),
      ),
    ),
  });
}
