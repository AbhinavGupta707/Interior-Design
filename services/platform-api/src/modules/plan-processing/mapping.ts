import {
  c6PlanPolicy,
  type ModelOperationRequest,
  type PlanCalibration,
  type PlanCandidate,
  type PlanOperationDraft,
  type PlanProposal,
} from "@interior-design/contracts";
import { reduceModelOperations } from "@interior-design/model-operations";

import { transformSourcePoint } from "./calibration.js";
import { invalidPlanDraft } from "./errors.js";
import type { BranchTarget } from "./types.js";

type DraftRequest = Pick<
  PlanOperationDraft,
  "acknowledgedFindingCodes" | "decisions" | "operations" | "target"
>;

function samePoint(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): boolean {
  return left.x === right.x && left.y === right.y;
}

function assertSourceDerived(value: unknown, assetId: string): void {
  if (typeof value !== "object" || value === null) {
    throw invalidPlanDraft("Accepted plan geometry must retain source-derived provenance.");
  }
  const candidate = value as {
    readonly evidenceIds?: unknown;
    readonly method?: { readonly kind?: unknown };
    readonly state?: unknown;
    readonly verification?: { readonly status?: unknown };
  };
  if (
    candidate.state !== "source-derived" ||
    candidate.method?.kind !== "plan-import" ||
    candidate.verification?.status !== "not-reviewed" ||
    !Array.isArray(candidate.evidenceIds) ||
    !candidate.evidenceIds.includes(assetId)
  ) {
    throw invalidPlanDraft(
      "Accepted plan geometry must be unreviewed source-derived data linked to the exact asset.",
    );
  }
}

function assertElementIdentity(
  element: { readonly id: string; readonly origin: unknown },
  candidate: PlanCandidate,
): void {
  if (element.id !== candidate.candidateId) {
    throw invalidPlanDraft(
      "A candidate operation must retain the candidate UUID as its canonical element UUID.",
    );
  }
}

function assertAcceptedElementCore(
  element: { readonly id: string; readonly origin: unknown },
  candidate: PlanCandidate,
  proposal: PlanProposal,
): void {
  assertElementIdentity(element, candidate);
  assertSourceDerived(element.origin, proposal.source.assetId);
}

function assertCorrectedElementCore(
  element: { readonly id: string; readonly origin: unknown },
  candidate: PlanCandidate,
  proposal: PlanProposal,
  actorUserId: string,
): void {
  assertElementIdentity(element, candidate);
  if (typeof element.origin !== "object" || element.origin === null) {
    throw invalidPlanDraft("Corrected plan geometry must retain user-attributed provenance.");
  }
  const origin = element.origin as {
    readonly actorUserId?: unknown;
    readonly evidenceIds?: unknown;
    readonly method?: { readonly kind?: unknown };
    readonly state?: unknown;
    readonly verification?: { readonly status?: unknown };
  };
  if (
    origin.state !== "user-asserted" ||
    origin.actorUserId !== actorUserId ||
    origin.method?.kind !== "manual" ||
    origin.verification?.status !== "not-reviewed" ||
    !Array.isArray(origin.evidenceIds) ||
    !origin.evidenceIds.includes(proposal.source.assetId)
  ) {
    throw invalidPlanDraft(
      "Corrected plan geometry must be an unreviewed assertion by the current user and remain linked to the exact asset.",
    );
  }
  for (const value of Object.values(element)) {
    if (
      typeof value === "object" &&
      value !== null &&
      "knowledge" in value &&
      (value as { readonly knowledge?: unknown }).knowledge === "known"
    ) {
      const attribution = (value as { readonly attribution?: unknown }).attribution;
      if (JSON.stringify(attribution) !== JSON.stringify(element.origin)) {
        throw invalidPlanDraft(
          "Every known corrected field must retain the corrected element's user attribution.",
        );
      }
    }
  }
}

function assertAttributedKnown(
  value: unknown,
  expected: unknown,
  assetId: string,
  label: string,
): void {
  if (typeof value !== "object" || value === null)
    throw invalidPlanDraft(`${label} must be known.`);
  const attributed = value as {
    readonly attribution?: unknown;
    readonly knowledge?: unknown;
    readonly value?: unknown;
  };
  if (
    attributed.knowledge !== "known" ||
    JSON.stringify(attributed.value) !== JSON.stringify(expected)
  ) {
    throw invalidPlanDraft(`${label} does not match the calibrated parser candidate.`);
  }
  assertSourceDerived(attributed.attribution, assetId);
}

