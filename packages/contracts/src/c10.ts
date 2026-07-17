import { z } from "zod";

import {
  c4SchemaVersion,
  modelElementIdSchema,
  modelIdSchema,
  modelProfileSchema,
  modelSnapshotIdSchema,
} from "./c4.js";

export const c10SceneJobSchemaVersion = "c10-scene-job-v1" as const;
export const c10SceneManifestSchemaVersion = "c10-scene-manifest-v1" as const;
export const c10SceneArtifactSchemaVersion = "c10-scene-artifact-v1" as const;

export const c10ScenePolicy = Object.freeze({
  accessTtlSeconds: 300,
  maximumArtifactBytes: 52_428_800,
  maximumAttempts: 3,
  maximumElementMappings: 100_000,
  maximumFindings: 10_000,
  maximumMaterials: 1_024,
  maximumNodes: 100_000,
  maximumTriangles: 2_000_000,
  maximumVertices: 4_000_000,
  workerTimeoutMilliseconds: 600_000,
} as const);

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const safeVersionSchema = z.string().trim().min(1).max(100);

export const sceneJobIdSchema = uuidSchema;
export const sceneIdSchema = uuidSchema;
export const sceneArtifactIdSchema = uuidSchema;

export const sceneSnapshotReferenceSchema = z
  .object({
    modelId: modelIdSchema,
    profile: modelProfileSchema,
    projectId: uuidSchema,
    schemaVersion: z.literal(c4SchemaVersion),
    snapshotId: modelSnapshotIdSchema,
    snapshotSha256: sha256HexSchema,
  })
  .strict();
export type SceneSnapshotReference = z.infer<typeof sceneSnapshotReferenceSchema>;

export const sceneCompileConfigurationSchema = z
  .object({
    coordinateMapping: z.literal("c4-z-up-to-gltf-y-up-v1"),
    geometryMode: z.literal("parametric-v1"),
    materialMode: z.literal("status-aware-neutral-v1"),
    purpose: z.literal("interactive-browser"),
    unknownGeometryPolicy: z.literal("omit-and-report"),
  })
  .strict();
export type SceneCompileConfiguration = z.infer<typeof sceneCompileConfigurationSchema>;

export const c10DefaultCompileConfiguration: SceneCompileConfiguration = Object.freeze({
  coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
  geometryMode: "parametric-v1",
  materialMode: "status-aware-neutral-v1",
  purpose: "interactive-browser",
  unknownGeometryPolicy: "omit-and-report",
});

export const createSceneJobRequestSchema = z
  .object({
    configuration: sceneCompileConfigurationSchema,
    label: z.string().trim().min(1).max(120),
    sourceSnapshot: sceneSnapshotReferenceSchema,
  })
  .strict();
export type CreateSceneJobRequest = z.infer<typeof createSceneJobRequestSchema>;

export const sceneJobStateSchema = z.enum([
  "queued",
  "leased",
  "compiling",
  "publishing",
  "succeeded",
  "cancel-requested",
  "cancelled",
  "failed",
]);
export type SceneJobState = z.infer<typeof sceneJobStateSchema>;

export const sceneJobSchema = z
  .object({
    attempt: z.int().positive().max(c10ScenePolicy.maximumAttempts),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: sceneJobIdSchema,
    projectId: uuidSchema,
    request: createSceneJobRequestSchema,
    safeCode: safeCodeSchema.optional(),
    sceneId: sceneIdSchema.optional(),
    state: sceneJobStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.projectId !== job.request.sourceSnapshot.projectId) {
      context.addIssue({
        code: "custom",
        message: "Scene jobs and source snapshots must share one project scope.",
        path: ["request", "sourceSnapshot", "projectId"],
      });
    }
    const hasScene = job.sceneId !== undefined;
    if (hasScene !== (job.state === "succeeded")) {
      context.addIssue({
        code: "custom",
        message: "Only succeeded scene jobs reference a published scene.",
        path: ["sceneId"],
      });
    }
    const hasSafeCode = job.safeCode !== undefined;
    if (hasSafeCode !== (job.state === "failed")) {
      context.addIssue({
        code: "custom",
        message: "Only failed scene jobs carry a safe error code.",
        path: ["safeCode"],
      });
    }
  });
export type SceneJob = z.infer<typeof sceneJobSchema>;

