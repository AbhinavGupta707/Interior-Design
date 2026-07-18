import type {
  DesignConstraint,
  DesignOptionSet,
  OptionOperationBundle,
} from "@interior-design/contracts";
import { canonicalizeIJson } from "@interior-design/domain-model";
import { createHash } from "node:crypto";

export function c12Sha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeIJson(value), "utf8").digest("hex");
}

export function constraintsSha256(constraints: readonly DesignConstraint[]): string {
  return c12Sha256([...constraints].sort((left, right) => left.id.localeCompare(right.id)));
}

export function bundleSha256(bundle: Omit<OptionOperationBundle, "bundleSha256">): string {
  return c12Sha256(bundle);
}

export function setSha256(optionSet: Omit<DesignOptionSet, "setSha256">): string {
  return c12Sha256(optionSet);
}