function assertAttributedUnknown(value: unknown, label: string): void {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { readonly knowledge?: unknown }).knowledge !== "unknown"
  ) {
    throw invalidPlanDraft(
      `${label} was not supplied by the parser and must remain explicitly unknown.`,
    );
  }
}

function candidateOperationType(candidate: PlanCandidate): ModelOperationRequest["type"] {
  switch (candidate.kind) {
    case "level":
      return "level.create.v1";
    case "wall":
      return "wall.create.v1";
    case "opening":
      return "opening.insert.v1";
    case "space":
      return "space.create.v1";
  }
}

function orderedSpaceBoundary(
  candidate: Extract<PlanCandidate, { readonly kind: "space" }>,
  candidates: ReadonlyMap<string, PlanCandidate>,
): readonly { readonly x: number; readonly y: number }[] {
  const walls = candidate.boundaryWallCandidateIds.map((id) => {
    const wall = candidates.get(id);
    if (wall?.kind !== "wall" || wall.levelCandidateId !== candidate.levelCandidateId) {
      throw invalidPlanDraft("A space boundary must reference walls on its candidate level.");
    }
    return wall;
  });
  const first = walls[0];
  const second = walls[1];
  if (first === undefined || second === undefined)
    throw invalidPlanDraft("A space boundary is incomplete.");
  let currentStart = first.start;
  let currentEnd = first.end;
  if (!samePoint(currentEnd, second.start) && !samePoint(currentEnd, second.end)) {
    if (samePoint(currentStart, second.start) || samePoint(currentStart, second.end)) {
      [currentStart, currentEnd] = [currentEnd, currentStart];
    } else {
      throw invalidPlanDraft("A space boundary wall chain is disconnected.");
    }
  }
  const boundary = [currentStart];
  for (let index = 1; index < walls.length; index += 1) {
    const wall = walls[index];
    if (wall === undefined) throw invalidPlanDraft("A space boundary is incomplete.");
    if (samePoint(wall.start, currentEnd)) {
      boundary.push(wall.start);
      currentEnd = wall.end;
    } else if (samePoint(wall.end, currentEnd)) {
      boundary.push(wall.end);
      currentEnd = wall.start;
    } else {
      throw invalidPlanDraft("A space boundary wall chain is disconnected.");
    }
  }
  if (!samePoint(currentEnd, boundary[0] as { readonly x: number; readonly y: number })) {
    throw invalidPlanDraft("A space boundary wall chain must close exactly.");
  }
  return boundary;
}

