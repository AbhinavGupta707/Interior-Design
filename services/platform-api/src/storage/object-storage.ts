export type SourceBucket = "source";
export type ReadableAssetBucket = "source" | "derived";
export type ManagedAssetBucket = ReadableAssetBucket | "quarantine";

export interface CreateMultipartUploadInput {
  readonly bucket: SourceBucket;
  readonly contentType: string;
  readonly key: string;
}

export interface SignUploadPartInput {
  readonly bucket: SourceBucket;
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly expiresAt: Date;
  readonly key: string;
  readonly partNumber: number;
  readonly providerUploadId: string;
}

export interface SignedUploadPart {
  readonly expiresAt: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly url: string;
}

export interface CompleteMultipartPart {
  readonly checksumSha256: string;
  readonly etag: string;
  readonly partNumber: number;
}

export interface CompleteMultipartUploadInput {
  readonly bucket: SourceBucket;
  readonly expectedByteSize: number;
  readonly key: string;
  readonly parts: readonly CompleteMultipartPart[];
  readonly providerUploadId: string;
}

export interface AbortMultipartUploadInput {
  readonly bucket: SourceBucket;
  readonly key: string;
  readonly providerUploadId: string;
}

export interface SignObjectAccessInput {
  readonly bucket: ReadableAssetBucket;
  readonly contentDisposition: "attachment" | "inline";
  readonly contentType: string;
  readonly expiresAt: Date;
  readonly key: string;
}

export interface SignedObjectAccess {
  readonly expiresAt: string;
  readonly url: string;
}

/**
 * Provider upload IDs and object keys must stay behind this boundary. Implementations must not
 * include either value, credentials, or signed URLs in thrown error messages.
 */
export interface AssetObjectStorage {
  abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void>;
  completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void>;
  createMultipartUpload(input: CreateMultipartUploadInput): Promise<string>;
  readiness(): Promise<void>;
  signObjectAccess(input: SignObjectAccessInput): Promise<SignedObjectAccess>;
  signUploadPart(input: SignUploadPartInput): Promise<SignedUploadPart>;
}
