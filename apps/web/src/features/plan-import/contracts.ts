import {
  assetSchema,
  listModelBranchesResponseSchema,
  listPlanProcessingJobsResponseSchema,
  projectSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

export const readyPlanAssetSchema = assetSchema.superRefine((asset, context) => {
  const supportedMimeTypes = new Set([
    "application/pdf",
    "image/svg+xml",
    "image/png",
    "image/jpeg",
  ]);
  if (
    asset.kind !== "plan" ||
    asset.status !== "ready" ||
    !asset.detectedMimeType ||
    !supportedMimeTypes.has(asset.detectedMimeType) ||
    asset.source.byteSize > 26_214_400 ||
    asset.rights.trainingUseConsent !== "denied"
  ) {
    context.addIssue({
      code: "custom",
      message: "The asset is outside the frozen C6 ready-plan input box.",
    });
  }
});

export const planImportWorkspaceSchema = z
  .object({
    assets: z.array(readyPlanAssetSchema).max(100),
    branches: listModelBranchesResponseSchema.shape.branches,
    jobs: listPlanProcessingJobsResponseSchema.shape.jobs,
    project: projectSchema,
    session: sessionSchema,
  })
  .strict();

export type PlanImportWorkspace = z.infer<typeof planImportWorkspaceSchema>;

export const planSourcePreviewSchema = z
  .object({
    contentDisposition: z.literal("inline"),
    expiresAt: z.iso.datetime({ offset: true }),
    url: z.url().max(8_192),
  })
  .strict();

export type PlanSourcePreview = z.infer<typeof planSourcePreviewSchema>;
