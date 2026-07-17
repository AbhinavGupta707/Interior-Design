import { z } from "zod";

export const c4SchemaVersion = "c4-canonical-home-v1" as const;

// These remain structurally identical to the shared C1-C3 primitives. Defining
// them locally avoids a runtime cycle between the contract barrel and C4.
const projectIdSchema = z.uuid();
const propertyIdSchema = z.uuid();
const userIdSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const modelIdSchema = z.uuid();
export const modelSnapshotIdSchema = z.uuid();
export const modelElementIdSchema = z.uuid();
export const modelClaimIdSchema = z.uuid();
export const modelEvidenceIdSchema = z.uuid();

export const modelProfileSchema = z.enum(["existing", "proposed", "as-built"]);
export type ModelProfile = z.infer<typeof modelProfileSchema>;

export const provenanceKnownStateSchema = z.enum([
  "observed",
  "source-derived",
  "fused",
  "inferred",
  "user-asserted",
]);
export const provenanceStateSchema = z.union([provenanceKnownStateSchema, z.literal("unknown")]);
export type ProvenanceState = z.infer<typeof provenanceStateSchema>;

export const modelMethodSchema = z
  .object({
    kind: z.enum([
      "fixture",
      "manual",
      "plan-import",
      "room-capture",
      "reconstruction",
      "fusion",
      "system",
    ]),
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(80),
  })
  .strict();

export const modelVerificationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-reviewed") }).strict(),
  z
    .object({
      limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
      purpose: z.enum(["concept", "planning", "technical", "construction", "as-built-record"]),
      reviewedAt: z.iso.datetime({ offset: true }),
      reviewedBy: userIdSchema,
      status: z.literal("reviewed-with-limitations"),
    })
    .strict(),
]);

export const knownAttributionSchema = z
  .object({
    actorUserId: userIdSchema.optional(),
    claimId: modelClaimIdSchema,
    confidenceBasisPoints: z.int().min(0).max(10_000).optional(),
    evidenceIds: z.array(modelEvidenceIdSchema).max(50),
    method: modelMethodSchema,
    observedAt: z.iso.datetime({ offset: true }).optional(),
    state: provenanceKnownStateSchema,
    verification: modelVerificationSchema,
  })
  .strict()
  .superRefine((attribution, context) => {
    const requiresEvidence = ["observed", "source-derived", "fused", "inferred"].includes(
      attribution.state,
    );
    if (requiresEvidence && attribution.evidenceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: `${attribution.state} values require at least one evidence reference.`,
        path: ["evidenceIds"],
      });
    }
    const requiresConfidence = attribution.state === "fused" || attribution.state === "inferred";
    if (requiresConfidence !== (attribution.confidenceBasisPoints !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Fused and inferred values, and only those values, require bounded confidence.",
        path: ["confidenceBasisPoints"],
      });
    }
    if (attribution.state === "user-asserted" && attribution.actorUserId === undefined) {
      context.addIssue({
        code: "custom",
        message: "User assertions require an attributable user actor.",
        path: ["actorUserId"],
      });
    }
  });
export type KnownAttribution = z.infer<typeof knownAttributionSchema>;

export const unknownAttributionSchema = z
  .object({
    claimId: modelClaimIdSchema,
    evidenceIds: z.array(modelEvidenceIdSchema).max(50),
    method: modelMethodSchema,
    reason: z.enum([
      "not-observed",
      "not-provided",
      "conflicting-evidence",
      "outside-scope",
      "unsupported",
    ]),
    state: z.literal("unknown"),
    verification: z.object({ status: z.literal("not-reviewed") }).strict(),
  })
  .strict();

export function attributedValueSchema<TSchema extends z.ZodType>(valueSchema: TSchema) {
  return z.discriminatedUnion("knowledge", [
    z
      .object({
        attribution: knownAttributionSchema,
        knowledge: z.literal("known"),
        value: valueSchema,
      })
      .strict(),
    z
      .object({
        attribution: unknownAttributionSchema,
        knowledge: z.literal("unknown"),
      })
      .strict(),
  ]);
}

