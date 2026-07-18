import {
  c13SelectionBoardSchemaVersion,
  c13SpecificationRevisionSchemaVersion,
  selectionBoardSchema,
  specificationRevisionSchema,
  type C12ConfirmationSource,
  type SpecificationLine,
  type SpecificationRevision,
} from "@interior-design/contracts";

import { compareIdentifiers, specificationSha256 } from "./canonical.js";
import { SpecificationDomainError } from "./errors.js";
import { assertOneLinePerElement } from "./lines.js";

export interface SelectionBoardEntry {
  readonly assetVersionId: string;
  readonly elementId: string;
  readonly note: string;
  readonly state: SpecificationLine["decisionStatus"];
}

export interface BuildRevisionInput {
  readonly branchId: string;
  readonly branchRevision: number;
  readonly catalogReleaseId: string;
  readonly catalogReleaseSha256: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly lines: readonly SpecificationLine[];
  readonly modelSnapshotId: string;
  readonly modelSnapshotSha256: string;
  readonly revision: number;
  readonly sourceConfirmation: C12ConfirmationSource;
}

export function buildSpecificationRevision(input: BuildRevisionInput): SpecificationRevision {
  const lines = assertOneLinePerElement(input.lines);
  const body = {
    branchId: input.branchId,
    branchRevision: input.branchRevision,
    catalogReleaseId: input.catalogReleaseId,
    catalogReleaseSha256: input.catalogReleaseSha256,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    lines,
    modelSnapshotId: input.modelSnapshotId,
    modelSnapshotSha256: input.modelSnapshotSha256,
    revision: input.revision,
    schemaVersion: c13SpecificationRevisionSchemaVersion,
    sourceConfirmation: input.sourceConfirmation,
  } as const;
  return specificationRevisionSchema.parse({ ...body, revisionSha256: specificationSha256(body) });
}

export function verifySpecificationRevision(
  revisionInput: SpecificationRevision,
): SpecificationRevision {
  const revision = specificationRevisionSchema.parse(revisionInput);
  const { revisionSha256, ...body } = revision;
  if (specificationSha256(body) !== revisionSha256) {
    throw new SpecificationDomainError(
      "INVALID_REVISION",
      "The immutable specification revision hash does not match its exact canonical payload.",
    );
  }
  assertOneLinePerElement(revision.lines);
  return revision;
}

export function initialSelectionBoard(lines: readonly SpecificationLine[], revision: number) {
  return selectionBoardSchema.parse({
    entries: lines.map((line) => ({
      assetVersionId: line.assetVersionId,
      elementId: line.elementId,
      note: line.notes,
      state: line.decisionStatus,
    })),
    revision,
    schemaVersion: c13SelectionBoardSchemaVersion,
  });
}

export function applySelectionBoard(
  current: SpecificationRevision,
  entriesInput: readonly SelectionBoardEntry[],
  next: Omit<BuildRevisionInput, "lines" | "sourceConfirmation">,
): SpecificationRevision {
  verifySpecificationRevision(current);
  if (next.revision !== current.revision + 1) {
    throw new SpecificationDomainError(
      "INVALID_REVISION",
      "Revision heads advance by exactly one.",
    );
  }
  const entries = entriesInput.toSorted((left, right) =>
    compareIdentifiers(left.elementId, right.elementId),
  );
  if (new Set(entries.map(({ elementId }) => elementId)).size !== entries.length) {
    throw new SpecificationDomainError(
      "DUPLICATE_ELEMENT",
      "Selection-board elements must be unique.",
    );
  }
  const byElement = new Map(entries.map((entry) => [entry.elementId, entry]));
  const lines = current.lines.map((line) => {
    const entry = byElement.get(line.elementId);
    if (entry === undefined) return line;
    if (entry.assetVersionId !== line.assetVersionId) {
      throw new SpecificationDomainError(
        "LINE_SET_MISMATCH",
        "Selection-board edits cannot substitute catalog assets.",
      );
    }
    return { ...line, decisionStatus: entry.state, notes: entry.note };
  });
  if (
    [...byElement.keys()].some(
      (elementId) => !current.lines.some((line) => line.elementId === elementId),
    )
  ) {
    throw new SpecificationDomainError(
      "LINE_SET_MISMATCH",
      "The selection board references an unknown line.",
    );
  }
  return buildSpecificationRevision({
    ...next,
    lines,
    sourceConfirmation: current.sourceConfirmation,
  });
}
