import { deterministicSha256 } from "../../../packages/test-fixtures/src/fusion/deterministic.js";
import type { FusionAcceptanceFixture } from "../../../packages/test-fixtures/src/fusion/types.js";

import type {
  FusionCaseObservation,
  FusionEvaluationAdapter,
  FusionEvaluationAdapterManifest,
} from "./types.js";

const adapterIdentity = Object.freeze({
  adapterId: "c9-independent-synthetic-reference-adapter",
  adapterVersion: "1.0.0",
  evidenceClass: "independent-synthetic-reference",
});

export class FusionReferenceAdapter implements FusionEvaluationAdapter {
  readonly manifest: FusionEvaluationAdapterManifest = Object.freeze({
    ...adapterIdentity,
    manifestSha256: deterministicSha256(adapterIdentity),
  });

  async evaluate(fixture: FusionAcceptanceFixture): Promise<FusionCaseObservation> {
    await Promise.resolve();
    return Object.freeze({
      adapterId: this.manifest.adapterId,
      adapterVersion: this.manifest.adapterVersion,
      fixtureId: fixture.id,
      fixtureManifestSha256: fixture.manifestSha256,
      fusionCandidate: structuredClone(fixture.referenceFusionCandidate),
      singleSourceObservations: Object.freeze(
        fixture.sources
          .filter(({ eligibleSingleSourceBaseline }) => eligibleSingleSourceBaseline)
          .map((source) => ({
            candidate: structuredClone(requiredCandidate(fixture, source.id)),
            sourceId: source.id,
            sourceReferenceSha256: source.referenceSha256,
          })),
      ),
    });
  }
}

function requiredCandidate(fixture: FusionAcceptanceFixture, sourceId: string) {
  const candidate = fixture.singleSourceCandidates[sourceId];
  if (candidate === undefined) {
    throw new Error(`C9_REFERENCE_BASELINE_MISSING:${fixture.id}:${sourceId}`);
  }
  return candidate;
}
