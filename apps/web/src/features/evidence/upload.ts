import {
  assetDeclaredMimeTypeSchema,
  c2IngestionPolicy,
  safeAssetFileNameSchema,
} from "@interior-design/contracts";
import type {
  Asset,
  AssetDeclaredMimeType,
  AssetKind,
  AssetRightsAssertion,
  AssetUploadSession,
  InitiateAssetUploadRequest,
} from "@interior-design/contracts";

import { completeUpload, createUploadSession, getUploadSession, signUploadPart } from "./api";
import type { ReconciledUploadSession } from "./api";
import { bytesToBase64, bytesToHex, hashBlob } from "./hashing";
import type { RecoveryRecord } from "./recovery";
import { clearRecovery, saveRecovery } from "./recovery";

const kindMimeTypes: Record<AssetKind, readonly AssetDeclaredMimeType[]> = {
  document: ["application/pdf"],
  photograph: ["image/jpeg", "image/png", "image/heic", "image/heif"],
  plan: ["application/pdf", "image/jpeg", "image/png", "image/svg+xml"],
  video: ["video/mp4", "video/quicktime"],
};

export interface UploadProgress {
  completedBytes: number;
  phase: "hashing" | "uploading" | "completing";
  totalBytes: number;
}

export class SelectionProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionProblem";
  }
}

export function acceptedTypes(kind: AssetKind): string {
  return kindMimeTypes[kind].join(",");
}

export function validateFile(file: File, kind: AssetKind): AssetDeclaredMimeType {
  const fileName = safeAssetFileNameSchema.safeParse(file.name);
  if (!fileName.success) {
    throw new SelectionProblem("Choose a file whose name contains no path or control characters.");
  }
  if (file.size <= 0) throw new SelectionProblem("The selected file is empty.");
  if (file.size > c2IngestionPolicy.maximumAssetBytes) {
    throw new SelectionProblem("The selected file is larger than the 2 GiB upload limit.");
  }
  const mimeType = assetDeclaredMimeTypeSchema.safeParse(file.type);
  if (!mimeType.success || !kindMimeTypes[kind].includes(mimeType.data)) {
    throw new SelectionProblem(
      `This ${kind} file type is not supported. Choose one of: ${kindMimeTypes[kind].join(", ")}.`,
    );
  }
  return mimeType.data;
}

export async function prepareUpload(
  projectId: string,
  file: File,
  kind: AssetKind,
  rights: AssetRightsAssertion,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ file: File; record: RecoveryRecord; session: AssetUploadSession }> {
  const declaredMimeType = validateFile(file, kind);
  const digest = await hashBlob(file, {
    onProgress: (completedBytes) => {
      onProgress({ completedBytes, phase: "hashing", totalBytes: file.size });
    },
    signal,
  });
  const request: InitiateAssetUploadRequest = {
    byteSize: file.size,
    declaredMimeType,
    fileName: file.name,
    kind,
    rights,
    sha256: bytesToHex(digest),
  };
  const session = await createUploadSession(projectId, request, crypto.randomUUID());
  const record: RecoveryRecord = {
    assetId: session.asset.id,
    completedParts: [],
    completionKey: crypto.randomUUID(),
    fileName: file.name,
    kind,
    partSize: session.partSize,
    projectId,
    sessionId: session.sessionId,
    sha256: request.sha256,
    updatedAt: new Date().toISOString(),
  };
  await saveRecovery(record, file);
  return { file, record, session };
}

export function reconcileRecordedParts(
  record: RecoveryRecord,
  session: ReconciledUploadSession,
): RecoveryRecord {
  const recorded = new Set([...session.recordedPartNumbers].sort((left, right) => left - right));
  return {
    ...record,
    completedParts: record.completedParts
      .filter((part) => recorded.has(part.partNumber))
      .sort((left, right) => left.partNumber - right.partNumber),
    updatedAt: new Date().toISOString(),
  };
}

export async function reconcileUpload(
  record: RecoveryRecord,
): Promise<{ record: RecoveryRecord; session: ReconciledUploadSession }> {
  const session = await getUploadSession(record.projectId, record.sessionId);
  const reconciledRecord = reconcileRecordedParts(record, session);
  await saveRecovery(reconciledRecord);
  return { record: reconciledRecord, session };
}

export async function uploadRemaining(
  file: File,
  initialRecord: RecoveryRecord,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<Asset> {
  let record = initialRecord;
  const completed = new Map(record.completedParts.map((part) => [part.partNumber, part]));
  const totalParts = Math.ceil(file.size / record.partSize);
  let completedBytes = record.completedParts.reduce((sum, part) => {
    const start = (part.partNumber - 1) * record.partSize;
    return sum + Math.min(record.partSize, file.size - start);
  }, 0);

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (completed.has(partNumber)) continue;
    if (signal.aborted) throw new DOMException("Upload paused", "AbortError");
    const start = (partNumber - 1) * record.partSize;
    const part = file.slice(start, Math.min(start + record.partSize, file.size));
    const checksumSha256 = bytesToBase64(await hashBlob(part, { signal }));
    const signed = await signUploadPart(
      record.projectId,
      record.sessionId,
      { byteSize: part.size, checksumSha256, partNumber },
      `part-${record.sessionId}-${String(partNumber)}-${checksumSha256.replace(/[^A-Za-z0-9]/gu, "").slice(0, 12)}`,
    );
    const headers = new Headers(signed.requiredHeaders);
    const checksumHeader = Array.from(headers.entries()).find(([name]) =>
      name.toLowerCase().includes("checksum-sha256"),
    );
    if (!checksumHeader || checksumHeader[1] !== checksumSha256) {
      throw new Error(
        "The service did not bind the signed part URL to the requested SHA-256 checksum.",
      );
    }

    let response: Response;
    try {
      response = await fetch(signed.url, { body: part, headers, method: "PUT", signal });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      throw new Error("The signed upload URL could not be reached. Retry to request a fresh URL.", {
        cause: reason,
      });
    }
    if (!response.ok) {
      throw new Error(
        response.status === 403
          ? "The signed part URL expired. Retry to request a fresh URL."
          : "A file part could not be uploaded. Retry continues from saved parts.",
      );
    }
    const etag = response.headers.get("etag")?.trim();
    if (!etag)
      throw new Error("The storage response did not expose the required ETag completion token.");
    const completedPart = { checksumSha256, etag, partNumber };
    completed.set(partNumber, completedPart);
    completedBytes += part.size;
    record = {
      ...record,
      completedParts: Array.from(completed.values()).sort(
        (left, right) => left.partNumber - right.partNumber,
      ),
      updatedAt: new Date().toISOString(),
    };
    await saveRecovery(record);
    onProgress({ completedBytes, phase: "uploading", totalBytes: file.size });
  }

  onProgress({ completedBytes: file.size, phase: "completing", totalBytes: file.size });
  const asset = await completeUpload(
    record.projectId,
    record.sessionId,
    { parts: record.completedParts, sha256: record.sha256 },
    record.completionKey,
  );
  await clearRecovery(record.projectId, record.sessionId);
  return asset;
}
