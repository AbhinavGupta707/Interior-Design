import {
  fusionDiscrepancyDecisionSchema,
  fusionJobSchema,
  fusionProposalSchema,
  fusionSourceSchema,
  modelBranchSchema,
  modelSnapshotRecordSchema,
  projectSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

export const fusionWorkspaceSourceSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    source: fusionSourceSchema,
    sourceStatus: z.enum(["eligible", "rights-withdrawn", "unsupported"]),
  })
  .strict();

export const fusionWorkspaceSchema = z
  .object({
    baseSnapshot: modelSnapshotRecordSchema.optional(),
    branches: z.array(modelBranchSchema).max(100),
    capabilities: z
      .object({
        geometryProducer: z.enum(["available", "unavailable"]),
        semanticProducer: z.enum(["available", "unavailable"]),
      })
      .strict(),
    jobs: z.array(fusionJobSchema).max(100),
    project: projectSchema,
    session: sessionSchema,
    sources: z.array(fusionWorkspaceSourceSchema).max(32),
  })
  .strict();

export type FusionWorkspace = z.infer<typeof fusionWorkspaceSchema>;
export type FusionWorkspaceSource = z.infer<typeof fusionWorkspaceSourceSchema>;

export const listFusionJobsResponseSchema = z
  .object({ jobs: z.array(fusionJobSchema).max(100) })
  .strict();

export const transitionFusionJobRequestSchema = z
  .object({ expectedVersion: z.int().positive() })
  .strict();

export const fusionReviewResponseSchema = z
  .object({
    decisions: z.array(fusionDiscrepancyDecisionSchema).max(50),
    proposal: fusionProposalSchema,
  })
  .strict();
