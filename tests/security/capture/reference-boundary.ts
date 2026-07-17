import { createHash } from "node:crypto";

import { c7CapturePolicy, type CaptureArtifactKind } from "../../../packages/contracts/src/c7.js";

export type CaptureAction =
  "cancel" | "create-session" | "finalize" | "read-proposal" | "read-session" | "retry" | "upload";
export type CaptureRole = "editor" | "machine" | "owner" | "viewer";

export interface CaptureScope {
  readonly captureSessionId: string;
  readonly projectId: string;
  readonly tenantId: string;
}

export interface CaptureRequestContext {
  readonly action: CaptureAction;
  readonly authenticated: boolean;
  readonly bodyValid: boolean;
  readonly principalScope: CaptureScope;
  readonly resourceExists: boolean;
  readonly resourceScope: CaptureScope;
  readonly role: CaptureRole;
}

export interface BoundaryResponse {
  readonly code: "AUTHENTICATION_REQUIRED" | "FORBIDDEN" | "INVALID_REQUEST" | "NOT_FOUND" | "OK";
  readonly status: 200 | 400 | 401 | 403 | 404;
}

const mutationActions = new Set<CaptureAction>([
  "cancel",
  "create-session",
  "finalize",
  "retry",
  "upload",
]);

export function authorizeCaptureRequest(context: CaptureRequestContext): BoundaryResponse {
  if (!context.authenticated) return response(401, "AUTHENTICATION_REQUIRED");

  // Scope and existence are deliberately resolved before body validation or
  // role detail, so foreign callers cannot distinguish a real resource.
  if (!context.resourceExists || !sameScope(context.principalScope, context.resourceScope)) {
    return response(404, "NOT_FOUND");
  }
  if (!roleAllows(context.role, context.action)) return response(403, "FORBIDDEN");
  if (!context.bodyValid) return response(400, "INVALID_REQUEST");
  return response(200, "OK");
}

function roleAllows(role: CaptureRole, action: CaptureAction): boolean {
  if (role === "owner" || role === "editor") return true;
  if (role === "viewer") return !mutationActions.has(action);
  return action === "read-proposal" || action === "read-session";
}

function sameScope(left: CaptureScope, right: CaptureScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.captureSessionId === right.captureSessionId
  );
}

function response(
  status: BoundaryResponse["status"],
  code: BoundaryResponse["code"],
): BoundaryResponse {
  return Object.freeze({ code, status });
}

export function parseBoundedJSON(
  bytes: Uint8Array,
  options: {
    readonly maximumBytes: number;
    readonly maximumDepth: number;
    readonly maximumString: number;
  },
): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > options.maximumBytes) {
    throw new Error("JSON_SIZE_LIMIT");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("JSON_MALFORMED");
  }
  inspectJSON(value, 0, options);
  return value;
}

function inspectJSON(
  value: unknown,
  depth: number,
  options: { readonly maximumDepth: number; readonly maximumString: number },
): void {
  if (depth > options.maximumDepth) throw new Error("JSON_DEPTH_LIMIT");
  if (typeof value === "string") {
    if (value.length > options.maximumString) throw new Error("JSON_STRING_LIMIT");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON_NON_FINITE");
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) inspectJSON(entry, depth + 1, options);
    return;
  }
  if (typeof value !== "object") throw new Error("JSON_UNSUPPORTED_VALUE");
  for (const [key, entry] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("JSON_CONFUSING_KEY");
    }
    if (key.length > 120) throw new Error("JSON_KEY_LIMIT");
    inspectJSON(entry, depth + 1, options);
  }
}

export function validateGeneratedObjectKey(value: string, scope: CaptureScope): void {
  const expectedPrefix = `tenant/${scope.tenantId}/project/${scope.projectId}/capture/${scope.captureSessionId}/`;
  if (
    !value.startsWith(expectedPrefix) ||
    value.length > 512 ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("\\") ||
    /[?#%\p{Cc}]/u.test(value)
  ) {
    throw new Error("OBJECT_KEY_REJECTED");
  }
  const suffix = value.slice(expectedPrefix.length);
  if (!/^[a-f0-9]{64}\/(source|derived)$/u.test(suffix)) {
    throw new Error("OBJECT_KEY_REJECTED");
  }
}

export function validateSignedPartURL(
  value: string,
  allowedHost: string,
  nowMilliseconds: number,
  expiresAt: string,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SIGNED_URL_REJECTED");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.hostname !== allowedHost ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    Date.parse(expiresAt) <= nowMilliseconds
  ) {
    throw new Error(
      Date.parse(expiresAt) <= nowMilliseconds ? "SIGNED_URL_EXPIRED" : "SIGNED_URL_REJECTED",
    );
  }
}

