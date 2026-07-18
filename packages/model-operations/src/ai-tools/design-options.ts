import {
  designOptionSchema,
  designOptionSetSchema,
  optionOperationBundleSchema,
  type CanonicalHomeSnapshot,
  type DesignConstraint,
  type DesignOption,
  type DesignOptionSet,
  type ModelSnapshotRecord,
  type OptionOperationBundle,
  type OptionWorkingModelReference,
} from "@interior-design/contracts";
import { canonicalizeIJson } from "@interior-design/domain-model";
import { createHash } from "node:crypto";

import { ModelOperationError } from "../errors.js";
import { reduceModelOperations, validateAndCanonicalizeSnapshot } from "../reducer.js";

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeIJson(value), "utf8").digest("hex");
}

export function designConstraintSetSha256(constraints: readonly DesignConstraint[]): string {
  return sha256([...constraints].sort((left, right) => left.id.localeCompare(right.id)));
}

export function optionBundleSha256(bundle: Omit<OptionOperationBundle, "bundleSha256">): string {
  return sha256(bundle);
}

export function optionSetSha256(optionSet: Omit<DesignOptionSet, "setSha256">): string {
  return sha256(optionSet);
}

export function deriveProposedWorkingSnapshot(source: ModelSnapshotRecord): {
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
} {
  const snapshot: CanonicalHomeSnapshot =
    source.profile === "proposed"
      ? source.snapshot
      : {
          ...source.snapshot,
          derivedFromSnapshotSha256: source.snapshotSha256,
          profile: "proposed",
        };
  const canonical = validateAndCanonicalizeSnapshot(snapshot);
  if (canonical.hasBlockingFindings) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The exact C12 working clone contains blocking geometry findings.",
    );
  }
  return { snapshot: canonical.snapshot, snapshotSha256: canonical.snapshotSha256 };
}

export interface ValidatePublishedOptionSetInput {
  readonly constraints: readonly DesignConstraint[];
  readonly expectedOptionCount: number;
  readonly jobId: string;
  readonly optionSet: DesignOptionSet;
  readonly options: readonly DesignOption[];
  readonly projectId: string;
  readonly workingModel: OptionWorkingModelReference;
  readonly workingSnapshot: CanonicalHomeSnapshot;
}

export function validatePublishedOptionSet(input: ValidatePublishedOptionSetInput): {
  readonly optionSet: DesignOptionSet;
  readonly options: readonly DesignOption[];
} {
  const optionSet = designOptionSetSchema.parse(input.optionSet);
  const options = input.options.map((option) => designOptionSchema.parse(option));
  if (
    options.length !== input.expectedOptionCount ||
    optionSet.optionIds.length !== input.expectedOptionCount ||
    optionSet.jobId !== input.jobId ||
    optionSet.projectId !== input.projectId
  ) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The published C12 option set does not match its fenced job boundary.",
    );
  }
  const expectedIds = [...options.map(({ id }) => id)].sort();
  if (
    new Set(expectedIds).size !== expectedIds.length ||
    expectedIds.join(":") !== [...optionSet.optionIds].sort().join(":")
  ) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The published C12 option identifiers do not match the immutable option set.",
    );
  }
  const constraintStrengths = new Map(input.constraints.map(({ id, strength }) => [id, strength]));
  for (const option of options) {
    const bundle = optionOperationBundleSchema.parse(option.operationBundle);
    if (
      option.jobId !== input.jobId ||
      option.projectId !== input.projectId ||
      option.status !== "pending" ||
      bundle.baseModel.snapshotId !== input.workingModel.snapshotId ||
      bundle.baseModel.snapshotSha256 !== input.workingModel.snapshotSha256 ||
      bundle.baseModel.snapshotVersion !== input.workingModel.snapshotVersion ||
      bundle.baseModel.modelId !== input.workingModel.modelId
    ) {
      throw new ModelOperationError(
        "INVALID_OPERATION",
        "A C12 option does not retain the exact proposed working model.",
      );
    }
    const resultIds = new Set(bundle.constraintResults.map(({ constraintId }) => constraintId));
    if (
      resultIds.size !== constraintStrengths.size ||
      [...constraintStrengths].some(
        ([id, strength]) =>
          !bundle.constraintResults.some(
            (result) => result.constraintId === id && result.strength === strength,
          ),
      )
    ) {
      throw new ModelOperationError(
        "INVALID_OPERATION",
        "Every frozen constraint must have one matching result in each C12 option.",
      );
    }
    const { bundleSha256: retainedBundleSha256, ...bundleBody } = bundle;
    if (optionBundleSha256(bundleBody) !== retainedBundleSha256) {
      throw new ModelOperationError(
        "HISTORY_HASH_MISMATCH",
        "The retained C12 operation-bundle hash does not match its canonical payload.",
      );
    }
    const candidate = reduceModelOperations(input.workingSnapshot, bundle.operations);
    if (
      candidate.hasBlockingFindings ||
      candidate.snapshotSha256 !== bundle.candidateSnapshotSha256
    ) {
      throw new ModelOperationError(
        "HISTORY_HASH_MISMATCH",
        "The C12 candidate snapshot does not replay from the exact working model.",
      );
    }
  }
  const { setSha256: retainedSetSha256, ...setBody } = optionSet;
  if (optionSetSha256(setBody) !== retainedSetSha256) {
    throw new ModelOperationError(
      "HISTORY_HASH_MISMATCH",
      "The retained C12 option-set hash does not match its canonical payload.",
    );
  }
  return { optionSet, options: Object.freeze(options) };
}