export const modelCoordinateMmSchema = z.int().min(-10_000_000).max(10_000_000);
export const modelDimensionMmSchema = z.int().positive().max(1_000_000);
export const modelOffsetMmSchema = z.int().min(-1_000_000).max(1_000_000);
export const modelAngleMilliDegreesSchema = z.int().min(-360_000).max(360_000);

export const modelPoint2Schema = z
  .object({ xMm: modelCoordinateMmSchema, yMm: modelCoordinateMmSchema })
  .strict();
export const modelPoint3Schema = z
  .object({
    xMm: modelCoordinateMmSchema,
    yMm: modelCoordinateMmSchema,
    zMm: modelCoordinateMmSchema,
  })
  .strict();
export const modelPolyline2Schema = z.array(modelPoint2Schema).min(2).max(512);
export const modelPolygon2Schema = z.array(modelPoint2Schema).min(3).max(512);
export const modelPolygon3Schema = z.array(modelPoint3Schema).min(3).max(512);

const attributedStringSchema = attributedValueSchema(z.string().trim().min(1).max(160));
const attributedCoordinateSchema = attributedValueSchema(modelCoordinateMmSchema);
const attributedDimensionSchema = attributedValueSchema(modelDimensionMmSchema);
const attributedOffsetSchema = attributedValueSchema(modelOffsetMmSchema);
const attributedPoint3Schema = attributedValueSchema(modelPoint3Schema);
const attributedPolyline2Schema = attributedValueSchema(modelPolyline2Schema);
const attributedPolygon2Schema = attributedValueSchema(modelPolygon2Schema);
const attributedPolygon3Schema = attributedValueSchema(modelPolygon3Schema);
const attributedIntegerSchema = attributedValueSchema(z.int().min(0).max(1_000_000));

const elementCoreShape = {
  id: modelElementIdSchema,
  name: attributedStringSchema,
  origin: knownAttributionSchema,
};

export const modelLevelSchema = z
  .object({
    ...elementCoreShape,
    elementType: z.literal("level"),
    elevationMm: attributedCoordinateSchema,
    storeyHeightMm: attributedDimensionSchema,
  })
  .strict();

export const modelSpaceSchema = z
  .object({
    ...elementCoreShape,
    boundary: attributedPolygon2Schema,
    boundedByElementIds: z.array(modelElementIdSchema).max(256),
    classification: attributedStringSchema,
    elementType: z.literal("space"),
    levelId: modelElementIdSchema,
  })
  .strict();

export const modelSurfaceSchema = z
  .object({
    ...elementCoreShape,
    boundary: attributedPolygon3Schema,
    elementType: z.literal("surface"),
    kind: z.enum(["floor", "ceiling", "slab", "roof", "wall-face", "other"]),
    levelId: modelElementIdSchema,
  })
  .strict();

export const modelWallSchema = z
  .object({
    ...elementCoreShape,
    alignment: z.enum(["centre", "left-face", "right-face"]),
    baseOffsetMm: attributedOffsetSchema,
    elementType: z.literal("wall"),
    heightMm: attributedDimensionSchema,
    levelId: modelElementIdSchema,
    path: attributedPolyline2Schema,
    thicknessMm: attributedDimensionSchema,
  })
  .strict();

export const modelOpeningSchema = z
  .object({
    ...elementCoreShape,
    elementType: z.literal("opening"),
    heightMm: attributedDimensionSchema,
    hostWallId: modelElementIdSchema,
    kind: z.enum(["opening", "door", "window"]),
    offsetAlongHostMm: attributedDimensionSchema,
    sillHeightMm: attributedOffsetSchema,
    swing: attributedValueSchema(z.enum(["left", "right", "double", "sliding", "none"])),
    widthMm: attributedDimensionSchema,
  })
  .strict();

