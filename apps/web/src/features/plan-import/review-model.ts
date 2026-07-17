import {
  createPlanCalibrationRequestSchema,
  modelOperationRequestSchema,
} from "@interior-design/contracts";
import type {
  KnownAttribution,
  ModelOperationRequest,
  PlanCalibration,
  PlanCandidate,
  PlanProposal,
  PlanSourcePoint,
} from "@interior-design/contracts";
import type { planCandidateDecisionSchema } from "@interior-design/contracts";
import type { z } from "zod";

type PlanCandidateDecision = z.infer<typeof planCandidateDecisionSchema>;

export type CandidateDecision = "accepted" | "corrected" | "excluded" | "unresolved";

export interface WallCorrection {
  readonly end: PlanSourcePoint;
  readonly heightMillimetres?: number;
  readonly start: PlanSourcePoint;
  readonly thicknessMillimetres?: number;
}

export interface OpeningCorrection {
  readonly heightMillimetres?: number;
  readonly hostWallCandidateId: string;
  readonly offsetAlongHostMillimetres: number;
  readonly openingKind: "door" | "unknown" | "window";
  readonly sillHeightMillimetres?: number;
  readonly widthMillimetres: number;
}

export interface SpaceCorrection {
  readonly boundaryWallCandidateIds: readonly string[];
  readonly name: string;
}

export interface LevelCorrection {
  readonly elevationMillimetres: number;
  readonly name: string;
}

export interface CandidateReview {
  readonly correction?: LevelCorrection | OpeningCorrection | SpaceCorrection | WallCorrection;
  readonly decision: CandidateDecision;
}

export type CandidateReviewMap = Readonly<Record<string, CandidateReview>>;

