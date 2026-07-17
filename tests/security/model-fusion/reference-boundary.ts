import { createHash } from "node:crypto";

export type FusionRole = "editor" | "owner" | "viewer";
export type FusionPublicAction = "cancel" | "create" | "draft" | "read" | "retry" | "review";
export type FusionJobState =
  | "abstained"
  | "cancel-requested"
  | "cancelled"
  | "comparing"
  | "failed"
  | "fitting"
  | "proposed"
  | "queued"
  | "registering";

export interface ActorScope {
  readonly projectId: string;
  readonly role: FusionRole;
  readonly tenantId: string;
}

export interface FusionLease {
  readonly attempt: number;
  readonly epoch: number;
  readonly expiresAtMilliseconds: number;
  readonly tokenSha256: string;
  readonly workerIdSha256: string;
}

export interface FusionResource {
  readonly attempt: number;
  readonly cancelled: boolean;
  readonly jobId: string;
  readonly lease?: FusionLease;
  readonly projectId: string;
  readonly proposalVersion: number;
  readonly retryKeySha256?: string;
  readonly rightsActive: boolean;
  readonly state: FusionJobState;
  readonly tenantId: string;
  readonly version: number;
}

export interface LeaseClaim {
  readonly attempt: number;
  readonly epoch: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly version: number;
}

