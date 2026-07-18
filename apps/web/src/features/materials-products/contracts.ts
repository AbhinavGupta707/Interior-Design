import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  c13CatalogPolicy,
  projectSchema,
  sessionSchema,
  specificationLineSchema,
  specificationRevisionSchema,
  specificationSchema,
  substitutionConfirmationSchema,
} from "@interior-design/contracts";
import { z } from "zod";

const signedCatalogArtifactUrlSchema = z
  .url()
  .max(8_192)
  .refine((value) => {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback))
    );
  }, "Catalog artifact access URLs require HTTPS except on loopback and cannot embed credentials or fragments.");

export const catalogEvidenceClassificationSchema = z.enum([
  "production-composed",
  "synthetic-fixture",
]);

export const catalogFiltersSchema = z
  .object({
    cursor: z.string().trim().min(1).max(512).optional(),
    kind: z.enum(["all", "furnishing", "finish", "light"]).default("all"),
    pageSize: z.int().min(1).max(24).default(9),
    query: z.string().trim().max(120).default(""),
    rights: z.enum(["all", "approved", "withdrawn", "expired"]).default("all"),
    source: z.enum(["all", "creator-owned-synthetic", "licensed-local"]).default("all"),
  })
  .strict();

export const catalogReleaseListSchema = z
  .object({ releases: z.array(catalogReleaseSchema).max(512) })
  .strict();

export const catalogAssetPageSchema = z
  .object({
    assets: z.array(catalogAssetVersionSchema).max(24),
    nextCursor: z.string().trim().min(1).max(512).optional(),
    releaseId: z.uuid(),
    total: z.int().nonnegative().max(512),
  })
  .strict();

export const catalogArtifactResponseSchema = z
  .object({
    artifactId: z.uuid(),
    byteLength: z.int().positive().max(c13CatalogPolicy.maximumArtifactBytesPerAsset),
    expiresAt: z.iso.datetime({ offset: true }),
    mediaType: z.enum(["model/gltf-binary", "image/png", "text/plain; charset=utf-8"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    url: signedCatalogArtifactUrlSchema,
  })
  .strict();

export const specificationListSchema = z
  .object({
    projectId: z.uuid(),
    specifications: z.array(specificationSchema).max(128),
  })
  .strict();

export const specificationRevisionListSchema = z
  .object({
    revisions: z.array(specificationRevisionSchema).max(1_024),
    specificationId: z.uuid(),
  })
  .strict();

export const specificationScheduleLinesSchema = z
  .object({
    lines: z.array(specificationLineSchema).max(1_024),
    revision: z.int().positive(),
    specificationId: z.uuid(),
  })
  .strict();

export const sceneRequestStateSchema = z.enum(["requested", "retry-required"]);

export const substitutionConfirmationResultSchema = z
  .object({
    confirmation: substitutionConfirmationSchema,
    sceneRequestState: sceneRequestStateSchema,
  })
  .strict();

export const sceneJobRequestSchema = z.object({ sceneJobId: z.uuid() }).strict();
export const sceneJobRequestResponseSchema = z.object({ sceneJobId: z.uuid() }).strict();

export const materialsProductsWorkspaceSchema = z
  .object({
    evidenceClassification: catalogEvidenceClassificationSchema,
    project: projectSchema,
    releases: catalogReleaseListSchema,
    session: sessionSchema,
    specifications: specificationListSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    if (workspace.project.id !== workspace.specifications.projectId) {
      context.addIssue({
        code: "custom",
        message: "Specifications must belong to the requested project.",
        path: ["specifications", "projectId"],
      });
    }
    if (workspace.project.tenantId !== workspace.session.actor.tenantId) {
      context.addIssue({
        code: "custom",
        message: "The session and project tenant do not match.",
        path: ["session", "actor", "tenantId"],
      });
    }
  });

export const materialsProductsRecoverySchema = z
  .object({
    candidateAssetVersionId: z.uuid().optional(),
    projectId: z.uuid(),
    savedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal("c13-materials-products-recovery-v1"),
    selectedLineId: z.uuid().optional(),
    specificationId: z.uuid(),
  })
  .strict();

export const materialsProductsLaunchContextSchema = z.object({ confirmationId: z.uuid() }).strict();

export type CatalogAssetPage = z.infer<typeof catalogAssetPageSchema>;
export type CatalogEvidenceClassification = z.infer<typeof catalogEvidenceClassificationSchema>;
export type CatalogFilters = z.infer<typeof catalogFiltersSchema>;
export type MaterialsProductsRecovery = z.infer<typeof materialsProductsRecoverySchema>;
export type MaterialsProductsLaunchContext = z.infer<typeof materialsProductsLaunchContextSchema>;
export type MaterialsProductsWorkspaceData = z.infer<typeof materialsProductsWorkspaceSchema>;
export type SpecificationScheduleLines = z.infer<typeof specificationScheduleLinesSchema>;
export type SceneJobRequestResponse = z.infer<typeof sceneJobRequestResponseSchema>;
export type SceneRequestState = z.infer<typeof sceneRequestStateSchema>;
export type SubstitutionConfirmationResult = z.infer<typeof substitutionConfirmationResultSchema>;

export function evidenceClassificationFromEnvironment(
  value: string | undefined,
): CatalogEvidenceClassification {
  return value === "synthetic-fixture" ? "synthetic-fixture" : "production-composed";
}
