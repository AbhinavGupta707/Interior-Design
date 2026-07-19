import {
  createRenderJobRequestSchema,
  enhancementResultSchema,
  projectSchema,
  renderArtifactAccessSchema,
  renderArtifactSchema,
  renderEnhancementJobSchema,
  renderJobSchema,
  renderProfileSchema,
  renderResultSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

const boundedLabelSchema = z.string().trim().min(1).max(160);

export const renderEvidenceClassificationSchema = z.enum([
  "production-capability",
  "synthetic-fixture",
]);

export const renderCapabilityStateSchema = z.enum(["available", "deferred", "disabled", "paused"]);

export const renderCapabilitiesSchema = z
  .object({
    enhancementProvider: z
      .object({
        reason: boundedLabelSchema,
        state: renderCapabilityStateSchema,
      })
      .strict(),
    lightingPresets: z
      .array(
        z
          .object({
            label: boundedLabelSchema,
            lightingPresetId: z.literal("canonical-lights-neutral-world-v1"),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    profiles: z
      .array(
        z
          .object({
            label: boundedLabelSchema,
            profileId: renderProfileSchema.shape.profileId,
            reason: boundedLabelSchema.optional(),
            state: renderCapabilityStateSchema,
          })
          .strict(),
      )
      .min(1)
      .max(16),
    renderer: z
      .object({
        hardwareGate: z.enum(["deferred", "not-run", "satisfied"]),
        reason: boundedLabelSchema,
        state: renderCapabilityStateSchema,
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            cameras: z
              .array(z.object({ cameraId: z.uuid(), label: boundedLabelSchema }).strict())
              .min(1)
              .max(64),
            label: boundedLabelSchema,
            sourceSceneJobId: z.uuid(),
            specifications: z
              .array(
                z
                  .object({
                    label: boundedLabelSchema,
                    specificationId: z.uuid(),
                    specificationRevision: z.int().positive().max(999_999_999),
                  })
                  .strict(),
              )
              .max(64),
          })
          .strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((capabilities, context) => {
    const sourceIds = capabilities.sources.map(({ sourceSceneJobId }) => sourceSceneJobId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: "custom", message: "Render sources must be unique." });
    }
    const profileIds = capabilities.profiles.map(({ profileId }) => profileId);
    if (new Set(profileIds).size !== profileIds.length) {
      context.addIssue({ code: "custom", message: "Render profiles must be unique." });
    }
  });

export const listRenderJobsResponseSchema = z
  .object({ jobs: z.array(renderJobSchema).max(100) })
  .strict();

export const renderWorkspaceSchema = z
  .object({
    capabilities: renderCapabilitiesSchema,
    jobs: z.array(renderJobSchema).max(100),
    project: projectSchema,
    session: sessionSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    if (
      workspace.project.tenantId !== workspace.session.actor.tenantId ||
      workspace.jobs.some(({ projectId }) => projectId !== workspace.project.id)
    ) {
      context.addIssue({ code: "custom", message: "Render workspace scope does not match." });
    }
  });

export const transitionRenderJobRequestSchema = z
  .object({ expectedVersion: z.int().positive() })
  .strict();

export const requestEnhancementSchema = z.object({ expectedVersion: z.int().positive() }).strict();

export const renderEnhancementStatusSchema = z.union([
  enhancementResultSchema,
  renderEnhancementJobSchema,
]);

export const renderArtifactSelectionSchema = z.object({ artifact: renderArtifactSchema }).strict();
export const renderDeepLinkSchema = z.object({ jobId: z.uuid() }).strict();

export {
  createRenderJobRequestSchema,
  renderArtifactAccessSchema,
  renderArtifactSchema,
  renderEnhancementJobSchema,
  renderJobSchema,
  renderResultSchema,
};

export type ListRenderJobsResponse = z.infer<typeof listRenderJobsResponseSchema>;
export type RenderArtifactAccess = z.infer<typeof renderArtifactAccessSchema>;
export type RenderCapabilities = z.infer<typeof renderCapabilitiesSchema>;
export type RenderEnhancementJob = z.infer<typeof renderEnhancementJobSchema>;
export type RenderEnhancementStatus = z.infer<typeof renderEnhancementStatusSchema>;
export type RenderEvidenceClassification = z.infer<typeof renderEvidenceClassificationSchema>;
export type RenderWorkspace = z.infer<typeof renderWorkspaceSchema>;

export function renderEvidenceClassificationFromEnvironment(
  value: string | undefined,
): RenderEvidenceClassification {
  return value === "synthetic-fixture" ? "synthetic-fixture" : "production-capability";
}