export interface ExpectedReferenceBundle {
  readonly baseSnapshotId: string;
  readonly baseSnapshotSha256: string;
  readonly modelId: string;
  readonly projectId: string;
  readonly sources: readonly {
    readonly modelId: string;
    readonly projectId: string;
    readonly referenceId: string;
    readonly referenceSha256: string;
    readonly sourceId: string;
  }[];
  readonly tenantId: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const safeCode = /^[A-Z][A-Z0-9_]{2,79}$/u;
const mutationRoles = new Set<FusionRole>(["editor", "owner"]);
const terminalStates = new Set<FusionJobState>(["abstained", "cancelled", "failed", "proposed"]);
const publicLocationKey =
  /(?:authorization|command|executable|file|flag|objectkey|path|secret|shell|signed|token|uri|url)/iu;
const publicLocationValue =
  /(?:^\/|\.\.[\\/]|[A-Za-z]:[\\/]|file:\/\/|https?:\/\/|\$\(|`|;|&&|\|\|)/u;

export function authorize(
  actor: ActorScope,
  resource: FusionResource,
  action: FusionPublicAction,
): void {
  if (actor.tenantId !== resource.tenantId || actor.projectId !== resource.projectId) {
    throw new Error("FUSION_NOT_FOUND");
  }
  if (action === "read") return;
  if (!mutationRoles.has(actor.role)) throw new Error("FUSION_FORBIDDEN");
  if (action === "cancel" && terminalStates.has(resource.state)) {
    throw new Error("FUSION_CANCEL_TERMINAL");
  }
  if (action === "retry" && !["abstained", "cancelled", "failed"].includes(resource.state)) {
    throw new Error("FUSION_RETRY_NOT_TERMINAL");
  }
  if ((action === "review" || action === "draft") && resource.state !== "proposed") {
    throw new Error("FUSION_PROPOSAL_NOT_READY");
  }
}

export function assertExactReferences(expected: ExpectedReferenceBundle, actual: unknown): void {
  const record = strictRecord(
    actual,
    ["baseSnapshotId", "baseSnapshotSha256", "modelId", "projectId", "sources", "tenantId"],
    "FUSION_REFERENCE_BUNDLE_INVALID",
  );
  for (const key of ["tenantId", "projectId", "modelId", "baseSnapshotId"] as const) {
    const actual = record[key];
    if (typeof actual !== "string" || actual !== expected[key] || !uuid.test(actual)) {
      throw new Error("FUSION_REFERENCE_SCOPE_MISMATCH");
    }
  }
  const actualSnapshotSha256 = record.baseSnapshotSha256;
  if (
    typeof actualSnapshotSha256 !== "string" ||
    actualSnapshotSha256 !== expected.baseSnapshotSha256 ||
    !sha256.test(actualSnapshotSha256)
  ) {
    throw new Error("FUSION_REFERENCE_HASH_MISMATCH");
  }
  if (!Array.isArray(record.sources) || record.sources.length !== expected.sources.length) {
    throw new Error("FUSION_REFERENCE_SOURCE_SET_MISMATCH");
  }
  const expectedById = new Map(expected.sources.map((source) => [source.sourceId, source]));
  const seen = new Set<string>();
  for (const value of record.sources) {
    const source = strictRecord(
      value,
      ["modelId", "projectId", "referenceId", "referenceSha256", "sourceId"],
      "FUSION_REFERENCE_SOURCE_INVALID",
    );
    const sourceId = String(source.sourceId);
    const exact = expectedById.get(sourceId);
    if (exact === undefined || seen.has(sourceId)) {
      throw new Error("FUSION_REFERENCE_SOURCE_SET_MISMATCH");
    }
    seen.add(sourceId);
    if (
      source.modelId !== exact.modelId ||
      source.projectId !== exact.projectId ||
      source.referenceId !== exact.referenceId
    ) {
      throw new Error("FUSION_REFERENCE_SCOPE_MISMATCH");
    }
    const actualReferenceSha256 = source.referenceSha256;
    if (
      typeof actualReferenceSha256 !== "string" ||
      actualReferenceSha256 !== exact.referenceSha256 ||
      !sha256.test(actualReferenceSha256)
    ) {
      throw new Error("FUSION_REFERENCE_HASH_MISMATCH");
    }
  }
}

export function assertRights(value: unknown): void {
  const rights = strictRecord(
    value,
    ["serviceProcessingConsent", "trainingUseConsent"],
    "FUSION_RIGHTS_DENIED",
  );
  if (rights.serviceProcessingConsent !== true || rights.trainingUseConsent !== "denied") {
    throw new Error("FUSION_RIGHTS_DENIED");
  }
}

export function assertBoundedFusionRequest(value: unknown): void {
  visitPublicValue(value, 0, { nodes: 0 });
  const request = requireRecord(value, "FUSION_REQUEST_INVALID");
  if (
    !Array.isArray(request.sources) ||
    request.sources.length < 2 ||
    request.sources.length > 32
  ) {
    throw new Error("FUSION_SOURCE_BUDGET_EXCEEDED");
  }
  const kinds = new Set<string>();
  const references = new Set<string>();
  for (const sourceValue of request.sources) {
    const source = requireRecord(sourceValue, "FUSION_SOURCE_INVALID");
    assertRights(source.rights);
    if (!uuid.test(String(source.id)) || !uuid.test(String(source.referenceId))) {
      throw new Error("FUSION_SOURCE_REFERENCE_INVALID");
    }
    if (!sha256.test(String(source.sha256))) throw new Error("FUSION_SOURCE_HASH_INVALID");
    if (
      !Number.isSafeInteger(source.elementCount) ||
      Number(source.elementCount) < 0 ||
      Number(source.elementCount) > 100_000
    ) {
      throw new Error("FUSION_SOURCE_BUDGET_EXCEEDED");
    }
    kinds.add(String(source.kind));
    const reference = `${String(source.kind)}:${String(source.referenceId)}`;
    if (references.has(reference)) throw new Error("FUSION_DUPLICATE_SOURCE_REFERENCE");
    references.add(reference);
  }
  if (kinds.size < 2) throw new Error("FUSION_SOURCE_KINDS_INSUFFICIENT");
  if (!Array.isArray(request.anchorGroups) || request.anchorGroups.length > 32) {
    throw new Error("FUSION_ANCHOR_BUDGET_EXCEEDED");
  }
  for (const groupValue of request.anchorGroups) {
    const group = requireRecord(groupValue, "FUSION_ANCHOR_GROUP_INVALID");
    if (!Array.isArray(group.anchors) || group.anchors.length < 3 || group.anchors.length > 256) {
      throw new Error("FUSION_ANCHOR_BUDGET_EXCEEDED");
    }
    for (const anchorValue of group.anchors) {
      const anchor = requireRecord(anchorValue, "FUSION_ANCHOR_INVALID");
      assertPoint(anchor.projectPoint, "FUSION_ANCHOR_POINT_INVALID");
      assertPoint(anchor.sourcePoint, "FUSION_ANCHOR_POINT_INVALID");
    }
  }
}

export function assertSimilaritySafety(value: unknown): void {
  const input = strictRecord(
    value,
    ["anchors", "determinantPartsPerMillion"],
    "FUSION_SIMILARITY_INPUT_INVALID",
  );
  if (
    !Number.isSafeInteger(input.determinantPartsPerMillion) ||
    Number(input.determinantPartsPerMillion) <= 0
  ) {
    throw new Error("FUSION_REFLECTION_REJECTED");
  }
  if (!Array.isArray(input.anchors) || input.anchors.length < 3 || input.anchors.length > 256) {
    throw new Error("FUSION_DEGENERATE_ANCHORS");
  }
  const points = input.anchors.map((anchor) => assertPoint(anchor, "FUSION_ANCHOR_POINT_INVALID"));
  const origin = points[0];
  if (origin === undefined) throw new Error("FUSION_DEGENERATE_ANCHORS");
  for (let firstIndex = 1; firstIndex < points.length - 1; firstIndex += 1) {
    const first = points[firstIndex];
    if (first === undefined) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      const second = points[secondIndex];
      if (second === undefined) continue;
      if (crossProductMagnitudeSquared(origin, first, second) > 0n) return;
    }
  }
  throw new Error("FUSION_DEGENERATE_ANCHORS");
}

export function assertOperationDraftOnly(value: unknown): void {
  const draft = strictRecord(
    value,
    [
      "baseSnapshot",
      "branchId",
      "decisionIds",
      "expectedBranchRevision",
      "expectedHeadSnapshotSha256",
      "operations",
      "projectId",
      "proposalId",
      "schemaVersion",
    ],
    "FUSION_DRAFT_INVALID",
  );
  if (
    draft.schemaVersion !== "c9-operation-draft-v1" ||
    !uuid.test(String(draft.branchId)) ||
    !uuid.test(String(draft.projectId)) ||
    !uuid.test(String(draft.proposalId)) ||
    !sha256.test(String(draft.expectedHeadSnapshotSha256)) ||
    !Number.isSafeInteger(draft.expectedBranchRevision) ||
    Number(draft.expectedBranchRevision) < 0 ||
    !Array.isArray(draft.decisionIds) ||
    draft.decisionIds.length < 1 ||
    draft.decisionIds.length > 50 ||
    !Array.isArray(draft.operations) ||
    draft.operations.length < 1 ||
    draft.operations.length > 50
  ) {
    throw new Error("FUSION_DRAFT_INVALID");
  }
  assertSha256Record(draft.baseSnapshot, "FUSION_DRAFT_BASE_INVALID");
  rejectMutationAuthority(draft.operations);
}

export function assertZeroCanonicalMutation(input: {
  readonly afterBranchRevision: number;
  readonly afterSnapshotSha256: string;
  readonly beforeBranchRevision: number;
  readonly beforeSnapshotSha256: string;
}): void {
  if (
    input.beforeBranchRevision !== input.afterBranchRevision ||
    input.beforeSnapshotSha256 !== input.afterSnapshotSha256
  ) {
    throw new Error("FUSION_CANONICAL_MUTATION_DETECTED");
  }
}

export function claimLease(
  resource: FusionResource,
  input: {
    readonly leaseToken: string;
    readonly nowMilliseconds: number;
    readonly ttlMilliseconds: number;
    readonly workerId: string;
  },
): FusionResource {
  assertResourceIntegers(resource);
  if (
    resource.cancelled ||
    !resource.rightsActive ||
    terminalStates.has(resource.state) ||
    input.ttlMilliseconds < 1 ||
    input.ttlMilliseconds > 300_000 ||
    !Number.isSafeInteger(input.nowMilliseconds) ||
    !Number.isSafeInteger(input.ttlMilliseconds)
  ) {
    throw new Error("FUSION_LEASE_DENIED");
  }
  if (
    resource.lease !== undefined &&
    resource.lease.expiresAtMilliseconds > input.nowMilliseconds
  ) {
    throw new Error("FUSION_LEASE_HELD");
  }
  const epoch = (resource.lease?.epoch ?? 0) + 1;
  return Object.freeze({
    ...resource,
    lease: Object.freeze({
      attempt: resource.attempt,
      epoch,
      expiresAtMilliseconds: input.nowMilliseconds + input.ttlMilliseconds,
      tokenSha256: digest(input.leaseToken),
      workerIdSha256: digest(input.workerId),
    }),
    version: resource.version + 1,
  });
}

export function assertPublicationFence(
  resource: FusionResource,
  claim: LeaseClaim,
  nowMilliseconds: number,
): void {
  const lease = resource.lease;
  if (
    lease === undefined ||
    resource.tenantId !== claim.tenantId ||
    resource.projectId !== claim.projectId ||
    resource.jobId !== claim.jobId ||
    resource.attempt !== claim.attempt ||
    resource.version !== claim.version ||
    lease.attempt !== claim.attempt ||
    lease.epoch !== claim.epoch ||
    lease.tokenSha256 !== digest(claim.leaseToken) ||
    lease.expiresAtMilliseconds <= nowMilliseconds ||
    resource.cancelled ||
    !resource.rightsActive ||
    terminalStates.has(resource.state)
  ) {
    throw new Error("FUSION_STALE_PUBLICATION");
  }
}

export function cancelResource(resource: FusionResource): FusionResource {
  if (terminalStates.has(resource.state)) throw new Error("FUSION_CANCEL_TERMINAL");
  const withoutLease = removeLease(resource);
  return Object.freeze({
    ...withoutLease,
    cancelled: true,
    state: "cancelled",
    version: resource.version + 1,
  });
}

export function retryResource(
  resource: FusionResource,
  input: {
    readonly expectedAttempt: number;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  },
): FusionResource {
  const retryKeySha256 = digest(input.idempotencyKey);
  if (resource.retryKeySha256 === retryKeySha256 && resource.state === "queued") return resource;
  if (
    !["abstained", "cancelled", "failed"].includes(resource.state) ||
    resource.attempt !== input.expectedAttempt ||
    resource.version !== input.expectedVersion ||
    resource.attempt >= 3 ||
    !/^[A-Za-z0-9._:-]{8,120}$/u.test(input.idempotencyKey)
  ) {
    throw new Error("FUSION_RETRY_FENCE_DENIED");
  }
  const withoutLease = removeLease(resource);
  return Object.freeze({
    ...withoutLease,
    attempt: resource.attempt + 1,
    cancelled: false,
    retryKeySha256,
    state: "queued",
    version: resource.version + 1,
  });
}

export function safeFusionLog(input: {
  readonly attempt: number;
  readonly eventCode: string;
  readonly jobId: string;
  readonly latencyMilliseconds: number;
  readonly projectId: string;
  readonly registeredSourceCount: number;
  readonly safeCode: string | null;
  readonly tenantId: string;
  readonly untrusted?: unknown;
}): Readonly<Record<string, number | string | null>> {
  return Object.freeze({
    attempt: boundedLogInteger(input.attempt),
    eventCode: safeCode.test(input.eventCode) ? input.eventCode : "UNSAFE_EVENT",
    jobIdSha256: digest(input.jobId),
    latencyMilliseconds: boundedLogInteger(input.latencyMilliseconds),
    projectIdSha256: digest(input.projectId),
    registeredSourceCount: boundedLogInteger(input.registeredSourceCount),
    safeCode:
      input.safeCode === null
        ? null
        : safeCode.test(input.safeCode)
          ? input.safeCode
          : "UNSAFE_ERROR",
    tenantIdSha256: digest(input.tenantId),
  });
}

function visitPublicValue(value: unknown, depth: number, budget: { nodes: number }): void {
  budget.nodes += 1;
  if (depth > 20 || budget.nodes > 50_000) throw new Error("FUSION_PAYLOAD_BUDGET_EXCEEDED");
  if (typeof value === "number") {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isFinite(value) ||
      Math.abs(value) > 1_000_000_000
    ) {
      throw new Error("FUSION_NON_FINITE_OR_OVERFLOW");
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > 10_000) throw new Error("FUSION_STRING_BUDGET_EXCEEDED");
    if (publicLocationValue.test(value)) throw new Error("FUSION_PUBLIC_LOCATION_DENIED");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error("FUSION_ARRAY_BUDGET_EXCEEDED");
    for (const child of value) visitPublicValue(child, depth + 1, budget);
    return;
  }
  if (!isRecord(value)) throw new Error("FUSION_PAYLOAD_VALUE_INVALID");
  for (const [key, child] of Object.entries(value)) {
    if (publicLocationKey.test(key)) throw new Error("FUSION_PUBLIC_LOCATION_FIELD_DENIED");
    visitPublicValue(child, depth + 1, budget);
  }
}

function rejectMutationAuthority(operations: readonly unknown[]): void {
  const forbiddenKey =
    /(?:advanceBranch|canonicalSnapshot|commit|committedSnapshot|directMutation|preview|writeSnapshot)/u;
  const forbiddenValue = /(?:\/commit|\/preview|model-operations\/commit|snapshot\.write)/u;
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (forbiddenValue.test(value)) throw new Error("FUSION_DIRECT_MUTATION_DENIED");
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) throw new Error("FUSION_DIRECT_MUTATION_DENIED");
      visit(child);
    }
  };
  for (const operation of operations) visit(operation);
}

function assertSha256Record(value: unknown, code: string): void {
  const record = requireRecord(value, code);
  if (
    !uuid.test(String(record.modelId)) ||
    !uuid.test(String(record.snapshotId)) ||
    record.profile !== "existing" ||
    !sha256.test(String(record.snapshotSha256))
  ) {
    throw new Error(code);
  }
}

function assertPoint(
  value: unknown,
  code: string,
): { readonly xMm: number; readonly yMm: number; readonly zMm: number } {
  const point = strictRecord(value, ["xMm", "yMm", "zMm"], code);
  const coordinates = [point.xMm, point.yMm, point.zMm];
  if (
    coordinates.some(
      (coordinate) =>
        !Number.isSafeInteger(coordinate) || Math.abs(Number(coordinate)) > 10_000_000,
    )
  ) {
    throw new Error(code);
  }
  return { xMm: Number(point.xMm), yMm: Number(point.yMm), zMm: Number(point.zMm) };
}

function crossProductMagnitudeSquared(
  origin: { readonly xMm: number; readonly yMm: number; readonly zMm: number },
  first: { readonly xMm: number; readonly yMm: number; readonly zMm: number },
  second: { readonly xMm: number; readonly yMm: number; readonly zMm: number },
): bigint {
  const ax = BigInt(first.xMm - origin.xMm);
  const ay = BigInt(first.yMm - origin.yMm);
  const az = BigInt(first.zMm - origin.zMm);
  const bx = BigInt(second.xMm - origin.xMm);
  const by = BigInt(second.yMm - origin.yMm);
  const bz = BigInt(second.zMm - origin.zMm);
  const x = ay * bz - az * by;
  const y = az * bx - ax * bz;
  const z = ax * by - ay * bx;
  return x * x + y * y + z * z;
}

function assertResourceIntegers(resource: FusionResource): void {
  if (
    !Number.isSafeInteger(resource.attempt) ||
    resource.attempt < 1 ||
    resource.attempt > 3 ||
    !Number.isSafeInteger(resource.version) ||
    resource.version < 1 ||
    !Number.isSafeInteger(resource.proposalVersion) ||
    resource.proposalVersion < 0
  ) {
    throw new Error("FUSION_RESOURCE_INVALID");
  }
}

function removeLease(resource: FusionResource): FusionResource {
  const copy = { ...resource };
  delete copy.lease;
  return copy;
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  code: string,
): Record<string, unknown> {
  const record = requireRecord(value, code);
  const actual = Object.keys(record).sort();
  const allowed = [...allowedKeys].sort();
  if (actual.join("|") !== allowed.join("|")) throw new Error(code);
  return record;
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedLogInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : 0;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