function assertAcceptedOperation(
  candidate: PlanCandidate,
  operation: ModelOperationRequest,
  proposal: PlanProposal,
  calibration: PlanCalibration,
  candidates: ReadonlyMap<string, PlanCandidate>,
): void {
  const assetId = proposal.source.assetId;
  switch (candidate.kind) {
    case "level": {
      if (operation.type !== "level.create.v1")
        throw invalidPlanDraft("A level candidate must map to level.create.v1.");
      assertAcceptedElementCore(operation.level, candidate, proposal);
      assertAttributedKnown(
        operation.level.elevationMm,
        candidate.elevationMillimetres,
        assetId,
        "Level elevation",
      );
      assertAttributedKnown(operation.level.name, candidate.suggestedName, assetId, "Level name");
      assertAttributedUnknown(operation.level.storeyHeightMm, "Level storey height");
      return;
    }
    case "wall": {
      if (operation.type !== "wall.create.v1")
        throw invalidPlanDraft("A wall candidate must map to wall.create.v1.");
      assertAcceptedElementCore(operation.wall, candidate, proposal);
      if (
        operation.wall.levelId !== candidate.levelCandidateId ||
        operation.wall.alignment !== "centre"
      ) {
        throw invalidPlanDraft(
          "An accepted wall must retain its candidate level and centreline alignment.",
        );
      }
      assertAttributedKnown(
        operation.wall.path,
        [
          transformSourcePoint(candidate.start, calibration.sourceToModel),
          transformSourcePoint(candidate.end, calibration.sourceToModel),
        ],
        assetId,
        "Wall path",
      );
      if (candidate.heightMillimetres === undefined)
        assertAttributedUnknown(operation.wall.heightMm, "Wall height");
      else
        assertAttributedKnown(
          operation.wall.heightMm,
          candidate.heightMillimetres,
          assetId,
          "Wall height",
        );
      if (candidate.thicknessMillimetres === undefined)
        assertAttributedUnknown(operation.wall.thicknessMm, "Wall thickness");
      else
        assertAttributedKnown(
          operation.wall.thicknessMm,
          candidate.thicknessMillimetres,
          assetId,
          "Wall thickness",
        );
      assertAttributedUnknown(operation.wall.baseOffsetMm, "Wall base offset");
      return;
    }
    case "opening": {
      if (operation.type !== "opening.insert.v1")
        throw invalidPlanDraft("An opening candidate must map to opening.insert.v1.");
      assertAcceptedElementCore(operation.opening, candidate, proposal);
      if (
        operation.opening.hostWallId !== candidate.hostWallCandidateId ||
        operation.opening.kind !==
          (candidate.openingKind === "unknown" ? "opening" : candidate.openingKind)
      ) {
        throw invalidPlanDraft(
          "An accepted opening must retain its host wall and bounded opening kind.",
        );
      }
      const host = candidates.get(candidate.hostWallCandidateId);
      if (host?.kind !== "wall")
        throw invalidPlanDraft("An opening candidate has no valid host wall.");
      const hostStart = transformSourcePoint(host.start, calibration.sourceToModel);
      const hostEnd = transformSourcePoint(host.end, calibration.sourceToModel);
      const openingStart = transformSourcePoint(candidate.start, calibration.sourceToModel);
      const openingEnd = transformSourcePoint(candidate.end, calibration.sourceToModel);
      const width = Math.max(
        1,
        Math.round(
          Math.hypot(openingEnd.xMm - openingStart.xMm, openingEnd.yMm - openingStart.yMm),
        ),
      );
      const midpoint = {
        xMm: (openingStart.xMm + openingEnd.xMm) / 2,
        yMm: (openingStart.yMm + openingEnd.yMm) / 2,
      };
      const hostDx = hostEnd.xMm - hostStart.xMm;
      const hostDy = hostEnd.yMm - hostStart.yMm;
      const hostLength = Math.hypot(hostDx, hostDy);
      const offset = Math.max(
        1,
        Math.round(
          ((midpoint.xMm - hostStart.xMm) * hostDx + (midpoint.yMm - hostStart.yMm) * hostDy) /
            hostLength,
        ),
      );
      assertAttributedKnown(operation.opening.widthMm, width, assetId, "Opening width");
      assertAttributedKnown(
        operation.opening.offsetAlongHostMm,
        offset,
        assetId,
        "Opening host offset",
      );
      if (candidate.sillHeightMillimetres === undefined)
        assertAttributedUnknown(operation.opening.sillHeightMm, "Opening sill height");
      else
        assertAttributedKnown(
          operation.opening.sillHeightMm,
          candidate.sillHeightMillimetres,
          assetId,
          "Opening sill height",
        );
      if (
        candidate.headHeightMillimetres === undefined ||
        candidate.sillHeightMillimetres === undefined
      ) {
        assertAttributedUnknown(operation.opening.heightMm, "Opening height");
      } else {
        assertAttributedKnown(
          operation.opening.heightMm,
          candidate.headHeightMillimetres - candidate.sillHeightMillimetres,
          assetId,
          "Opening height",
        );
      }
      assertAttributedUnknown(operation.opening.swing, "Opening swing");
      return;
    }
    case "space": {
      if (operation.type !== "space.create.v1")
        throw invalidPlanDraft("A space candidate must map to space.create.v1.");
      assertAcceptedElementCore(operation.space, candidate, proposal);
      if (
        operation.space.levelId !== candidate.levelCandidateId ||
        JSON.stringify(operation.space.boundedByElementIds) !==
          JSON.stringify(candidate.boundaryWallCandidateIds)
      ) {
        throw invalidPlanDraft(
          "An accepted space must retain its candidate level and ordered boundary walls.",
        );
      }
      const expectedBoundary = orderedSpaceBoundary(candidate, candidates).map((point) =>
        transformSourcePoint(point, calibration.sourceToModel),
      );
      assertAttributedKnown(operation.space.boundary, expectedBoundary, assetId, "Space boundary");
      assertAttributedKnown(operation.space.name, candidate.suggestedName, assetId, "Space name");
      assertAttributedUnknown(operation.space.classification, "Space classification");
    }
  }
}