export const sceneFindingSchema = z
  .object({
    affectedElementIds: z.array(modelElementIdSchema).max(256),
    code: safeCodeSchema,
    detail: z.string().trim().min(1).max(500),
    severity: z.enum(["information", "warning", "error"]),
  })
  .strict();
export type SceneFinding = z.infer<typeof sceneFindingSchema>;

const sceneBoundsPointMmSchema = z
  .object({
    xMm: z.int().min(-10_000_000).max(10_000_000),
    yMm: z.int().min(-10_000_000).max(10_000_000),
    zMm: z.int().min(-10_000_000).max(10_000_000),
  })
  .strict();

export const sceneBoundsMmSchema = z
  .object({ maximum: sceneBoundsPointMmSchema, minimum: sceneBoundsPointMmSchema })
  .strict()
  .superRefine((bounds, context) => {
    for (const axis of ["xMm", "yMm", "zMm"] as const) {
      if (bounds.minimum[axis] > bounds.maximum[axis]) {
        context.addIssue({
          code: "custom",
          message: "Scene minimum bounds cannot exceed maximum bounds.",
          path: ["minimum", axis],
        });
      }
    }
  });

export const sceneElementMappingSchema = z
  .object({
    elementId: modelElementIdSchema,
    elementType: z.enum([
      "level",
      "space",
      "surface",
      "wall",
      "opening",
      "stair",
      "fixed-object",
      "furnishing",
      "finish",
      "light",
      "camera",
    ]),
    findingCodes: z.array(safeCodeSchema).max(100),
    materialIndices: z.array(z.int().nonnegative()).max(100),
    meshIndices: z.array(z.int().nonnegative()).max(100),
    nodeIndices: z.array(z.int().nonnegative()).max(100),
    status: z.enum(["mapped", "omitted"]),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (
      mapping.status === "mapped" &&
      mapping.nodeIndices.length === 0 &&
      mapping.meshIndices.length === 0 &&
      mapping.materialIndices.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Mapped elements require at least one GLB object index.",
      });
    }
    if (
      mapping.status === "omitted" &&
      (mapping.nodeIndices.length > 0 ||
        mapping.meshIndices.length > 0 ||
        mapping.materialIndices.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Omitted elements cannot reference GLB objects.",
      });
    }
    if (mapping.status === "omitted" && mapping.findingCodes.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Omitted elements require an explicit finding code.",
      });
    }
  });
export type SceneElementMapping = z.infer<typeof sceneElementMappingSchema>;

export const sceneManifestSchema = z
  .object({
    authority: z.literal("derived-visualisation-only"),
    boundsMm: sceneBoundsMmSchema,
    compiler: z
      .object({
        configuration: sceneCompileConfigurationSchema,
        configurationSha256: sha256HexSchema,
        name: z.literal("interior-design-scene-compiler"),
        version: safeVersionSchema,
      })
      .strict(),
    coordinateSystem: z
      .object({
        canonicalAxes: z.literal("+X east, +Y north, +Z up"),
        gltfAxes: z.literal("+Y up, +Z forward, right-handed"),
        mapping: z.literal("[Xmm/1000, Zmm/1000, -Ymm/1000]"),
        outputLengthUnit: z.literal("metre"),
      })
      .strict(),
    counts: z
      .object({
        materials: z.int().nonnegative().max(c10ScenePolicy.maximumMaterials),
        meshes: z.int().nonnegative().max(c10ScenePolicy.maximumNodes),
        nodes: z.int().nonnegative().max(c10ScenePolicy.maximumNodes),
        triangles: z.int().nonnegative().max(c10ScenePolicy.maximumTriangles),
        vertices: z.int().nonnegative().max(c10ScenePolicy.maximumVertices),
      })
      .strict(),
    determinismKeySha256: sha256HexSchema,
    elementMappings: z.array(sceneElementMappingSchema).max(c10ScenePolicy.maximumElementMappings),
    findings: z.array(sceneFindingSchema).max(c10ScenePolicy.maximumFindings),
    gltf: z
      .object({ container: z.literal("GLB"), specificationVersion: z.literal("2.0") })
      .strict(),
    schemaVersion: z.literal(c10SceneManifestSchemaVersion),
    sourceSnapshot: sceneSnapshotReferenceSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const elementIds = manifest.elementMappings.map(({ elementId }) => elementId);
    if (new Set(elementIds).size !== elementIds.length) {
      context.addIssue({ code: "custom", message: "Scene element mappings must be unique." });
    }
    const nodeIndices = manifest.elementMappings.flatMap(({ nodeIndices }) => nodeIndices);
    if (new Set(nodeIndices).size !== nodeIndices.length) {
      context.addIssue({
        code: "custom",
        message: "A GLB node can map to only one canonical element.",
      });
    }
    const findingCodes = new Set(manifest.findings.map(({ code }) => code));
    manifest.elementMappings.forEach((mapping, mappingIndex) => {
      for (const nodeIndex of mapping.nodeIndices) {
        if (nodeIndex >= manifest.counts.nodes) {
          context.addIssue({
            code: "custom",
            message: "Element mappings cannot reference a missing GLB node.",
            path: ["elementMappings", mappingIndex, "nodeIndices"],
          });
        }
      }
      for (const meshIndex of mapping.meshIndices) {
        if (meshIndex >= manifest.counts.meshes) {
          context.addIssue({
            code: "custom",
            message: "Element mappings cannot reference a missing GLB mesh.",
            path: ["elementMappings", mappingIndex, "meshIndices"],
          });
        }
      }
      for (const materialIndex of mapping.materialIndices) {
        if (materialIndex >= manifest.counts.materials) {
          context.addIssue({
            code: "custom",
            message: "Element mappings cannot reference a missing GLB material.",
            path: ["elementMappings", mappingIndex, "materialIndices"],
          });
        }
      }
      for (const findingCode of mapping.findingCodes) {
        if (!findingCodes.has(findingCode)) {
          context.addIssue({
            code: "custom",
            message: "Element mappings may reference only included scene findings.",
            path: ["elementMappings", mappingIndex, "findingCodes"],
          });
        }
      }
    });
  });