export const modelStairSchema = z
  .object({
    ...elementCoreShape,
    elementType: z.literal("stair"),
    fromLevelId: modelElementIdSchema,
    path: attributedPolyline2Schema,
    riseMm: attributedDimensionSchema,
    runMm: attributedDimensionSchema,
    stepCount: attributedIntegerSchema,
    toLevelId: modelElementIdSchema,
    widthMm: attributedDimensionSchema,
  })
  .strict();

const placementSchema = z
  .object({
    position: attributedPoint3Schema,
    rotationMilliDegrees: attributedValueSchema(modelAngleMilliDegreesSchema),
  })
  .strict();
const boundingDimensionsSchema = z
  .object({
    depthMm: modelDimensionMmSchema,
    heightMm: modelDimensionMmSchema,
    widthMm: modelDimensionMmSchema,
  })
  .strict();

export const modelFixedObjectSchema = z
  .object({
    ...elementCoreShape,
    category: attributedStringSchema,
    dimensions: attributedValueSchema(boundingDimensionsSchema),
    elementType: z.literal("fixed-object"),
    levelId: modelElementIdSchema,
    placement: placementSchema,
  })
  .strict();

export const modelFurnishingSchema = z
  .object({
    ...elementCoreShape,
    category: attributedStringSchema,
    dimensions: attributedValueSchema(boundingDimensionsSchema),
    elementType: z.literal("furnishing"),
    levelId: modelElementIdSchema,
    placement: placementSchema,
  })
  .strict();

export const modelFinishSchema = z
  .object({
    ...elementCoreShape,
    elementType: z.literal("finish"),
    face: z.enum(["top", "bottom", "inside", "outside", "all", "unspecified"]),
    material: attributedStringSchema,
    targetElementId: modelElementIdSchema,
  })
  .strict();

export const modelLightSchema = z
  .object({
    ...elementCoreShape,
    colourTemperatureKelvin: attributedIntegerSchema,
    elementType: z.literal("light"),
    kind: z.enum(["point", "spot", "linear", "area", "daylight-reference"]),
    levelId: modelElementIdSchema,
    luminousFluxLumens: attributedIntegerSchema,
    position: attributedPoint3Schema,
  })
  .strict();

export const modelCameraSchema = z
  .object({
    ...elementCoreShape,
    elementType: z.literal("camera"),
    levelId: modelElementIdSchema,
    position: attributedPoint3Schema,
    target: attributedPoint3Schema,
    verticalFovMilliDegrees: attributedValueSchema(z.int().min(1_000).max(179_000)),
  })
  .strict();

export const canonicalModelElementsSchema = z
  .object({
    cameras: z.array(modelCameraSchema).max(1_000),
    finishes: z.array(modelFinishSchema).max(20_000),
    fixedObjects: z.array(modelFixedObjectSchema).max(20_000),
    furnishings: z.array(modelFurnishingSchema).max(20_000),
    levels: z.array(modelLevelSchema).min(1).max(100),
    lights: z.array(modelLightSchema).max(20_000),
    openings: z.array(modelOpeningSchema).max(20_000),
    spaces: z.array(modelSpaceSchema).max(20_000),
    stairs: z.array(modelStairSchema).max(2_000),
    surfaces: z.array(modelSurfaceSchema).max(40_000),
    walls: z.array(modelWallSchema).max(40_000),
  })
  .strict();

export const localCoordinateSystemSchema = z
  .object({
    axes: z.object({ x: z.literal("east"), y: z.literal("north"), z: z.literal("up") }).strict(),
    globalAnchor: z.discriminatedUnion("status", [
      z.object({ status: z.literal("not-established") }).strict(),
      z
        .object({
          attribution: knownAttributionSchema,
          crs: z.literal("EPSG:27700"),
          eastingMm: z.int().min(-100_000_000).max(1_000_000_000),
          northingMm: z.int().min(-100_000_000).max(2_000_000_000),
          status: z.literal("established"),
        })
        .strict(),
    ]),
    handedness: z.literal("right"),
    kind: z.literal("local-cartesian"),
    lengthUnit: z.literal("mm"),
    originConvention: z.literal("project-local-model-origin"),
  })
  .strict();