function assertCorrectedOperation(
  candidate: PlanCandidate,
  operation: ModelOperationRequest,
  proposal: PlanProposal,
  actorUserId: string,
): void {
  if (operation.type !== candidateOperationType(candidate)) {
    throw invalidPlanDraft(
      "A corrected candidate must use the corresponding C5 create operation type.",
    );
  }
  const element =
    operation.type === "level.create.v1"
      ? operation.level
      : operation.type === "wall.create.v1"
        ? operation.wall
        : operation.type === "opening.insert.v1"
          ? operation.opening
          : operation.type === "space.create.v1"
            ? operation.space
            : undefined;
  if (element === undefined)
    throw invalidPlanDraft("A corrected candidate has an unsupported operation type.");
  assertCorrectedElementCore(element, candidate, proposal, actorUserId);
}

export function validateOperationDraft(
  proposal: PlanProposal,
  calibration: PlanCalibration,
  request: DraftRequest,
  branchTarget: BranchTarget,
  actorUserId: string,
): void {
  if (
    proposal.unresolvedRegions.length > 0 ||
    proposal.findings.some(({ severity }) => severity === "error")
  ) {
    throw invalidPlanDraft(
      "Unresolved regions or severe parser findings must be corrected manually before a C5 draft can be created.",
    );
  }
  const warningCodes = new Set(
    proposal.findings.filter(({ severity }) => severity === "warning").map(({ code }) => code),
  );
  const acknowledged = new Set(request.acknowledgedFindingCodes);
  if ([...warningCodes].some((code) => !acknowledged.has(code))) {
    throw invalidPlanDraft("Every parser warning must be explicitly acknowledged.");
  }
  if (
    request.target.branchId !== branchTarget.branch.id ||
    request.target.profile !== branchTarget.branch.profile ||
    request.target.expectedRevision !== branchTarget.branch.revision ||
    request.target.expectedHeadSnapshotSha256 !== branchTarget.branch.headSnapshotSha256
  ) {
    throw invalidPlanDraft(
      "The operation draft target is stale or does not match the current C5 branch head.",
    );
  }
  const candidates = new Map(
    proposal.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  if (
    request.decisions.length !== candidates.size ||
    request.decisions.some(({ candidateId }) => !candidates.has(candidateId))
  ) {
    throw invalidPlanDraft(
      "A draft must retain exactly one decision for every proposal candidate.",
    );
  }
  const operations = new Map(
    request.operations.map((operation) => [operation.clientOperationId, operation]),
  );
  const assigned = new Set<string>();
  for (const decision of request.decisions) {
    const candidate = candidates.get(decision.candidateId);
    if (candidate === undefined)
      throw invalidPlanDraft("A decision references an unknown candidate.");
    if (
      candidate.confidence < c6PlanPolicy.minimumCandidateConfidence &&
      (decision.decision === "accepted" || decision.decision === "corrected")
    ) {
      throw invalidPlanDraft(
        "A low-confidence candidate must remain unresolved or be explicitly excluded.",
      );
    }
    for (const operationId of decision.resultingClientOperationIds) {
      const operation = operations.get(operationId);
      if (operation === undefined || assigned.has(operationId))
        throw invalidPlanDraft("Candidate-to-operation mappings must be complete and one-to-one.");
      assigned.add(operationId);
      if (decision.decision === "accepted")
        assertAcceptedOperation(candidate, operation, proposal, calibration, candidates);
      else if (decision.decision === "corrected")
        assertCorrectedOperation(candidate, operation, proposal, actorUserId);
    }
  }
  if (assigned.size !== request.operations.length)
    throw invalidPlanDraft(
      "Every C5 operation must be attributable to exactly one candidate decision.",
    );
  try {
    const reduced = reduceModelOperations(branchTarget.snapshot, request.operations);
    if (reduced.hasBlockingFindings)
      throw invalidPlanDraft(
        "The C5 operation sequence produces blocking canonical geometry findings.",
      );
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    throw invalidPlanDraft("The C5 operation sequence does not produce valid canonical topology.");
  }
}
