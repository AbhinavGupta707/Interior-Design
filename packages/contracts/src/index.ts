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
    recordedPartNumbers: z
      .array(z.int().min(1).max(10_000))
      .max(10_000)
      .superRefine((partNumbers, context) => {
        for (let index = 1; index < partNumbers.length; index += 1) {
          const currentPartNumber = partNumbers[index];
          const previousPartNumber = partNumbers[index - 1];
          if (
            currentPartNumber !== undefined &&
            previousPartNumber !== undefined &&
            currentPartNumber <= previousPartNumber
          ) {
            context.addIssue({
              code: "custom",
              message: "Recorded part numbers must be unique and strictly ascending.",
              path: [index],
            });
          }
        }
      }),
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
    durationMilliseconds: z.int().nonnegative().max(1_800_000).optional(),
    heightPixels: z.int().positive().max(20_000).optional(),
    pageCount: z.int().positive().max(500).optional(),
    widthPixels: z.int().positive().max(20_000).optional(),
  })
  .superRefine((metadata, context) => {
    if (
      metadata.widthPixels !== undefined &&
      metadata.heightPixels !== undefined &&
      BigInt(metadata.widthPixels) * BigInt(metadata.heightPixels) > 100_000_000n
    ) {
      context.addIssue({
        code: "custom",
        message: "Image dimensions exceed the 100 megapixel processing limit.",
        path: ["widthPixels"],
      });
    }
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
  maximumVideoDurationMilliseconds: 1_800_000,
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

export const propertyIdSchema = z.uuid();
export const propertyResolutionIdSchema = z.uuid();
export const propertyCandidateIdSchema = z.uuid();
export const propertySourceRecordIdSchema = z.uuid();
export const uprnSchema = z.string().regex(/^\d{1,12}$/u);

export const propertyJurisdictionSchema = z.enum([
  "england",
  "wales",
  "scotland",
  "northern-ireland",
  "unknown",
]);
export type PropertyJurisdiction = z.infer<typeof propertyJurisdictionSchema>;

export const propertyAddressSchema = z
  .object({
    countryCode: z.literal("GB"),
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().min(1).max(120).optional(),
    locality: z.string().trim().min(1).max(120).optional(),
    postcode: z.string().trim().min(2).max(16).optional(),
  })
  .strict();
export type PropertyAddress = z.infer<typeof propertyAddressSchema>;

export const propertyIdentifierSchema = z
  .object({
    scheme: z.literal("UPRN"),
    value: uprnSchema,
  })
  .strict();

export const propertyLocationSchema = z
  .discriminatedUnion("crs", [
    z
      .object({
        coordinates: z.tuple([z.number(), z.number()]),
        crs: z.literal("EPSG:27700"),
      })
      .strict(),
    z
      .object({
        coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
        crs: z.literal("EPSG:4326"),
      })
      .strict(),
  ])
  .describe(
    "A property identity point, never a legal boundary or interior geometry. Coordinates are easting/northing for EPSG:27700 and longitude/latitude for EPSG:4326.",
  );

export const propertySourceSchema = z
  .object({
    coverage: z.enum(["fixture-complete", "partial", "unknown"]),
    dataset: z.string().trim().min(1).max(120),
    datasetVersion: z.string().trim().min(1).max(120),
    licence: z
      .object({
        id: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(200),
        url: safeHttpsUrlSchema.optional(),
      })
      .strict(),
    modelTrainingAllowed: z.literal(false),
    participantSharingAllowed: z.boolean(),
    providerId: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{0,79}$/u),
    retrievedAt: z.iso.datetime({ offset: true }),
    serviceProcessingAllowed: z.literal(true),
  })
  .strict();
export type PropertySource = z.infer<typeof propertySourceSchema>;

export const propertyCandidateSchema = z
  .object({
    address: propertyAddressSchema,
    candidateId: propertyCandidateIdSchema,
    displayAddress: z.string().trim().min(1).max(240),
    identifiers: z.array(propertyIdentifierSchema).max(5),
    jurisdiction: propertyJurisdictionSchema,
    location: propertyLocationSchema.optional(),
    source: propertySourceSchema,
  })
  .strict();
export type PropertyCandidate = z.infer<typeof propertyCandidateSchema>;

export const resolvePropertyRequestSchema = z
  .object({
    countryCode: z.literal("GB"),
    query: z.string().trim().min(3).max(160),
  })
  .strict();
export type ResolvePropertyRequest = z.infer<typeof resolvePropertyRequestSchema>;

export const propertyResolutionResponseSchema = z
  .object({
    candidates: z.array(propertyCandidateSchema).max(20),
    expiresAt: z.iso.datetime({ offset: true }),
    manualEntryAllowed: z.literal(true),
    providerState: z.enum(["fixture", "disabled", "unavailable"]),
    resolutionId: propertyResolutionIdSchema,
    status: z.enum(["matched", "ambiguous", "no-match", "unavailable"]),
  })
  .strict()
  .superRefine((resolution, context) => {
    const validCandidateCount =
      (resolution.status === "matched" && resolution.candidates.length === 1) ||
      (resolution.status === "ambiguous" && resolution.candidates.length >= 2) ||
      ((resolution.status === "no-match" || resolution.status === "unavailable") &&
        resolution.candidates.length === 0);
    if (!validCandidateCount) {
      context.addIssue({
        code: "custom",
        message: "Property resolution status must agree with its candidate count.",
        path: ["candidates"],
      });
    }
    const providerStateAgrees =
      (resolution.status === "unavailable" &&
        (resolution.providerState === "disabled" || resolution.providerState === "unavailable")) ||
      (resolution.status !== "unavailable" && resolution.providerState === "fixture");
    if (!providerStateAgrees) {
      context.addIssue({
        code: "custom",
        message: "Property resolution status must agree with its provider state.",
        path: ["providerState"],
      });
    }
  });
export type PropertyResolutionResponse = z.infer<typeof propertyResolutionResponseSchema>;

const selectCandidatePropertyRequestSchema = z
  .object({
    candidateId: propertyCandidateIdSchema,
    expectedVersion: z.int().nonnegative(),
    mode: z.literal("candidate"),
    resolutionId: propertyResolutionIdSchema,
  })
  .strict();

const selectManualPropertyRequestSchema = z
  .object({
    address: propertyAddressSchema,
    expectedVersion: z.int().nonnegative(),
    jurisdiction: propertyJurisdictionSchema,
    mode: z.literal("manual"),
  })
  .strict();

export const selectProjectPropertyRequestSchema = z.discriminatedUnion("mode", [
  selectCandidatePropertyRequestSchema,
  selectManualPropertyRequestSchema,
]);
export type SelectProjectPropertyRequest = z.infer<typeof selectProjectPropertyRequestSchema>;

export const projectPropertySchema = z
  .object({
    address: propertyAddressSchema,
    displayAddress: z.string().trim().min(1).max(240),
    identifiers: z.array(propertyIdentifierSchema).max(5),
    interiorKnowledgeStatus: z.literal("unknown-without-evidence"),
    jurisdiction: propertyJurisdictionSchema,
    location: propertyLocationSchema.optional(),
    mode: z.enum(["candidate", "manual"]),
    projectId: projectIdSchema,
    propertyId: propertyIdSchema,
    selectedAt: z.iso.datetime({ offset: true }),
    source: propertySourceSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict();
export type ProjectProperty = z.infer<typeof projectPropertySchema>;

export const propertyDossierClassificationSchema = z.enum([
  "source-observation",
  "user-assertion",
  "estimate",
  "inference",
  "unknown",
]);
export type PropertyDossierClassification = z.infer<typeof propertyDossierClassificationSchema>;

export const propertyDossierValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("integer"),
      unit: z.enum(["count", "m2", "mm", "year"]).optional(),
      value: z.int().min(-1_000_000_000).max(1_000_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("number"),
      unit: z.enum(["m", "m2", "percent", "rating"]).optional(),
      value: z.number().min(-1_000_000_000).max(1_000_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      value: z.string().trim().min(1).max(500),
    })
    .strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);
export type PropertyDossierValue = z.infer<typeof propertyDossierValueSchema>;

export const propertyDossierItemSchema = z
  .object({
    classification: propertyDossierClassificationSchema,
    confidencePercent: z.int().min(0).max(100).optional(),
    interiorClaim: z.literal("none"),
    key: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
    label: z.string().trim().min(1).max(120),
    note: z.string().trim().min(1).max(500).optional(),
    sourceRecordIds: z.array(propertySourceRecordIdSchema).max(20),
    value: propertyDossierValueSchema,
  })
  .strict()
  .superRefine((item, context) => {
    const isUnknown = item.classification === "unknown";
    if (isUnknown !== (item.value.kind === "unknown")) {
      context.addIssue({
        code: "custom",
        message: "Unknown dossier items must carry an explicit unknown value.",
        path: ["value"],
      });
    }
    const needsConfidence =
      item.classification === "estimate" || item.classification === "inference";
    if (needsConfidence !== (item.confidencePercent !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only estimates and inferences carry a bounded confidence percentage.",
        path: ["confidencePercent"],
      });
    }
    if (item.classification !== "unknown" && item.sourceRecordIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Every established dossier item must reference a source record.",
        path: ["sourceRecordIds"],
      });
    }
  });
