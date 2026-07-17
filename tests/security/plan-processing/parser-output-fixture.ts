import { syntheticUuid } from "../../../packages/test-fixtures/src/plans/bytes.js";
import { holdoutInBoxPlanFixtures } from "../../../packages/test-fixtures/src/plans/holdout/catalog.js";

const sourceFixture = requireSourceFixture();

export const parserScope = Object.freeze({
  assetId: sourceFixture.scope.assetId,
  jobId: syntheticUuid(80_001),
  normalizedInputSha256: "b".repeat(64),
  projectId: sourceFixture.scope.projectId,
  sourceSha256: sourceFixture.sha256,
});

export function validParserProposal(): Record<string, unknown> {
  const levelId = syntheticUuid(81_000);
  const wallIds = [0, 1, 2, 3].map((offset) => syntheticUuid(81_010 + offset));
  const region = { maximum: { x: 5_500, y: 4_000 }, minimum: { x: 50, y: 50 } };
  const candidateCore = { confidence: 92, sourceRegion: region };
  return {
    candidates: [
      {
        ...candidateCore,
        candidateId: levelId,
        elevationMillimetres: 0,
        kind: "level",
        suggestedName: "Synthetic ground level",
      },
      ...wallIds.map((candidateId, index) => ({
        ...candidateCore,
        candidateId,
        end: [
          { x: 5_500, y: 50 },
          { x: 5_500, y: 4_000 },
          { x: 50, y: 4_000 },
          { x: 50, y: 50 },
        ][index],
        kind: "wall",
        levelCandidateId: levelId,
        start: [
          { x: 50, y: 50 },
          { x: 5_500, y: 50 },
          { x: 5_500, y: 4_000 },
          { x: 50, y: 4_000 },
        ][index],
      })),
      {
        ...candidateCore,
        candidateId: syntheticUuid(81_020),
        end: { x: 3_100, y: 50 },
        hostWallCandidateId: wallIds[0],
        kind: "opening",
        levelCandidateId: levelId,
        openingKind: "door",
        start: { x: 2_200, y: 50 },
      },
      {
        ...candidateCore,
        boundaryWallCandidateIds: wallIds,
        candidateId: syntheticUuid(81_030),
        kind: "space",
        levelCandidateId: levelId,
        suggestedName: "Synthetic room",
      },
    ],
    createdAt: "2026-07-17T08:00:00.000Z",
    findings: [],
    jobId: parserScope.jobId,
    normalizedInputSha256: parserScope.normalizedInputSha256,
    overallConfidence: 92,
    parser: {
      adapterId: "c6-fixture-parser",
      adapterVersion: "1.0.0",
      manifestSha256: "c".repeat(64),
      mode: "deterministic-fixture",
      normalizers: [{ name: "c6-vector-normalizer", version: "1.0.0" }],
    },
    projectId: parserScope.projectId,
    proposalId: syntheticUuid(80_002),
    schemaVersion: "c6-plan-proposal-v1",
    source: {
      assetId: parserScope.assetId,
      byteSize: sourceFixture.bytes.byteLength,
      coordinateSpace: "svg-microunits",
      detectedMimeType: "image/svg+xml",
      heightSourceUnits: 450_000,
      pageIndex: 0,
      projectId: parserScope.projectId,
      rights: {
        basis: "public-domain",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sha256: parserScope.sourceSha256,
      widthSourceUnits: 600_000,
    },
    status: "proposal",
    unresolvedRegions: [],
  };
}

export function encodeParserOutput(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function requireSourceFixture() {
  const fixture = holdoutInBoxPlanFixtures.at(0);
  if (fixture === undefined)
    throw new Error("C6 parser output fixture requires one in-box source.");
  return fixture;
}
