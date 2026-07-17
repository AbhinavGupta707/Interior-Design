import {
  knownAttributionSchema,
  modelClaimIdSchema,
  modelVerificationSchema,
  provenanceStateSchema,
  unknownAttributionSchema,
} from "@interior-design/contracts";
import type { KnownAttribution, ProvenanceState } from "@interior-design/contracts";

export {
  knownAttributionSchema,
  modelVerificationSchema,
  provenanceKnownStateSchema,
  provenanceStateSchema,
  unknownAttributionSchema,
} from "@interior-design/contracts";

export type { KnownAttribution, ProvenanceState } from "@interior-design/contracts";

export type UnknownAttribution = ReturnType<typeof unknownAttributionSchema.parse>;
export type Attribution = KnownAttribution | UnknownAttribution;
export type ModelVerification = ReturnType<typeof modelVerificationSchema.parse>;
export type ReviewPurpose = Extract<
  ModelVerification,
  { readonly status: "reviewed-with-limitations" }
>["purpose"];
export type PurposeSpecificReview = Extract<
  ModelVerification,
  { readonly status: "reviewed-with-limitations" }
>;

export type ProvenanceInvariantCode =
  | "AMBIGUOUS_CLAIM_SELECTION"
  | "CLAIM_ID_REUSED"
  | "DUPLICATE_EVIDENCE_REFERENCE"
  | "INVALID_ATTRIBUTION"
  | "INVALID_CLAIM_ID"
  | "INVALID_VERIFICATION"
  | "MISSING_CLAIM_SELECTION"
  | "REVIEW_PURPOSE_MISMATCH";

export class ProvenanceInvariantError extends Error {
  readonly code: ProvenanceInvariantCode;

  constructor(code: ProvenanceInvariantCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProvenanceInvariantError";
    this.code = code;
  }
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => structurallyEqual(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort(compareCodeUnits);
  const rightKeys = Object.keys(right).sort(compareCodeUnits);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]),
    )
  );
}

function assertUniqueEvidenceReferences(attribution: Attribution): void {
  const uniqueIds = new Set(attribution.evidenceIds);
  if (uniqueIds.size !== attribution.evidenceIds.length) {
    throw new ProvenanceInvariantError(
      "DUPLICATE_EVIDENCE_REFERENCE",
      "Evidence references form a set and must not contain duplicate IDs.",
    );
  }
}

/**
 * Validates the frozen C4 known/unknown attribution union and the additional
 * reference-set uniqueness invariant owned by this package. The returned copy
 * is deeply frozen; the caller's input is never modified.
 */
export function parseAttribution(input: unknown): Attribution {
  if (!isRecord(input)) {
    throw new ProvenanceInvariantError(
      "INVALID_ATTRIBUTION",
      "Attribution must be a strict known or unknown attribution object.",
    );
  }

  const result =
    input.state === "unknown"
      ? unknownAttributionSchema.safeParse(input)
      : knownAttributionSchema.safeParse(input);
  if (!result.success) {
    throw new ProvenanceInvariantError(
      "INVALID_ATTRIBUTION",
      "Attribution violates the frozen C4 evidence, confidence, actor, or review contract.",
      { cause: result.error },
    );
  }

  const attribution: Attribution = result.data;
  assertUniqueEvidenceReferences(attribution);
  return deepFreeze(attribution);
}

export const assertAttributionInvariants = parseAttribution;

/** Returns a sorted immutable attribution for canonical reference ordering. */
export function normalizeAttributionReferences(input: unknown): Attribution {
  const attribution = parseAttribution(input);
  const evidenceIds = attribution.evidenceIds.toSorted(compareCodeUnits);
  const verification =
    attribution.verification.status === "reviewed-with-limitations"
      ? {
          ...attribution.verification,
          limitations: attribution.verification.limitations.toSorted(compareCodeUnits),
        }
      : attribution.verification;
  return deepFreeze({ ...attribution, evidenceIds, verification } as Attribution);
}

export function parseModelVerification(input: unknown): ModelVerification {
  const result = modelVerificationSchema.safeParse(input);
  if (!result.success) {
    throw new ProvenanceInvariantError(
      "INVALID_VERIFICATION",
      "Review must be not-reviewed or purpose-specific with reviewer, time, and limitations.",
      { cause: result.error },
    );
  }
  return deepFreeze(result.data);
}

/**
 * Review is deliberately queried for one declared purpose. There is no
 * purpose-free `verified` result in this API.
 */
export function isReviewedForPurpose(input: unknown, purpose: ReviewPurpose): boolean {
  const attribution = parseAttribution(input);
  return (
    attribution.verification.status === "reviewed-with-limitations" &&
    attribution.verification.purpose === purpose
  );
}

export function requireReviewForPurpose(
  input: unknown,
  purpose: ReviewPurpose,
): PurposeSpecificReview {
  const attribution = parseAttribution(input);
  if (
    attribution.verification.status !== "reviewed-with-limitations" ||
    attribution.verification.purpose !== purpose
  ) {
    throw new ProvenanceInvariantError(
      "REVIEW_PURPOSE_MISMATCH",
      `The attribution is not reviewed for the requested ${purpose} purpose.`,
    );
  }
  return attribution.verification;
}

/**
 * A claim ID identifies immutable claim content. Repeating an identical claim
 * is idempotent; changing state, method, sources, confidence, actor, or review
 * requires a fresh claim ID.
 */
export function transitionAttribution(current: unknown, next: unknown): Attribution {
  const currentAttribution = normalizeAttributionReferences(current);
  const nextAttribution = normalizeAttributionReferences(next);
  if (currentAttribution.claimId !== nextAttribution.claimId) return nextAttribution;
  if (structurallyEqual(currentAttribution, nextAttribution)) return currentAttribution;
  throw new ProvenanceInvariantError(
    "CLAIM_ID_REUSED",
    "A meaningful attribution transition requires a new immutable claim ID.",
  );
}

/**
 * Selects only an explicitly named claim. Confidence never acts as an implicit
 * winner and a missing or duplicate claim is an error rather than a fallback.
 */
export function selectAttributionByClaimId(
  candidates: readonly unknown[],
  claimId: string,
): Attribution {
  if (!modelClaimIdSchema.safeParse(claimId).success) {
    throw new ProvenanceInvariantError("INVALID_CLAIM_ID", "A valid claim UUID is required.");
  }
  const parsed = candidates.map((candidate) => parseAttribution(candidate));
  const selected = parsed.filter((candidate) => candidate.claimId === claimId);
  if (selected.length === 0) {
    throw new ProvenanceInvariantError(
      "MISSING_CLAIM_SELECTION",
      "The explicitly requested claim is not present.",
    );
  }
  if (selected.length !== 1) {
    throw new ProvenanceInvariantError(
      "AMBIGUOUS_CLAIM_SELECTION",
      "The explicitly requested claim is not unique.",
    );
  }
  return selected[0] as Attribution;
}

export function isKnownAttribution(attribution: Attribution): attribution is KnownAttribution {
  return attribution.state !== "unknown";
}

export function isUnknownAttribution(attribution: Attribution): attribution is UnknownAttribution {
  return attribution.state === "unknown";
}

export function isProvenanceState(value: unknown): value is ProvenanceState {
  return provenanceStateSchema.safeParse(value).success;
}