export interface CaptureArtifactDescriptor {
  readonly artifactId: string;
  readonly byteSize: number;
  readonly contentType: "application/json" | "model/vnd.usdz+zip";
  readonly kind: CaptureArtifactKind;
  readonly sha256: string;
}

export function inspectBoundArtifact(
  expected: CaptureArtifactDescriptor,
  claimed: CaptureArtifactDescriptor,
  bytes: Uint8Array,
): void {
  if (
    expected.artifactId !== claimed.artifactId ||
    expected.byteSize !== claimed.byteSize ||
    expected.contentType !== claimed.contentType ||
    expected.kind !== claimed.kind ||
    expected.sha256 !== claimed.sha256
  ) {
    throw new Error("ARTIFACT_SUBSTITUTION");
  }
  if (bytes.byteLength !== expected.byteSize) throw new Error("ARTIFACT_BYTE_MISMATCH");
  const observedSha256 = createHash("sha256").update(bytes).digest("hex");
  if (observedSha256 !== expected.sha256) throw new Error("ARTIFACT_HASH_MISMATCH");

  if (expected.contentType === "model/vnd.usdz+zip") {
    if (
      bytes.length < 4 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      bytes[2] !== 0x03 ||
      bytes[3] !== 0x04
    ) {
      throw new Error("MEDIA_SIGNATURE_MISMATCH");
    }
    return;
  }
  const text = new TextDecoder("utf8", { fatal: true }).decode(bytes).trimStart();
  if (!text.startsWith("{")) throw new Error("MEDIA_SIGNATURE_MISMATCH");
  parseBoundedJSON(bytes, {
    maximumBytes: c7CapturePolicy.maximumArtifactBytes,
    maximumDepth: 64,
    maximumString: 1_000_000,
  });
}

export interface CompletedPart {
  readonly checksumSha256: string;
  readonly partNumber: number;
  readonly uploadSessionId: string;
}

export class ReferenceMultipartLedger {
  readonly #parts = new Map<number, string>();
  readonly #uploadSessionId: string;
  #state: "completed" | "uploading" = "uploading";
  #completionFingerprint?: string;

  constructor(uploadSessionId: string) {
    this.#uploadSessionId = uploadSessionId;
  }

  get state(): "completed" | "uploading" {
    return this.#state;
  }

  record(
    part: CompletedPart,
    signedExpiresAt: string,
    nowMilliseconds: number,
  ): "accepted" | "replayed" {
    if (this.#state === "completed") throw new Error("UPLOAD_TERMINAL");
    if (part.uploadSessionId !== this.#uploadSessionId) throw new Error("UPLOAD_SESSION_MISMATCH");
    if (Date.parse(signedExpiresAt) <= nowMilliseconds) throw new Error("SIGNED_URL_EXPIRED");
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > 10_000) {
      throw new Error("PART_NUMBER_REJECTED");
    }
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(part.checksumSha256))
      throw new Error("PART_CHECKSUM_REJECTED");
    const previous = this.#parts.get(part.partNumber);
    if (previous !== undefined) {
      if (previous === part.checksumSha256) return "replayed";
      throw new Error("PART_REPLAY_CONFLICT");
    }
    this.#parts.set(part.partNumber, part.checksumSha256);
    return "accepted";
  }