function roundedDistance(start: PlanSourcePoint, end: PlanSourcePoint): number {
  return Math.max(1, Math.round(Math.hypot(end.x - start.x, end.y - start.y)));
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

export function calibrationRequestFromKnownLength(value: {
  readonly knownLengthMillimetres: number;
  readonly sourceEnd: PlanSourcePoint;
  readonly sourceStart: PlanSourcePoint;
}): z.input<typeof createPlanCalibrationRequestSchema> {
  const sourceDistance = roundedDistance(value.sourceStart, value.sourceEnd);
  const divisor = gcd(value.knownLengthMillimetres, sourceDistance);
  const numerator = value.knownLengthMillimetres / divisor;
  const denominator = sourceDistance / divisor;
  if (numerator > 1_000_000 || denominator > 1_000_000) {
    throw new Error("Choose a shorter source segment so the exact rational scale stays bounded.");
  }
  return createPlanCalibrationRequestSchema.parse({
    evidence: {
      knownLengthMillimetres: value.knownLengthMillimetres,
      method: "known-length",
      sourceEnd: value.sourceEnd,
      sourceStart: value.sourceStart,
    },
    sourceToModel: {
      a: numerator,
      b: 0,
      c: 0,
      d: numerator,
      denominator,
      rounding: "half-away-from-zero",
      translateXMillimetres: 0,
      translateYMillimetres: 0,
    },
  });
}

function halfAwayFromZero(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return Number(negative ? -rounded : rounded);
}

export function sourcePointToMillimetres(
  point: PlanSourcePoint,
  calibration: PlanCalibration,
): { readonly xMm: number; readonly yMm: number } {
  const transform = calibration.sourceToModel;
  const denominator = BigInt(transform.denominator);
  const xNumerator =
    BigInt(transform.a) * BigInt(point.x) +
    BigInt(transform.b) * BigInt(point.y) +
    BigInt(transform.translateXMillimetres) * denominator;
  const yNumerator =
    BigInt(transform.c) * BigInt(point.x) +
    BigInt(transform.d) * BigInt(point.y) +
    BigInt(transform.translateYMillimetres) * denominator;
  return {
    xMm: halfAwayFromZero(xNumerator, denominator),
    yMm: halfAwayFromZero(yNumerator, denominator),
  };
}

export function defaultReview(candidate: PlanCandidate): CandidateReview {
  if (candidate.kind === "level") {
    return {
      correction: {
        elevationMillimetres: candidate.elevationMillimetres,
        name: candidate.suggestedName,
      },
      decision: "unresolved",
    };
  }
  if (candidate.kind === "wall") {
    return {
      correction: {
        end: candidate.end,
        ...(candidate.heightMillimetres === undefined
          ? {}
          : { heightMillimetres: candidate.heightMillimetres }),
        start: candidate.start,
        ...(candidate.thicknessMillimetres === undefined
          ? {}
          : { thicknessMillimetres: candidate.thicknessMillimetres }),
      },
      decision: "unresolved",
    };
  }
  if (candidate.kind === "opening") {
    return {
      correction: {
        ...(candidate.headHeightMillimetres === undefined ||
        candidate.sillHeightMillimetres === undefined
          ? {}
          : {
              heightMillimetres: candidate.headHeightMillimetres - candidate.sillHeightMillimetres,
            }),
        hostWallCandidateId: candidate.hostWallCandidateId,
        offsetAlongHostMillimetres: 1,
        openingKind: candidate.openingKind,
        ...(candidate.sillHeightMillimetres === undefined
          ? {}
          : { sillHeightMillimetres: candidate.sillHeightMillimetres }),
        widthMillimetres: Math.max(1, roundedDistance(candidate.start, candidate.end)),
      },
      decision: "unresolved",
    };
  }
  return {
    correction: {
      boundaryWallCandidateIds: candidate.boundaryWallCandidateIds,
      name: candidate.suggestedName,
    },
    decision: "unresolved",
  };
}

function sourceAttribution(proposal: PlanProposal): KnownAttribution {
  return {
    claimId: crypto.randomUUID(),
    evidenceIds: [proposal.source.assetId],
    method: {
      kind: "plan-import",
      name: proposal.parser.adapterId,
      version: proposal.parser.adapterVersion,
    },
    state: "source-derived",
    verification: { status: "not-reviewed" },
  };
}

function userAttribution(actorUserId: string, proposal: PlanProposal): KnownAttribution {
  return {
    actorUserId,
    claimId: crypto.randomUUID(),
    evidenceIds: [proposal.source.assetId],
    method: { kind: "manual", name: "C6 structured correction", version: "1" },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

function unknownValue(reason: "not-observed" | "not-provided" | "unsupported") {
  return {
    attribution: {
      claimId: crypto.randomUUID(),
      evidenceIds: [],
      method: { kind: "plan-import" as const, name: "C6 explicit unknown", version: "1" },
      reason,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

function knownValue<T>(value: T, attribution: KnownAttribution) {
  return { attribution, knowledge: "known" as const, value };
}

function operationReason(candidate: PlanCandidate, decision: CandidateDecision): string {
  return `${decision === "corrected" ? "Correct" : "Accept"} ${candidate.kind} candidate ${candidate.candidateId} from the pinned C6 proposal.`;
}

function acceptedWallPoints(
  candidate: Extract<PlanCandidate, { kind: "wall" }>,
  review: CandidateReview,
) {
  const correction =
    review.decision === "corrected" ? (review.correction as WallCorrection | undefined) : undefined;
  return {
    end: correction?.end ?? candidate.end,
    start: correction?.start ?? candidate.start,
  };
}

function distanceMillimetres(
  start: PlanSourcePoint,
  end: PlanSourcePoint,
  calibration: PlanCalibration,
): number {
  const mappedStart = sourcePointToMillimetres(start, calibration);
  const mappedEnd = sourcePointToMillimetres(end, calibration);
  return Math.max(
    1,
    Math.round(Math.hypot(mappedEnd.xMm - mappedStart.xMm, mappedEnd.yMm - mappedStart.yMm)),
  );
}

function openingOffsetAlongHostMillimetres(
  hostStart: PlanSourcePoint,
  hostEnd: PlanSourcePoint,
  openingStart: PlanSourcePoint,
  openingEnd: PlanSourcePoint,
  calibration: PlanCalibration,
): number {
  const mappedHostStart = sourcePointToMillimetres(hostStart, calibration);
  const mappedHostEnd = sourcePointToMillimetres(hostEnd, calibration);
  const mappedOpeningStart = sourcePointToMillimetres(openingStart, calibration);
  const mappedOpeningEnd = sourcePointToMillimetres(openingEnd, calibration);
  const midpoint = {
    xMm: (mappedOpeningStart.xMm + mappedOpeningEnd.xMm) / 2,
    yMm: (mappedOpeningStart.yMm + mappedOpeningEnd.yMm) / 2,
  };
  const hostDx = mappedHostEnd.xMm - mappedHostStart.xMm;
  const hostDy = mappedHostEnd.yMm - mappedHostStart.yMm;
  const hostLength = Math.hypot(hostDx, hostDy);
  if (hostLength === 0) throw new Error("An opening cannot use a zero-length host wall.");
  return Math.max(
    1,
    Math.round(
      ((midpoint.xMm - mappedHostStart.xMm) * hostDx +
        (midpoint.yMm - mappedHostStart.yMm) * hostDy) /
        hostLength,
    ),
  );
}

function orderedWallBoundary(
  walls: readonly { readonly end: PlanSourcePoint; readonly start: PlanSourcePoint }[],
): readonly PlanSourcePoint[] {
  const first = walls[0];
  const second = walls[1];
  if (!first || !second) throw new Error("A space boundary is incomplete.");
  let currentStart = first.start;
  let currentEnd = first.end;
  const samePoint = (left: PlanSourcePoint, right: PlanSourcePoint) =>
    left.x === right.x && left.y === right.y;
  if (!samePoint(currentEnd, second.start) && !samePoint(currentEnd, second.end)) {
    if (samePoint(currentStart, second.start) || samePoint(currentStart, second.end)) {
      [currentStart, currentEnd] = [currentEnd, currentStart];
    } else {
      throw new Error("A space boundary wall chain is disconnected.");
    }
  }
  const boundary = [currentStart];
  for (const wall of walls.slice(1)) {
    if (samePoint(wall.start, currentEnd)) {
      boundary.push(wall.start);
      currentEnd = wall.end;
    } else if (samePoint(wall.end, currentEnd)) {
      boundary.push(wall.end);
      currentEnd = wall.start;
    } else {
      throw new Error("A space boundary wall chain is disconnected.");
    }
  }
  if (!samePoint(currentEnd, boundary[0] as PlanSourcePoint)) {
    throw new Error("A space boundary wall chain must close exactly.");
  }
  return boundary;
}

export function buildOperationDraftInput(options: {
  readonly actorUserId: string;
  readonly calibration: PlanCalibration;
  readonly proposal: PlanProposal;
  readonly reviews: CandidateReviewMap;
}): {
  readonly decisions: readonly PlanCandidateDecision[];
  readonly operations: readonly ModelOperationRequest[];
} {
  const { actorUserId, calibration, proposal, reviews } = options;
  const candidatesById = new Map(
    proposal.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const operationsByCandidate = new Map<string, ModelOperationRequest>();
  const ordered = proposal.candidates.toSorted(
    (left, right) =>
      ["level", "wall", "opening", "space"].indexOf(left.kind) -
      ["level", "wall", "opening", "space"].indexOf(right.kind),
  );

  for (const candidate of ordered) {
    const review = reviews[candidate.candidateId] ?? defaultReview(candidate);
    if (review.decision !== "accepted" && review.decision !== "corrected") continue;
    const corrected = review.decision === "corrected";
    const attribution = corrected
      ? userAttribution(actorUserId, proposal)
      : sourceAttribution(proposal);
    const clientOperationId = crypto.randomUUID();
    const reason = operationReason(candidate, review.decision);
    let operation: ModelOperationRequest;
    if (candidate.kind === "level") {
      const correction =
        review.decision === "corrected"
          ? (review.correction as LevelCorrection | undefined)
          : undefined;
      operation = {
        clientOperationId,
        level: {
          elementType: "level",
          elevationMm: knownValue(
            correction?.elevationMillimetres ?? candidate.elevationMillimetres,
            attribution,
          ),
          id: candidate.candidateId,
          name: knownValue(correction?.name ?? candidate.suggestedName, attribution),
          origin: attribution,
          storeyHeightMm: unknownValue("not-provided"),
        },
        reason,
        schemaVersion: "c5-model-operation-v1",
        type: "level.create.v1",
      };
    } else if (candidate.kind === "wall") {
      const correction =
        review.decision === "corrected"
          ? (review.correction as WallCorrection | undefined)
          : undefined;
      const points = acceptedWallPoints(candidate, review);
      operation = {
        clientOperationId,
        reason,
        schemaVersion: "c5-model-operation-v1",
        type: "wall.create.v1",
        wall: {
          alignment: "centre",
          baseOffsetMm: unknownValue("not-provided"),
          elementType: "wall",
          heightMm:
            correction?.heightMillimetres !== undefined
              ? knownValue(correction.heightMillimetres, attribution)
              : candidate.heightMillimetres !== undefined
                ? knownValue(candidate.heightMillimetres, attribution)
                : unknownValue("not-provided"),
          id: candidate.candidateId,
          levelId: candidate.levelCandidateId,
          name: knownValue(`Wall ${candidate.candidateId.slice(0, 8)}`, attribution),
          origin: attribution,
          path: knownValue(
            [
              sourcePointToMillimetres(points.start, calibration),
              sourcePointToMillimetres(points.end, calibration),
            ],
            attribution,
          ),
          thicknessMm:
            correction?.thicknessMillimetres !== undefined
              ? knownValue(correction.thicknessMillimetres, attribution)
              : candidate.thicknessMillimetres !== undefined
                ? knownValue(candidate.thicknessMillimetres, attribution)
                : unknownValue("not-provided"),
        },
      };
    } else if (candidate.kind === "opening") {
      const correction =
        review.decision === "corrected"
          ? (review.correction as OpeningCorrection | undefined)
          : undefined;
      const hostWallId = correction?.hostWallCandidateId ?? candidate.hostWallCandidateId;
      const host = candidatesById.get(hostWallId);
      if (!host || host.kind !== "wall")
        throw new Error("An opening must retain a valid host wall.");
      const sourceWidth = distanceMillimetres(candidate.start, candidate.end, calibration);
      const sourceOffset = openingOffsetAlongHostMillimetres(
        host.start,
        host.end,
        candidate.start,
        candidate.end,
        calibration,
      );
      const sourceHeight =
        candidate.headHeightMillimetres !== undefined &&
        candidate.sillHeightMillimetres !== undefined
          ? candidate.headHeightMillimetres - candidate.sillHeightMillimetres
          : undefined;
      operation = {
        clientOperationId,
        opening: {
          elementType: "opening",
          heightMm:
            correction?.heightMillimetres !== undefined
              ? knownValue(correction.heightMillimetres, attribution)
              : sourceHeight !== undefined && sourceHeight > 0
                ? knownValue(sourceHeight, attribution)
                : unknownValue("not-provided"),
          hostWallId,
          id: candidate.candidateId,
          kind: (() => {
            const kind = correction?.openingKind ?? candidate.openingKind;
            return kind === "unknown" ? "opening" : kind;
          })(),
          name: knownValue(`Opening ${candidate.candidateId.slice(0, 8)}`, attribution),
          offsetAlongHostMm: knownValue(
            correction?.offsetAlongHostMillimetres ?? sourceOffset,
            attribution,
          ),
          origin: attribution,
          sillHeightMm:
            correction?.sillHeightMillimetres !== undefined
              ? knownValue(correction.sillHeightMillimetres, attribution)
              : candidate.sillHeightMillimetres !== undefined
                ? knownValue(candidate.sillHeightMillimetres, attribution)
                : unknownValue("not-provided"),
          swing: unknownValue("not-observed"),
          widthMm: knownValue(correction?.widthMillimetres ?? sourceWidth, attribution),
        },
        reason,
        schemaVersion: "c5-model-operation-v1",
        type: "opening.insert.v1",
      };
    } else {
      const correction =
        review.decision === "corrected"
          ? (review.correction as SpaceCorrection | undefined)
          : undefined;
      const boundaryIds =
        correction?.boundaryWallCandidateIds ?? candidate.boundaryWallCandidateIds;
      const boundaryWalls = boundaryIds.map((wallId) => {
        const wall = candidatesById.get(wallId);
        if (!wall || wall.kind !== "wall") {
          throw new Error("A space boundary must reference only proposal wall candidates.");
        }
        return corrected
          ? acceptedWallPoints(wall, reviews[wall.candidateId] ?? defaultReview(wall))
          : { end: wall.end, start: wall.start };
      });
      const boundary = orderedWallBoundary(boundaryWalls).map((point) =>
        sourcePointToMillimetres(point, calibration),
      );
      operation = {
        clientOperationId,
        reason,
        schemaVersion: "c5-model-operation-v1",
        space: {
          boundary: knownValue(boundary, attribution),
          boundedByElementIds: [...boundaryIds],
          classification: unknownValue("not-provided"),
          elementType: "space",
          id: candidate.candidateId,
          levelId: candidate.levelCandidateId,
          name: knownValue(correction?.name ?? candidate.suggestedName, attribution),
          origin: attribution,
        },
        type: "space.create.v1",
      };
    }
    operationsByCandidate.set(candidate.candidateId, modelOperationRequestSchema.parse(operation));
  }

  const operations = ordered.flatMap((candidate) => {
    const operation = operationsByCandidate.get(candidate.candidateId);
    return operation ? [operation] : [];
  });
  const decisions = proposal.candidates.map((candidate) => {
    const review = reviews[candidate.candidateId] ?? defaultReview(candidate);
    const operation = operationsByCandidate.get(candidate.candidateId);
    return {
      candidateId: candidate.candidateId,
      decision: review.decision,
      resultingClientOperationIds: operation ? [operation.clientOperationId] : [],
    } satisfies PlanCandidateDecision;
  });
  return { decisions, operations };
}