export type PropertyDossierItem = z.infer<typeof propertyDossierItemSchema>;

export const propertySourceRecordSchema = z
  .object({
    fields: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u))
      .min(1)
      .max(100),
    id: propertySourceRecordIdSchema,
    normalizedPayloadSha256: sha256HexSchema,
    projectId: projectIdSchema,
    propertyId: propertyIdSchema,
    source: propertySourceSchema,
  })
  .strict();
export type PropertySourceRecord = z.infer<typeof propertySourceRecordSchema>;

export const propertyDossierSchema = z
  .object({
    coverageWarnings: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    generatedAt: z.iso.datetime({ offset: true }),
    interiorKnowledgeStatus: z.literal("unknown-without-evidence"),
    items: z.array(propertyDossierItemSchema).min(1).max(200),
    planningStatus: z.literal("not-reviewed"),
    property: projectPropertySchema,
    sources: z.array(propertySourceRecordSchema).max(50),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((dossier, context) => {
    const sourceIds = new Set(dossier.sources.map((source) => source.id));
    if (sourceIds.size !== dossier.sources.length) {
      context.addIssue({
        code: "custom",
        message: "Dossier source records must be unique.",
        path: ["sources"],
      });
    }
    dossier.items.forEach((item, index) => {
      item.sourceRecordIds.forEach((sourceRecordId) => {
        if (!sourceIds.has(sourceRecordId)) {
          context.addIssue({
            code: "custom",
            message: "Dossier items may reference only included source records.",
            path: ["items", index, "sourceRecordIds"],
          });
        }
      });
    });
    dossier.sources.forEach((source, index) => {
      if (
        source.projectId !== dossier.property.projectId ||
        source.propertyId !== dossier.property.propertyId
      ) {
        context.addIssue({
          code: "custom",
          message: "Dossier source records must belong to the dossier property and project.",
          path: ["sources", index],
        });
      }
    });
  });
export type PropertyDossier = z.infer<typeof propertyDossierSchema>;

export const refreshPropertyDossierRequestSchema = z
  .object({ expectedVersion: z.int().nonnegative() })
  .strict();

export const propertySourceRecordsResponseSchema = z
  .object({ sources: z.array(propertySourceRecordSchema).max(50) })
  .strict();

export const c3RouteContract = Object.freeze({
  getDossier: "/v1/projects/:projectId/property/dossier",
  listSourceRecords: "/v1/projects/:projectId/property/source-records",
  refreshDossier: "/v1/projects/:projectId/property/dossier/refresh",
  resolveProperty: "/v1/projects/:projectId/property/resolutions",
  selectProperty: "/v1/projects/:projectId/property",
});
