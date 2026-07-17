import { z } from "zod";

export const projectIdSchema = z.uuid();
export const tenantIdSchema = z.uuid();
export const userIdSchema = z.uuid();

export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const localPersonaSchema = z.enum(["homeowner-alpha", "homeowner-beta", "viewer-alpha"]);
export type LocalPersona = z.infer<typeof localPersonaSchema>;

export const actorSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  role: memberRoleSchema,
  subject: z.string().trim().min(3).max(200),
  tenantId: tenantIdSchema,
  userId: userIdSchema,
});
export type Actor = z.infer<typeof actorSchema>;

export const sessionSchema = z.object({
  actor: actorSchema,
  authMode: z.enum(["local-fixture", "oidc"]),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type Session = z.infer<typeof sessionSchema>;

export const localSessionRequestSchema = z.object({ persona: localPersonaSchema }).strict();
export type LocalSessionRequest = z.infer<typeof localSessionRequestSchema>;

export const localSessionResponseSchema = z.object({
  accessToken: z.string().min(32),
  session: sessionSchema,
});
export type LocalSessionResponse = z.infer<typeof localSessionResponseSchema>;

export const projectStatusSchema = z.enum(["draft", "active", "archived"]);

export const projectSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: projectIdSchema,
  name: z.string().trim().min(1).max(120),
  status: projectStatusSchema,
  tenantId: tenantIdSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.int().min(1),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const dwellingTypeSchema = z.enum([
  "flat",
  "terraced-house",
  "semi-detached-house",
  "detached-house",
  "bungalow",
  "other",
]);

const boundedTextListSchema = z.array(z.string().trim().min(1).max(120)).max(12);

export const homeIntakeSchema = z
  .object({
    accessibilityNeeds: boundedTextListSchema,
    addressSummary: z.string().trim().min(1).max(160).optional(),
    bathrooms: z.int().min(0).max(20).optional(),
    bedrooms: z.int().min(0).max(30).optional(),
    dwellingType: dwellingTypeSchema,
    evidenceAvailable: z.object({
      photographs: z.boolean(),
      plans: z.boolean(),
      roomCapture: z.boolean(),
      video: z.boolean(),
    }),
    goals: boundedTextListSchema.min(1),
    household: z.object({
      adults: z.int().min(0).max(30),
      children: z.int().min(0).max(30),
      pets: z.int().min(0).max(30),
    }),
    levels: z.int().min(1).max(10).optional(),
    mustChange: boundedTextListSchema,
    mustKeep: boundedTextListSchema,
    notes: z.string().trim().max(2_000).optional(),
    styleWords: boundedTextListSchema,
  })
  .strict();
export type HomeIntake = z.infer<typeof homeIntakeSchema>;

export const projectIntakeSchema = z.object({
  intake: homeIntakeSchema,
  projectId: projectIdSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  updatedBy: userIdSchema,
  version: z.int().min(1),
});
export type ProjectIntake = z.infer<typeof projectIntakeSchema>;

export const upsertProjectIntakeRequestSchema = z
  .object({
    expectedVersion: z.int().min(0),
    intake: homeIntakeSchema,
  })
  .strict();
export type UpsertProjectIntakeRequest = z.infer<typeof upsertProjectIntakeRequestSchema>;

export const c1RouteContract = Object.freeze({
  createLocalSession: "/v1/auth/local/session",
  createProject: "/v1/projects",
  getProject: "/v1/projects/:projectId",
  getProjectIntake: "/v1/projects/:projectId/intake",
  getSession: "/v1/session",
  listProjects: "/v1/projects",
  upsertProjectIntake: "/v1/projects/:projectId/intake",
});

export const assetIdSchema = z.uuid();
export const assetUploadSessionIdSchema = z.uuid();
export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const sha256Base64Schema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/u);

export const assetKindSchema = z.enum(["plan", "photograph", "video", "document"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetDeclaredMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/pdf",
  "image/svg+xml",
  "video/mp4",
  "video/quicktime",
]);
export type AssetDeclaredMimeType = z.infer<typeof assetDeclaredMimeTypeSchema>;

export const assetStatusSchema = z.enum([
  "pending-upload",
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "quarantined",
  "rejected",
  "aborted",
]);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

export const assetRejectionCodeSchema = z.enum([
  "unsupported-type",
  "signature-mismatch",
  "resource-limit",
  "malformed-media",
  "checksum-mismatch",
  "malware-suspected",
  "processing-failed",
]);
export type AssetRejectionCode = z.infer<typeof assetRejectionCodeSchema>;

export const assetRightsBasisSchema = z.enum([
  "owned-by-user",
  "permission-granted",
  "public-domain",
  "licensed",
]);
export const trainingUseConsentSchema = z.enum(["denied", "granted"]);

const safeHttpsUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", "URL must use HTTPS.");

const signedObjectUrlSchema = z
  .url()
  .max(8_192)
  .refine((value) => {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))
    );
  }, "Signed URLs must use HTTPS except on loopback development hosts.");

