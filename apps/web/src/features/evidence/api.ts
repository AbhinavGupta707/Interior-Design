import {
  assetAccessResponseSchema,
  assetSchema,
  assetUploadSessionSchema,
  completeAssetUploadRequestSchema,
  initiateAssetUploadRequestSchema,
  signAssetUploadPartRequestSchema,
  signedAssetUploadPartSchema,
} from "@interior-design/contracts";
import type {
  Asset,
  CompleteAssetUploadRequest,
  InitiateAssetUploadRequest,
  SignAssetUploadPartRequest,
  SignedAssetUploadPart,
} from "@interior-design/contracts";
import { z } from "zod";

export type EvidenceProblemKind = "expired" | "forbidden" | "offline" | "unavailable";
type AssetRepresentation = "original" | "preview" | "thumbnail";
interface AssetAccessResponse {
  contentDisposition: "attachment" | "inline";
  expiresAt: string;
  url: string;
}
const reconciledUploadSessionSchema = assetUploadSessionSchema.extend({
  recordedPartNumbers: z.array(z.number().int().min(1).max(10_000)).default([]),
});
export type ReconciledUploadSession = z.infer<typeof reconciledUploadSessionSchema>;

export class EvidenceProblem extends Error {
  constructor(
    readonly kind: EvidenceProblemKind,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "EvidenceProblem";
  }
}

function problemKind(status: number): EvidenceProblemKind {
  if (status === 401) return "expired";
  if (status === 403 || status === 404) return "forbidden";
  return "unavailable";
}

async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
    throw new EvidenceProblem("offline", "You appear to be offline. Reconnect and try again.");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const detail =
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof body.detail === "string"
        ? body.detail
        : "The evidence request could not be completed.";
    throw new EvidenceProblem(problemKind(response.status), detail, response.status);
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new EvidenceProblem(
      "unavailable",
      "The service response did not match c2-ingest-v1.",
      502,
    );
  }
  return parsed.data;
}

function mutation(key: string, body?: unknown, method = "POST"): RequestInit {
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": key,
    },
    method,
  };
}

function base(projectId: string): string {
  return `/api/c2/projects/${encodeURIComponent(projectId)}/assets`;
}

export function listAssets(projectId: string): Promise<Asset[]> {
  return request(base(projectId), z.array(assetSchema));
}

export function createUploadSession(
  projectId: string,
  value: InitiateAssetUploadRequest,
  idempotencyKey: string,
): Promise<ReconciledUploadSession> {
  return request(
    base(projectId),
    reconciledUploadSessionSchema,
    mutation(idempotencyKey, initiateAssetUploadRequestSchema.parse(value)),
  );
}

export function getUploadSession(
  projectId: string,
  sessionId: string,
): Promise<ReconciledUploadSession> {
  return request(
    `${base(projectId)}/upload-sessions/${encodeURIComponent(sessionId)}`,
    reconciledUploadSessionSchema,
  );
}

export function signUploadPart(
  projectId: string,
  sessionId: string,
  value: SignAssetUploadPartRequest,
  idempotencyKey: string,
): Promise<SignedAssetUploadPart> {
  return request(
    `${base(projectId)}/upload-sessions/${encodeURIComponent(sessionId)}/parts`,
    signedAssetUploadPartSchema,
    mutation(idempotencyKey, signAssetUploadPartRequestSchema.parse(value)),
  );
}

export function completeUpload(
  projectId: string,
  sessionId: string,
  value: CompleteAssetUploadRequest,
  idempotencyKey: string,
): Promise<Asset> {
  return request(
    `${base(projectId)}/upload-sessions/${encodeURIComponent(sessionId)}/complete`,
    assetSchema,
    mutation(idempotencyKey, completeAssetUploadRequestSchema.parse(value)),
  );
}

export function abortUpload(
  projectId: string,
  sessionId: string,
  idempotencyKey: string,
): Promise<ReconciledUploadSession> {
  return request(
    `${base(projectId)}/upload-sessions/${encodeURIComponent(sessionId)}`,
    reconciledUploadSessionSchema,
    mutation(idempotencyKey, undefined, "DELETE"),
  );
}

export function issueAssetAccess(
  projectId: string,
  assetId: string,
  representation: AssetRepresentation,
  idempotencyKey: string,
): Promise<AssetAccessResponse> {
  return request(
    `${base(projectId)}/${encodeURIComponent(assetId)}/access`,
    assetAccessResponseSchema,
    mutation(idempotencyKey, { representation }),
  );
}
