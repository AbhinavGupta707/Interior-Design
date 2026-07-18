import {
  designOptionSchema,
  designOptionSetSchema,
  optionOperationBundleSchema,
  type CanonicalHomeSnapshot,
  type DesignConstraint,
  type DesignOption,
  type DesignOptionSet,
  type OptionJob,
} from "@interior-design/contracts";
import { reduceModelOperations } from "@interior-design/model-operations";

import { invalidPublication } from "./errors.js";
import { bundleSha256, setSha256 } from "./hashes.js";

export function validateOptionPublication(input: {
  readonly constraints: readonly DesignConstraint[];
  readonly job: OptionJob;
  readonly optionSet: DesignOptionSet;
  readonly options: readonly DesignOption[];
  readonly workingSnapshot: CanonicalHomeSnapshot;
}): { readonly optionSet: DesignOptionSet; readonly options: readonly DesignOption[] } {
  const optionSet = designOptionSetSchema.parse(input.optionSet);
  const options = input.options.map((option) => designOptionSchema.parse(option));
  if (
    options.length !== input.job.requestedOptionCount ||
    optionSet.optionIds.length !== input.job.requestedOptionCount ||
    optionSet.jobId !== input.job.id ||
    optionSet.projectId !== input.job.projectId
  ) {
    throw invalidPublication("The option set does not match its fenced C12 job.");
  }
  const optionIds = options.map(({ id }) => id).sort();
  if (
    new Set(optionIds).size !== optionIds.length ||
    optionIds.join(":") !== [...optionSet.optionIds].sort().join(":")
  ) {
    throw invalidPublication("The immutable option set and option payload identifiers differ.");
  }
  const strengths = new Map(input.constraints.map(({ id, strength }) => [id, strength]));
  for (const option of options) {
    const bundle = optionOperationBundleSchema.parse(option.operationBundle);
    if (
      option.jobId !== input.job.id ||
      option.projectId !== input.job.projectId ||
      option.baseBrief.briefId !== input.job.baseBrief.briefId ||
      option.baseBrief.revision !== input.job.baseBrief.revision ||
      option.baseBrief.contentSha256 !== input.job.baseBrief.contentSha256 ||
      option.status !== "pending" ||
      bundle.baseModel.modelId !== input.job.workingModel.modelId ||
      bundle.baseModel.snapshotId !== input.job.workingModel.snapshotId ||
      bundle.baseModel.snapshotVersion !== input.job.workingModel.snapshotVersion ||
      bundle.baseModel.snapshotSha256 !== input.job.workingModel.snapshotSha256
    ) {
      throw invalidPublication("An option does not retain the exact brief and working-model pins.");
    }
    const results = new Map(
      bundle.constraintResults.map((result) => [result.constraintId, result]),
    );
    if (
      results.size !== strengths.size ||
      [...strengths].some(([id, strength]) => results.get(id)?.strength !== strength)
    ) {
      throw invalidPublication("Each option must retain one result for every frozen constraint.");
    }
    const { bundleSha256: retainedBundleSha256, ...bundleBody } = bundle;
    if (bundleSha256(bundleBody) !== retainedBundleSha256) {
      throw invalidPublication("The immutable operation-bundle hash does not match its payload.");
    }
    const candidate = reduceModelOperations(input.workingSnapshot, bundle.operations);
    if (
      candidate.hasBlockingFindings ||
      candidate.snapshotSha256 !== bundle.candidateSnapshotSha256
    ) {
      throw invalidPublication(
        "The candidate snapshot does not replay exactly from the working base.",
      );
    }
  }
  const { setSha256: retainedSetSha256, ...setBody } = optionSet;
  if (setSha256(setBody) !== retainedSetSha256) {
    throw invalidPublication("The immutable option-set hash does not match its payload.");
  }
  return { optionSet, options: Object.freeze(options) };
}
