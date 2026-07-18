import type { DesignOption } from "@interior-design/contracts";

import { compareStrings } from "./canonical.js";
import { manhattanDistanceMm } from "./geometry.js";
import type { CandidateEvaluationArtifacts, PairwiseDiversityDeclaration } from "./types.js";

function counts(values: readonly string[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  values.forEach((value) => result.set(value, (result.get(value) ?? 0) + 1));
  return result;
}

function multisetDistanceBasisPoints(left: readonly string[], right: readonly string[]): number {
  const leftCounts = counts(left);
  const rightCounts = counts(right);
  const keys = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  let intersection = 0;
  let union = 0;
  keys.forEach((key) => {
    const leftCount = leftCounts.get(key) ?? 0;
    const rightCount = rightCounts.get(key) ?? 0;
    intersection += Math.min(leftCount, rightCount);
    union += Math.max(leftCount, rightCount);
  });
  return union === 0 ? 0 : Math.floor(((union - intersection) * 10_000) / union);
}

function placementDistanceMm(
  left: CandidateEvaluationArtifacts,
  right: CandidateEvaluationArtifacts,
): number {
  const commonKeys = [...left.placementsByAssignment.keys()]
    .filter((key) => right.placementsByAssignment.has(key))
    .sort(compareStrings);
  if (commonKeys.length === 0) return 0;
  const distance = commonKeys.reduce((sum, key) => {
    const leftPlacement = left.placementsByAssignment.get(key);
    const rightPlacement = right.placementsByAssignment.get(key);
    if (leftPlacement === undefined || rightPlacement === undefined) return sum;
    return sum + manhattanDistanceMm(leftPlacement, rightPlacement);
  }, 0);
  return Math.min(10_000_000, Math.floor(distance / commonKeys.length));
}

export function pairwiseDiversity(
  left: CandidateEvaluationArtifacts,
  right: CandidateEvaluationArtifacts,
): Omit<PairwiseDiversityDeclaration, "spatiallyOrMateriallyDistinct"> & {
  readonly spatiallyOrMateriallyDistinct: boolean;
} {
  const result = {
    assetInventoryDistanceBasisPoints: multisetDistanceBasisPoints(
      left.assetInventoryTokens,
      right.assetInventoryTokens,
    ),
    assignmentDistanceBasisPoints: multisetDistanceBasisPoints(
      left.assignmentTokens,
      right.assignmentTokens,
    ),
    leftOptionId: left.candidate.candidateId,
    materialDistanceBasisPoints: multisetDistanceBasisPoints(
      left.materialTokens,
      right.materialTokens,
    ),
    operationSignatureDistanceBasisPoints: multisetDistanceBasisPoints(
      left.operationSignatures,
      right.operationSignatures,
    ),
    placementDistanceMm: placementDistanceMm(left, right),
    rightOptionId: right.candidate.candidateId,
  };
  return {
    ...result,
    spatiallyOrMateriallyDistinct:
      result.assetInventoryDistanceBasisPoints > 0 ||
      result.assignmentDistanceBasisPoints > 0 ||
      result.materialDistanceBasisPoints > 0 ||
      result.operationSignatureDistanceBasisPoints > 0 ||
      result.placementDistanceMm > 0,
  };
}

function objectiveScore(
  candidate: CandidateEvaluationArtifacts,
  id: DesignOption["objectives"][number]["id"],
): number {
  return candidate.candidate.objectives.find((objective) => objective.id === id)?.basisPoints ?? 0;
}

function dominates(
  left: CandidateEvaluationArtifacts,
  right: CandidateEvaluationArtifacts,
): boolean {
  const ids = new Set([
    ...left.candidate.objectives.map(({ id }) => id),
    ...right.candidate.objectives.map(({ id }) => id),
  ]);
  let strictlyBetter = false;
  for (const id of ids) {
    const leftScore = objectiveScore(left, id);
    const rightScore = objectiveScore(right, id);
    if (leftScore < rightScore) return false;
    if (leftScore > rightScore) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function paretoFrontier(
  candidates: readonly CandidateEvaluationArtifacts[],
): readonly CandidateEvaluationArtifacts[] {
  return candidates
    .filter(
      (candidate, index) =>
        !candidates.some(
          (other, otherIndex) => index !== otherIndex && dominates(other, candidate),
        ),
    )
    .sort((left, right) => compareStrings(left.candidate.candidateId, right.candidate.candidateId));
}

const primaryObjectiveByDirection = Object.freeze({
  "circulation-first": "circulation",
  "conversation-first": "conversation",
  "daylight-first": "daylight",
  "retention-first": "retention",
  "storage-first": "storage",
} as const);

function directionOrder(
  left: CandidateEvaluationArtifacts,
  right: CandidateEvaluationArtifacts,
  direction: DesignOption["direction"],
): number {
  const objective = primaryObjectiveByDirection[direction];
  const scoreDifference = objectiveScore(right, objective) - objectiveScore(left, objective);
  return scoreDifference === 0
    ? compareStrings(left.candidate.candidateId, right.candidate.candidateId)
    : scoreDifference;
}

function canJoin(
  candidate: CandidateEvaluationArtifacts,
  selected: readonly CandidateEvaluationArtifacts[],
): boolean {
  return selected.every(
    (other) => pairwiseDiversity(other, candidate).spatiallyOrMateriallyDistinct,
  );
}

function diversityScore(
  candidate: CandidateEvaluationArtifacts,
  selected: readonly CandidateEvaluationArtifacts[],
): number {
  if (selected.length === 0) return 0;
  return Math.min(
    ...selected.map((other) => {
      const diversity = pairwiseDiversity(other, candidate);
      return (
        diversity.assetInventoryDistanceBasisPoints +
        diversity.assignmentDistanceBasisPoints +
        diversity.materialDistanceBasisPoints +
        diversity.operationSignatureDistanceBasisPoints +
        Math.min(10_000, diversity.placementDistanceMm * 10)
      );
    }),
  );
}

export function selectDiverseCandidates(
  frontier: readonly CandidateEvaluationArtifacts[],
  requestedDirections: readonly DesignOption["direction"][],
  requestedCount: number,
): readonly CandidateEvaluationArtifacts[] {
  const selected: CandidateEvaluationArtifacts[] = [];
  for (const direction of [...requestedDirections].sort(compareStrings)) {
    const candidates = frontier
      .filter((candidate) => candidate.candidate.direction === direction)
      .sort((left, right) => directionOrder(left, right, direction));
    const chosen = candidates.find((candidate) => canJoin(candidate, selected));
    if (chosen === undefined) return [];
    selected.push(chosen);
  }
  while (selected.length < requestedCount) {
    const candidates = frontier
      .filter(
        (candidate) =>
          !selected.some(
            ({ candidate: selectedCandidate }) =>
              selectedCandidate.candidateId === candidate.candidate.candidateId,
          ) && canJoin(candidate, selected),
      )
      .sort((left, right) => {
        const score = diversityScore(right, selected) - diversityScore(left, selected);
        return score === 0
          ? compareStrings(left.candidate.candidateId, right.candidate.candidateId)
          : score;
      });
    const next = candidates[0];
    if (next === undefined) return [];
    selected.push(next);
  }
  return selected.sort((left, right) =>
    compareStrings(left.candidate.candidateId, right.candidate.candidateId),
  );
}

export function completePairwiseMatrix(
  candidates: readonly CandidateEvaluationArtifacts[],
): readonly PairwiseDiversityDeclaration[] {
  const matrix: PairwiseDiversityDeclaration[] = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (left === undefined || right === undefined) continue;
      const diversity = pairwiseDiversity(left, right);
      if (!diversity.spatiallyOrMateriallyDistinct) continue;
      matrix.push({ ...diversity, spatiallyOrMateriallyDistinct: true });
    }
  }
  return matrix.sort((left, right) => {
    const leftKey = `${left.leftOptionId}:${left.rightOptionId}`;
    const rightKey = `${right.leftOptionId}:${right.rightOptionId}`;
    return compareStrings(leftKey, rightKey);
  });
}
