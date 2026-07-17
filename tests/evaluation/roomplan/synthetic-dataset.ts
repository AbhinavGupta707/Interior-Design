import { createHash } from "node:crypto";

import type {
  EvaluationAdapterManifest,
  RoomPlanEvaluationFixture,
  RoomPlanObservation,
} from "./types.js";

const inBoxDefinitions = [
  ["synthetic-single-basic", false],
  ["synthetic-single-polygon", false],
  ["synthetic-single-curve", false],
  ["synthetic-structure-two-room", true],
  ["synthetic-interruption-relocalised", true],
  ["synthetic-offline-resume", false],
] as const;
const negativeDefinitions = [
  ["synthetic-incompatible-world-space", "incompatible-world-space", true],
  ["synthetic-extreme-transform", "invalid-normalized-input", false],
  ["synthetic-duplicate-identifier", "invalid-normalized-input", false],
  ["synthetic-missing-parent", "invalid-normalized-input", false],
  ["synthetic-rights-withdrawn", "rights-not-permitted", false],
  ["synthetic-oversized-count", "resource-limit", true],
] as const;

export const syntheticRoomPlanFixtures = Object.freeze([
  ...inBoxDefinitions.map(([id, structure]): RoomPlanEvaluationFixture => ({
    category: "in-box",
    evidenceClass: "synthetic-conformance",
    expectedOutcome: "proposal",
    id,
    sourceSha256: sha256(id),
    structure,
  })),
  ...negativeDefinitions.map(([id, expectedCode, structure]): RoomPlanEvaluationFixture => ({
    category: "hard-negative",
    evidenceClass: "synthetic-conformance",
    expectedCode,
    expectedOutcome: "abstained",
    id,
    sourceSha256: sha256(id),
    structure,
  })),
]);

export const syntheticAdapterManifest = Object.freeze({
  adapterId: "c7-synthetic-reference",
  adapterVersion: "1.0.0",
  evidenceKind: "independent-reference",
  manifestSha256: sha256("c7-synthetic-reference:1.0.0"),
} satisfies EvaluationAdapterManifest);

export const syntheticRoomPlanObservations = Object.freeze(
  syntheticRoomPlanFixtures.map((fixture): RoomPlanObservation => {
    const packageManifestSha256 = sha256(`${fixture.id}:package`);
    const core = {
      adapterId: syntheticAdapterManifest.adapterId,
      adapterVersion: syntheticAdapterManifest.adapterVersion,
      canonicalMutationCount: 0,
      fixtureId: fixture.id,
      packageManifestSha256,
      peakResidentSetMebibytes: 32,
      severeErrorCodes: [],
      sourceSha256: fixture.sourceSha256,
      wallMilliseconds: 5,
    } as const;
    if (fixture.expectedOutcome === "abstained") {
      return {
        ...core,
        code: fixture.expectedCode ?? "conversion-failed",
        status: "abstained",
      };
    }
    return {
      ...core,
      confidenceSamples: [],
      proposalPackageManifestSha256: packageManifestSha256,
      status: "proposal",
    };
  }),
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
