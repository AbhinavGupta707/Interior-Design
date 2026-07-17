import { createHash } from "node:crypto";

export type ReconstructionAction = "cancel" | "create" | "publish" | "read" | "retry";
export type ReconstructionRole = "editor" | "owner" | "viewer";

export interface ActorScope {
  readonly projectId: string;
  readonly role: ReconstructionRole;
  readonly tenantId: string;
}

export interface ReconstructionResource {
  readonly attempt: number;
  readonly cancelled: boolean;
  readonly jobId: string;
  readonly projectId: string;
  readonly rightsActive: boolean;
  readonly tenantId: string;
  readonly terminal: boolean;
  readonly version: number;
}

export interface PublicationClaim {
  readonly attempt: number;
  readonly jobId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly version: number;
}

const mutationRoles = new Set<ReconstructionRole>(["editor", "owner"]);

export function authorize(
  actor: ActorScope,
  resource: ReconstructionResource,
  action: ReconstructionAction,
): void {
  if (actor.tenantId !== resource.tenantId || actor.projectId !== resource.projectId) {
    throw new Error("RECONSTRUCTION_NOT_FOUND");
  }
  if (action === "read") return;
  if (!mutationRoles.has(actor.role)) throw new Error("RECONSTRUCTION_FORBIDDEN");
  if (action === "publish" && (resource.cancelled || !resource.rightsActive || resource.terminal)) {
    throw new Error("RECONSTRUCTION_PUBLICATION_DENIED");
  }
}

export function assertPublicationFence(
  resource: ReconstructionResource,
  claim: PublicationClaim,
): void {
  if (
    resource.tenantId !== claim.tenantId ||
    resource.projectId !== claim.projectId ||
    resource.jobId !== claim.jobId ||
    resource.attempt !== claim.attempt ||
    resource.version !== claim.version ||
    resource.cancelled ||
    !resource.rightsActive ||
    resource.terminal
  ) {
    throw new Error("RECONSTRUCTION_STALE_PUBLICATION");
  }
}

export function assertRights(value: unknown): void {
  if (!isRecord(value)) throw new Error("RECONSTRUCTION_RIGHTS_DENIED");
  if (
    value.serviceProcessingConsent !== true ||
    value.trainingUseConsent !== "denied" ||
    !["owned-by-user", "permission-granted", "public-domain", "licensed"].includes(
      String(value.basis),
    )
  ) {
    throw new Error("RECONSTRUCTION_RIGHTS_DENIED");
  }
}

const hostileKey = /(command|executable|flag|objectkey|path|secret|shell|signed|token|uri|url)/iu;
const hostileString = /(?:\.\.[\\/]|[A-Za-z]:[\\/]|^\/|\$\(|`|;|&&|\|\||https?:\/\/|file:\/\/)/u;

export function assertPathFreeAdapterManifest(value: unknown): void {
  visit(value, 0);
}

function visit(value: unknown, depth: number): void {
  if (depth > 20) throw new Error("RECONSTRUCTION_MANIFEST_DEPTH_EXCEEDED");
  if (typeof value === "string") {
    if (hostileString.test(value)) throw new Error("RECONSTRUCTION_MANIFEST_LOCATION_OR_SHELL");
    return;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error("RECONSTRUCTION_MANIFEST_ARRAY_LIMIT");
    for (const item of value) visit(item, depth + 1);
    return;
  }
  if (!isRecord(value)) throw new Error("RECONSTRUCTION_MANIFEST_VALUE_INVALID");
  for (const [key, child] of Object.entries(value)) {
    if (hostileKey.test(key)) throw new Error("RECONSTRUCTION_MANIFEST_FIELD_DENIED");
    visit(child, depth + 1);
  }
}

export function assertAppearanceAuthority(result: unknown): void {
  if (!isRecord(result) || !Array.isArray(result.artifacts)) {
    throw new Error("APPEARANCE_RESULT_INVALID");
  }
  if (!["nerfstudio", "gsplat"].includes(String(result.method))) {
    throw new Error("APPEARANCE_RESULT_INVALID");
  }
  for (const artifact of result.artifacts) {
    if (!isRecord(artifact)) throw new Error("APPEARANCE_RESULT_INVALID");
    if (
      !["nerfstudio-viewer", "gaussian-splat"].includes(String(artifact.kind)) ||
      artifact.dimensionalAuthority !== "non-dimensional"
    ) {
      throw new Error("APPEARANCE_DIMENSIONAL_AUTHORITY_DENIED");
    }
  }
  for (const forbidden of ["canonicalModelId", "confirmedGeometry", "mutation", "operationId"]) {
    if (forbidden in result) throw new Error("APPEARANCE_CANONICAL_MUTATION_DENIED");
  }
}

export function safeTelemetry(input: {
  readonly attempt: number;
  readonly durationMilliseconds: number;
  readonly eventCode: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly safeCode: string | null;
  readonly stage: string;
  readonly untrusted?: unknown;
}): Readonly<Record<string, number | string | null>> {
  return Object.freeze({
    attempt: input.attempt,
    durationMilliseconds: input.durationMilliseconds,
    eventCode: input.eventCode,
    jobIdHash: digest(input.jobId),
    projectIdHash: digest(input.projectId),
    safeCode: input.safeCode,
    stage: input.stage,
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