export const assetRightsAssertionSchema = z
  .object({
    attribution: z.string().trim().min(1).max(500).optional(),
    basis: assetRightsBasisSchema,
    licenceUrl: safeHttpsUrlSchema.optional(),
    serviceProcessingConsent: z.literal(true),
    trainingUseConsent: trainingUseConsentSchema.default("denied"),
  })
  .strict();
export type AssetRightsAssertion = z.infer<typeof assetRightsAssertionSchema>;

export const safeAssetFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      Array.from(value).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 && codePoint !== 127;
      }),
    "File names cannot contain paths or control characters.",
  );

export const initiateAssetUploadRequestSchema = z
  .object({
    byteSize: z.int().positive().max(2_147_483_648),
    declaredMimeType: assetDeclaredMimeTypeSchema,
    fileName: safeAssetFileNameSchema,
    kind: assetKindSchema,
    rights: assetRightsAssertionSchema,
    sha256: sha256HexSchema,
  })
  .strict();
export type InitiateAssetUploadRequest = z.infer<typeof initiateAssetUploadRequestSchema>;

export const assetSourceFingerprintSchema = z
  .object({
    byteSize: z.int().positive().max(2_147_483_648),
    sha256: sha256HexSchema,
  })
  .strict();

export const assetSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    declaredMimeType: assetDeclaredMimeTypeSchema,
    detectedMimeType: z.string().trim().min(1).max(200).optional(),
    fileName: safeAssetFileNameSchema,
    id: assetIdSchema,
    kind: assetKindSchema,
    projectId: projectIdSchema,
    rejectionCode: assetRejectionCodeSchema.optional(),
    rights: assetRightsAssertionSchema,
    source: assetSourceFingerprintSchema,
    status: assetStatusSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((asset, context) => {
    const failed = asset.status === "quarantined" || asset.status === "rejected";
    if (failed !== (asset.rejectionCode !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only rejected or quarantined assets carry a safe rejection code.",
        path: ["rejectionCode"],
      });
    }
  });
export type Asset = z.infer<typeof assetSchema>;

export const assetUploadSessionStateSchema = z.enum([
  "initiated",
  "uploading",
  "completed",
  "aborted",
  "expired",
]);

export const assetUploadSessionSchema = z
  .object({
    asset: assetSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    maximumPartCount: z.literal(10_000),
    minimumNonFinalPartSize: z.literal(5_242_880),
    partSize: z.int().min(5_242_880).max(134_217_728),
    sessionId: assetUploadSessionIdSchema,
    state: assetUploadSessionStateSchema,
  })
  .strict();
export type AssetUploadSession = z.infer<typeof assetUploadSessionSchema>;

export const signAssetUploadPartRequestSchema = z
  .object({
    byteSize: z.int().positive().max(134_217_728),
    checksumSha256: sha256Base64Schema,
    partNumber: z.int().min(1).max(10_000),
  })
  .strict();
export type SignAssetUploadPartRequest = z.infer<typeof signAssetUploadPartRequestSchema>;

export const signedAssetUploadPartSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }),
    partNumber: z.int().min(1).max(10_000),
    requiredHeaders: z.record(z.string().min(1).max(100), z.string().min(1).max(1_024)),
    url: signedObjectUrlSchema,
  })
  .strict();
export type SignedAssetUploadPart = z.infer<typeof signedAssetUploadPartSchema>;

export const completedAssetUploadPartSchema = z
  .object({
    checksumSha256: sha256Base64Schema,
    etag: z.string().trim().min(1).max(512),
    partNumber: z.int().min(1).max(10_000),
  })
  .strict();

export const completeAssetUploadRequestSchema = z
  .object({
    parts: z.array(completedAssetUploadPartSchema).min(1).max(10_000),
    sha256: sha256HexSchema,
  })
  .strict()
  .superRefine((request, context) => {
    request.parts.forEach((part, index) => {
      if (part.partNumber !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Multipart completion parts must be consecutive and ordered from one.",
          path: ["parts", index, "partNumber"],
        });
      }
    });
  });
export type CompleteAssetUploadRequest = z.infer<typeof completeAssetUploadRequestSchema>;

export const assetAccessRequestSchema = z
  .object({
    representation: z.enum(["original", "preview", "thumbnail"]),
  })
  .strict();

