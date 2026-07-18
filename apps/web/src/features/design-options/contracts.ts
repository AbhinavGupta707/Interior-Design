import {
  createOptionJobRequestSchema,
  listOptionJobsResponseSchema,
  projectSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

export const designOptionEvidenceClassificationSchema = z.enum([
  "production-composed",
  "synthetic-fixture",
]);

export const designOptionsWorkspaceSchema = z
  .object({
    evidenceClassification: designOptionEvidenceClassificationSchema,
    jobs: listOptionJobsResponseSchema,
    project: projectSchema,
    session: sessionSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    if (workspace.jobs.projectId !== workspace.project.id) {
      context.addIssue({
        code: "custom",
        message: "The option jobs do not belong to the requested project.",
        path: ["jobs", "projectId"],
      });
    }
    if (workspace.project.tenantId !== workspace.session.actor.tenantId) {
      context.addIssue({
        code: "custom",
        message: "The project and session tenant do not match.",
        path: ["project", "tenantId"],
      });
    }
  });

export const designOptionRecoverySchema = z
  .object({
    leftOptionId: z.uuid().optional(),
    projectId: z.uuid(),
    rightOptionId: z.uuid().optional(),
    savedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal("c12-design-options-recovery-v1"),
    selectedJobId: z.uuid(),
  })
  .strict()
  .refine(
    ({ leftOptionId, rightOptionId }) =>
      leftOptionId === undefined || rightOptionId === undefined || leftOptionId !== rightOptionId,
    {
      message: "Recovered comparison selections must be different.",
      path: ["rightOptionId"],
    },
  );

export const designOptionLaunchContextSchema = createOptionJobRequestSchema;

export type DesignOptionEvidenceClassification = z.infer<
  typeof designOptionEvidenceClassificationSchema
>;
export type DesignOptionLaunchContext = z.infer<typeof designOptionLaunchContextSchema>;
export type DesignOptionRecovery = z.infer<typeof designOptionRecoverySchema>;
export type DesignOptionsWorkspace = z.infer<typeof designOptionsWorkspaceSchema>;

export function evidenceClassificationFromEnvironment(
  value: string | undefined,
): DesignOptionEvidenceClassification {
  return value === "synthetic-fixture" ? "synthetic-fixture" : "production-composed";
}