  complete(
    parts: readonly CompletedPart[],
    simulateInterruption = false,
  ): "completed" | "replayed" {
    const fingerprint = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    if (this.#state === "completed") {
      if (fingerprint === this.#completionFingerprint) return "replayed";
      throw new Error("COMPLETION_REPLAY_CONFLICT");
    }
    if (parts.length === 0 || parts.length > 10_000) throw new Error("COMPLETION_PART_COUNT");
    parts.forEach((part, index) => {
      if (part.uploadSessionId !== this.#uploadSessionId)
        throw new Error("UPLOAD_SESSION_MISMATCH");
      if (part.partNumber !== index + 1) throw new Error("PARTS_NOT_CONSECUTIVE");
      if (this.#parts.get(part.partNumber) !== part.checksumSha256) {
        throw new Error("PART_NOT_RECORDED");
      }
    });
    if (simulateInterruption) throw new Error("COMPLETION_INTERRUPTED");
    this.#completionFingerprint = fingerprint;
    this.#state = "completed";
    return "completed";
  }
}

export interface WorkerTransform {
  readonly basisNanounits: readonly number[];
  readonly translationMicrometres: Readonly<{ x: number; y: number; z: number }>;
}

export interface WorkerLeaseInput extends CaptureScope {
  readonly attempt: number;
  readonly cancelled: boolean;
  readonly expectedAttempt: number;
  readonly inputBytes: number;
  readonly objectCount: number;
  readonly packageCaptureSessionId: string;
  readonly packageProjectId: string;
  readonly packageTenantId: string;
  readonly rights: Readonly<{ serviceProcessingConsent: boolean; trainingUseConsent: string }>;
  readonly roomCount: number;
  readonly sharedWorldOrigin: boolean;
  readonly surfaceCount: number;
  readonly transforms: readonly WorkerTransform[];
}

export type WorkerBoundaryDecision =
  | Readonly<{ accepted: true; maximumCpuMilliseconds: 60_000; maximumResidentSetMebibytes: 1_024 }>
  | Readonly<{
      accepted: false;
      code:
        | "cancelled"
        | "incompatible-world-space"
        | "invalid-normalized-input"
        | "resource-limit"
        | "rights-not-permitted"
        | "source-mismatch"
        | "stale-attempt";
    }>;

export function evaluateWorkerLease(input: WorkerLeaseInput): WorkerBoundaryDecision {
  if (
    input.tenantId !== input.packageTenantId ||
    input.projectId !== input.packageProjectId ||
    input.captureSessionId !== input.packageCaptureSessionId
  ) {
    return deniedWorker("source-mismatch");
  }
  if (input.cancelled) return deniedWorker("cancelled");
  if (input.attempt !== input.expectedAttempt) return deniedWorker("stale-attempt");
  if (!input.rights.serviceProcessingConsent || input.rights.trainingUseConsent !== "denied") {
    return deniedWorker("rights-not-permitted");
  }
  if (!input.sharedWorldOrigin && input.roomCount > 1) {
    return deniedWorker("incompatible-world-space");
  }
  if (
    input.inputBytes < 1 ||
    input.inputBytes > c7CapturePolicy.maximumPackageBytes ||
    input.roomCount < 1 ||
    input.roomCount > c7CapturePolicy.maximumRoomCount ||
    input.objectCount < 0 ||
    input.objectCount > c7CapturePolicy.maximumObjectCount ||
    input.surfaceCount < 0 ||
    input.surfaceCount > c7CapturePolicy.maximumSurfaceCount
  ) {
    return deniedWorker("resource-limit");
  }
  if (!input.transforms.every(validTransform)) return deniedWorker("invalid-normalized-input");
  return Object.freeze({
    accepted: true,
    maximumCpuMilliseconds: 60_000,
    maximumResidentSetMebibytes: 1_024,
  });
}

function validTransform(transform: WorkerTransform): boolean {
  if (transform.basisNanounits.length !== 9) return false;
  const values = [
    ...transform.basisNanounits,
    transform.translationMicrometres.x,
    transform.translationMicrometres.y,
    transform.translationMicrometres.z,
  ];
  return values.every(
    (value, index) =>
      Number.isSafeInteger(value) && Math.abs(value) <= (index < 9 ? 1_100_000_000 : 1_000_000_000),
  );
}

function deniedWorker(
  code: Exclude<WorkerBoundaryDecision, { accepted: true }>["code"],
): WorkerBoundaryDecision {
  return Object.freeze({ accepted: false, code });
}

export function safeCaptureLog(input: {
  readonly actorRole: CaptureRole;
  readonly code: string;
  readonly correlationId: string;
  readonly raw?: unknown;
  readonly routeTemplate: string;
  readonly status: number;
}) {
  return Object.freeze({
    actorRole: input.actorRole,
    code: /^[A-Z][A-Z0-9_]{2,79}$/u.test(input.code) ? input.code : "UNSAFE_ERROR",
    correlationSha256: createHash("sha256").update(input.correlationId).digest("hex"),
    routeTemplate: /^\/v1\/projects\/:projectId\/capture-sessions(?:\/:[A-Za-z]+)*$/u.test(
      input.routeTemplate,
    )
      ? input.routeTemplate
      : "[REDACTED]",
    status: input.status,
  });
}
