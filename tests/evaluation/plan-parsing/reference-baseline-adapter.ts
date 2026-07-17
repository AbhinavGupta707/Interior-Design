import { createHash } from "node:crypto";

import type { PlanFixture } from "../../../packages/test-fixtures/src/plans/types.js";

import type { AdapterObservation, PlanEvaluationAdapter } from "./types.js";

const adapterId = "c6-independent-reference-fixture";
const adapterVersion = "1.0.0";

export class ReferenceBaselineAdapter implements PlanEvaluationAdapter {
  readonly manifest = Object.freeze({
    adapterId,
    adapterVersion,
    evidenceKind: "independent-reference" as const,
    manifestSha256: createHash("sha256")
      .update("c6-independent-reference-fixture@1.0.0")
      .digest("hex"),
  });

  evaluate(fixture: PlanFixture): Promise<AdapterObservation> {
    const sequence = sequenceFor(fixture.id);
    const processing = {
      cpuMilliseconds: 18 + sequence * 2,
      peakMemoryMebibytes: 24 + (sequence % 7) * 3,
      wallMilliseconds: 27 + sequence * 3,
    };
    if (fixture.expected.disposition !== "proposal") {
      return Promise.resolve({
        adapterId,
        adapterVersion,
        code: fixture.expected.abstentionCode ?? "unsupported-input",
        crossScopeViolationCount: 0,
        fixtureId: fixture.id,
        processing,
        sourceSha256: fixture.sha256,
        status: "abstained",
      });
    }
    return Promise.resolve({
      adapterId,
      adapterVersion,
      confidenceSamples: [
        { confidence: 96, correct: true, kind: "level" },
        { confidence: 92, correct: true, kind: "wall" },
        { confidence: 88, correct: true, kind: "wall" },
        { confidence: 84, correct: true, kind: "opening" },
        { confidence: 20, correct: false, kind: "space" },
      ],
      correction: {
        actionCount: 5 + (sequence % 5),
        automatedReviewMilliseconds: 42_000 + sequence * 1_000,
        humanStudy: false,
      },
      crossScopeViolationCount: 0,
      fixtureId: fixture.id,
      geometry: {
        calibrationResidualsMillimetres: [5 + (sequence % 5) * 3],
        hiddenOmittedRegionCount: 0,
        invalidRoomCount: 0,
        levelCount: 1,
        openingCentreErrorsMillimetres: [18 + (sequence % 5) * 8],
        unhostedOpeningCount: 0,
        wallEndpointErrorsMillimetres: [
          8 + (sequence % 6) * 4,
          12 + (sequence % 7) * 4,
          16 + (sequence % 5) * 4,
          20 + (sequence % 4) * 5,
        ],
      },
      processing,
      sourceSha256: fixture.sha256,
      status: "proposal",
    });
  }
}

function sequenceFor(fixtureId: string): number {
  const token = fixtureId.split("-").at(-1) ?? fixtureId;
  let value = 0;
  for (const character of token) value = (value + (character.codePointAt(0) ?? 0)) % 17;
  return value;
}
