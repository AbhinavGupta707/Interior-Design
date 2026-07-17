import {
  assetSchema,
  projectSchema,
  reconstructionJobSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

const imageMimeTypes = new Set(["image/heic", "image/jpeg", "image/png"]);
const videoMimeTypes = new Set(["video/mp4", "video/quicktime"]);

export const readyReconstructionAssetSchema = assetSchema.refine(
  (asset) =>
    asset.status === "ready" &&
    asset.rights.trainingUseConsent === "denied" &&
    ((asset.kind === "photograph" && imageMimeTypes.has(asset.detectedMimeType ?? "")) ||
      (asset.kind === "video" && videoMimeTypes.has(asset.detectedMimeType ?? ""))),
  "Only ready, rights-cleared C2 photos and videos are eligible.",
);

export type ReadyReconstructionAsset = z.infer<typeof readyReconstructionAssetSchema>;

export const reconstructionRuntimeCapabilitySchema = z.enum(["available", "unavailable"]);

export const reconstructionWorkspaceSchema = z
  .object({
    assets: z.array(readyReconstructionAssetSchema).max(512),
    capabilities: z
      .object({
        appearanceProvider: reconstructionRuntimeCapabilitySchema,
        geometryWorker: reconstructionRuntimeCapabilitySchema,
        gpu: reconstructionRuntimeCapabilitySchema,
      })
      .strict(),
    jobs: z.array(reconstructionJobSchema).max(100),
    project: projectSchema,
    session: sessionSchema,
  })
  .strict();

export type ReconstructionWorkspace = z.infer<typeof reconstructionWorkspaceSchema>;

export const listReconstructionJobsResponseSchema = z
  .object({ jobs: z.array(reconstructionJobSchema).max(100) })
  .strict();

export const transitionReconstructionJobRequestSchema = z
  .object({ expectedVersion: z.int().positive() })
  .strict();