export type SceneManifest = z.infer<typeof sceneManifestSchema>;

export const sceneArtifactSchema = z
  .object({
    byteSize: z.int().positive().max(c10ScenePolicy.maximumArtifactBytes),
    glbSha256: sha256HexSchema,
    id: sceneArtifactIdSchema,
    manifestSha256: sha256HexSchema,
    mimeType: z.literal("model/gltf-binary"),
    schemaVersion: z.literal(c10SceneArtifactSchemaVersion),
  })
  .strict();
export type SceneArtifact = z.infer<typeof sceneArtifactSchema>;

export const sceneRecordSchema = z
  .object({
    artifact: sceneArtifactSchema,
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: sceneIdSchema,
    manifest: sceneManifestSchema,
    projectId: uuidSchema,
  })
  .strict()
  .superRefine((scene, context) => {
    if (scene.projectId !== scene.manifest.sourceSnapshot.projectId) {
      context.addIssue({
        code: "custom",
        message: "Published scenes and source snapshots must share one project scope.",
        path: ["manifest", "sourceSnapshot", "projectId"],
      });
    }
  });
export type SceneRecord = z.infer<typeof sceneRecordSchema>;

const signedSceneUrlSchema = z
  .url()
  .max(8_192)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    );
  }, "Scene access URLs require HTTPS except on loopback development hosts.");

export const sceneAccessResponseSchema = z
  .object({
    byteSize: z.int().positive().max(c10ScenePolicy.maximumArtifactBytes),
    expiresAt: z.iso.datetime({ offset: true }),
    glbSha256: sha256HexSchema,
    manifestSha256: sha256HexSchema,
    mimeType: z.literal("model/gltf-binary"),
    sceneId: sceneIdSchema,
    url: signedSceneUrlSchema,
  })
  .strict();
export type SceneAccessResponse = z.infer<typeof sceneAccessResponseSchema>;

export const c10RouteContract = Object.freeze({
  cancelJob: "/v1/projects/:projectId/scene-jobs/:sceneJobId/cancel",
  createJob: "/v1/projects/:projectId/scene-jobs",
  createSceneAccess: "/v1/projects/:projectId/scene-jobs/:sceneJobId/scene/access",
  getJob: "/v1/projects/:projectId/scene-jobs/:sceneJobId",
  getScene: "/v1/projects/:projectId/scene-jobs/:sceneJobId/scene",
  listJobs: "/v1/projects/:projectId/scene-jobs",
  retryJob: "/v1/projects/:projectId/scene-jobs/:sceneJobId/retry",
});