export const assetAccessResponseSchema = z
  .object({
    contentDisposition: z.enum(["attachment", "inline"]),
    expiresAt: z.iso.datetime({ offset: true }),
    url: signedObjectUrlSchema,
  })
  .strict();

export const internalObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.=+-]*$/u)
  .refine(
    (value) => !value.split("/").some((segment) => segment === "." || segment === ".."),
    "Object keys cannot traverse storage paths.",
  );

export const assetProcessingCommandSchema = z
  .object({
    assetId: assetIdSchema,
    attempt: z.int().min(1).max(10),
    destinations: z
      .object({
        derivedBucket: z.literal("derived"),
        prefix: internalObjectKeySchema,
        quarantineBucket: z.literal("quarantine"),
      })
      .strict(),
    expected: assetSourceFingerprintSchema.extend({
      declaredMimeType: assetDeclaredMimeTypeSchema,
      kind: assetKindSchema,
    }),
    projectId: projectIdSchema,
    source: z
      .object({
        bucket: z.literal("source"),
        key: internalObjectKeySchema,
      })
      .strict(),
    version: z.literal("c2-ingest-v1"),
  })
  .strict();
export type AssetProcessingCommand = z.infer<typeof assetProcessingCommandSchema>;

export const assetTechnicalMetadataSchema = z
  .object({
    durationMilliseconds: z.int().nonnegative().max(108_000_000).optional(),
    heightPixels: z.int().positive().max(20_000).optional(),
    pageCount: z.int().positive().max(500).optional(),
    widthPixels: z.int().positive().max(20_000).optional(),
  })
  .strict();

export const derivedAssetArtifactSchema = z
  .object({
    byteSize: z.int().positive().max(268_435_456),
    key: internalObjectKeySchema,
    kind: z.enum(["preview", "thumbnail", "metadata-manifest"]),
    mimeType: z.string().trim().min(1).max(200),
    sha256: sha256HexSchema,
  })
  .strict();

const assetProcessingResultBaseSchema = z.object({
  assetId: assetIdSchema,
  detectedMimeType: z.string().trim().min(1).max(200),
  projectId: projectIdSchema,
  provenance: z
    .object({
      executedAt: z.iso.datetime({ offset: true }),
      policyVersion: z.literal("c2-ingest-v1"),
      tools: z
        .array(
          z
            .object({
              name: z.string().trim().min(1).max(100),
              version: z.string().trim().min(1).max(100),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  technicalMetadata: assetTechnicalMetadataSchema,
  verifiedSource: assetSourceFingerprintSchema,
  version: z.literal("c2-ingest-v1"),
});

export const assetProcessingResultSchema = z.discriminatedUnion("status", [
  assetProcessingResultBaseSchema
    .extend({
      artifacts: z.array(derivedAssetArtifactSchema).min(1).max(20),
      status: z.literal("ready"),
    })
    .strict(),
  assetProcessingResultBaseSchema
    .extend({
      artifacts: z.array(derivedAssetArtifactSchema).max(20),
      rejectionCode: assetRejectionCodeSchema,
      status: z.literal("quarantined"),
    })
    .strict(),
  assetProcessingResultBaseSchema
    .extend({
      artifacts: z.array(derivedAssetArtifactSchema).max(20),
      rejectionCode: assetRejectionCodeSchema,
      status: z.literal("rejected"),
    })
    .strict(),
]);
export type AssetProcessingResult = z.infer<typeof assetProcessingResultSchema>;

export const c2IngestionPolicy = Object.freeze({
  maximumAssetBytes: 2_147_483_648,
  maximumImageDimension: 20_000,
  maximumImagePixels: 100_000_000,
  maximumPdfPages: 500,
  maximumUploadParts: 10_000,
  maximumVideoDurationMilliseconds: 108_000_000,
  minimumNonFinalPartBytes: 5_242_880,
  signedAccessTtlSeconds: 300,
  signedUploadPartTtlSeconds: 900,
  version: "c2-ingest-v1",
} as const);

export const c2RouteContract = Object.freeze({
  abortUpload: "/v1/projects/:projectId/assets/upload-sessions/:sessionId",
  completeUpload: "/v1/projects/:projectId/assets/upload-sessions/:sessionId/complete",
  createUploadSession: "/v1/projects/:projectId/assets/upload-sessions",
  getAsset: "/v1/projects/:projectId/assets/:assetId",
  getUploadSession: "/v1/projects/:projectId/assets/upload-sessions/:sessionId",
  issueAssetAccess: "/v1/projects/:projectId/assets/:assetId/access",
  listAssets: "/v1/projects/:projectId/assets",
  signUploadPart: "/v1/projects/:projectId/assets/upload-sessions/:sessionId/parts",
});
