import { modelOperationRequestSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOperationDraftInput,
  calibrationRequestFromKnownLength,
  defaultReview,
  sourcePointToMillimetres,
} from "../../src/features/plan-import/review-model";
import type { CandidateReviewMap } from "../../src/features/plan-import/review-model";
import { calibration, proposal, session } from "./fixtures";

describe("C6 exact calibration and operation mapping", () => {
  it("reduces known-length evidence to a bounded rational transform", () => {
    const request = calibrationRequestFromKnownLength({
      knownLengthMillimetres: 3_500,
      sourceEnd: { x: 8_000, y: 1_000 },
      sourceStart: { x: 1_000, y: 1_000 },
    });
    expect(request.sourceToModel).toMatchObject({
      a: 1,
      d: 1,
      denominator: 2,
      rounding: "half-away-from-zero",
    });
  });

  it("uses exact half-away-from-zero rounding for negative and positive coordinates", () => {
    const halfScale = {
      ...calibration,
      sourceToModel: { ...calibration.sourceToModel, denominator: 2 },
    };
    expect(sourcePointToMillimetres({ x: 1, y: -1 }, halfScale)).toEqual({ xMm: 1, yMm: -1 });
  });

  it("maps accepted/corrected candidates to strict C5 operations and keeps exclusions operation-free", () => {
    const reviews: CandidateReviewMap = Object.fromEntries(
      proposal.candidates.map((candidate) => [
        candidate.candidateId,
        { ...defaultReview(candidate), decision: "accepted" },
      ]),
    );
    const excluded = proposal.candidates.find((candidate) => candidate.kind === "opening");
    const correctedWall = proposal.candidates.find((candidate) => candidate.kind === "wall");
    if (!excluded || !correctedWall) throw new Error("Missing fixture.");
    const corrected = defaultReview(correctedWall);
    const result = buildOperationDraftInput({
      actorUserId: session.actor.userId,
      calibration,
      proposal,
      reviews: {
        ...reviews,
        [excluded.candidateId]: { decision: "excluded" },
        [correctedWall.candidateId]: {
          correction: {
            end: { x: 8_100, y: 1_000 },
            start: correctedWall.start,
            thicknessMillimetres: 200,
          },
          decision: "corrected",
        },
      },
    });

    expect(result.operations).toHaveLength(proposal.candidates.length - 1);
    expect(
      result.operations.every(
        (operation) => modelOperationRequestSchema.safeParse(operation).success,
      ),
    ).toBe(true);
    expect(
      result.decisions.find(({ candidateId }) => candidateId === excluded.candidateId),
    ).toMatchObject({
      decision: "excluded",
      resultingClientOperationIds: [],
    });
    expect(
      result.decisions.find(({ candidateId }) => candidateId === correctedWall.candidateId)
        ?.resultingClientOperationIds,
    ).toHaveLength(1);
    const correctedOperation = result.operations.find((operation) =>
      operation.type === "wall.create.v1" ? operation.wall.id === correctedWall.candidateId : false,
    );
    expect(correctedOperation?.type).toBe("wall.create.v1");
    if (correctedOperation?.type !== "wall.create.v1") throw new Error("Missing corrected wall.");
    expect(correctedOperation.wall.origin).toMatchObject({
      actorUserId: session.actor.userId,
      evidenceIds: [proposal.source.assetId],
      state: "user-asserted",
    });
    expect(correctedOperation.wall.baseOffsetMm.knowledge).toBe("unknown");
    expect(
      result.operations
        .filter((operation) => operation.type === "wall.create.v1")
        .every((operation) => operation.wall.baseOffsetMm.knowledge === "unknown"),
    ).toBe(true);
    expect(corrected.correction).toBeDefined();
  });

  it("matches the server's projected opening offset and ordered space boundary", () => {
    const reviews: CandidateReviewMap = Object.fromEntries(
      proposal.candidates.map((candidate) => [
        candidate.candidateId,
        { ...defaultReview(candidate), decision: "accepted" },
      ]),
    );
    const result = buildOperationDraftInput({
      actorUserId: session.actor.userId,
      calibration,
      proposal,
      reviews,
    });
    const opening = result.operations.find((operation) => operation.type === "opening.insert.v1");
    const space = result.operations.find((operation) => operation.type === "space.create.v1");
    if (opening?.type !== "opening.insert.v1" || space?.type !== "space.create.v1") {
      throw new Error("Missing opening or space operation.");
    }
    expect(opening.opening.offsetAlongHostMm).toMatchObject({
      knowledge: "known",
      value: 1_500,
    });
    expect(space.space.boundary).toMatchObject({
      knowledge: "known",
      value: [
        { xMm: 1_000, yMm: 1_000 },
        { xMm: 8_000, yMm: 1_000 },
        { xMm: 8_000, yMm: 6_000 },
        { xMm: 1_000, yMm: 6_000 },
      ],
    });
  });
});