export const canonicalHomeSnapshotSchema = z
  .object({
    coordinateSystem: localCoordinateSystemSchema,
    derivedFromSnapshotSha256: sha256HexSchema.optional(),
    elements: canonicalModelElementsSchema,
    knownLimitations: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
            detail: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    modelId: modelIdSchema,
    profile: modelProfileSchema,
    projectId: projectIdSchema,
    propertyId: propertyIdSchema.optional(),
    schemaVersion: z.literal(c4SchemaVersion),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const collections = Object.values(snapshot.elements).flat();
    const ids = new Set<string>();
    collections.forEach((element, index) => {
      if (ids.has(element.id)) {
        context.addIssue({
          code: "custom",
          message: "Element IDs must be unique across every canonical collection.",
          path: ["elements", index, "id"],
        });
      }
      ids.add(element.id);
    });
    if (snapshot.profile === "existing" && snapshot.derivedFromSnapshotSha256 !== undefined) {
      context.addIssue({
        code: "custom",
        message:
          "The existing profile cannot claim derivation from a proposed or as-built snapshot.",
        path: ["derivedFromSnapshotSha256"],
      });
    }
    if (snapshot.profile !== "existing" && snapshot.derivedFromSnapshotSha256 === undefined) {
      context.addIssue({
        code: "custom",
        message: "Proposed and as-built profiles require an explicit source snapshot hash.",
        path: ["derivedFromSnapshotSha256"],
      });
    }
  });
export type CanonicalHomeSnapshot = z.infer<typeof canonicalHomeSnapshotSchema>;

export const createModelSnapshotRequestSchema = z
  .object({
    expectedCurrentSnapshotSha256: z.union([sha256HexSchema, z.null()]),
    snapshot: canonicalHomeSnapshotSchema,
  })
  .strict();

export const modelSnapshotRecordSchema = z
  .object({
    canonicalByteLength: z.int().positive().max(10_485_760),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: userIdSchema,
    id: modelSnapshotIdSchema,
    modelId: modelIdSchema,
    profile: modelProfileSchema,
    projectId: projectIdSchema,
    schemaVersion: z.literal(c4SchemaVersion),
    snapshot: canonicalHomeSnapshotSchema,
    snapshotSha256: sha256HexSchema,
    version: z.int().positive(),
  })
  .strict();
export type ModelSnapshotRecord = z.infer<typeof modelSnapshotRecordSchema>;

export const modelProfileSummarySchema = z.discriminatedUnion("status", [
  z
    .object({
      profile: modelProfileSchema,
      status: z.literal("empty"),
    })
    .strict(),
  z
    .object({
      currentSnapshotId: modelSnapshotIdSchema,
      currentSnapshotSha256: sha256HexSchema,
      modelId: modelIdSchema,
      profile: modelProfileSchema,
      status: z.literal("available"),
      updatedAt: z.iso.datetime({ offset: true }),
      version: z.int().positive(),
    })
    .strict(),
]);

export const modelProfilesResponseSchema = z
  .object({
    profiles: z.array(modelProfileSummarySchema).length(3),
    projectId: projectIdSchema,
  })
  .strict()
  .superRefine((response, context) => {
    for (const profile of modelProfileSchema.options) {
      if (response.profiles.filter((summary) => summary.profile === profile).length !== 1) {
        context.addIssue({
          code: "custom",
          message: `Profile summaries must contain exactly one ${profile} entry.`,
          path: ["profiles"],
        });
      }
    }
  });

export const c4RouteContract = Object.freeze({
  createSnapshot: "/v1/projects/:projectId/models/:profile/snapshots",
  getCurrentProfile: "/v1/projects/:projectId/models/:profile",
  getSnapshot: "/v1/projects/:projectId/models/:profile/snapshots/:snapshotId",
  listProfiles: "/v1/projects/:projectId/models",
});
