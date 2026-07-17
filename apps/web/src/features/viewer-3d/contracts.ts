import {
  projectSchema,
  sceneJobSchema,
  sceneSnapshotReferenceSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

export const sceneJobsResponseSchema = z
  .object({ jobs: z.array(sceneJobSchema).max(100) })
  .strict();

export const sceneTransitionRequestSchema = z
  .object({ expectedVersion: z.int().positive() })
  .strict();

export const sceneAccessRequestSchema = z.object({}).strict();

export const viewerEvidenceClassificationSchema = z.enum(["real-backend", "fixture-presentation"]);

export const sceneWorkspaceSchema = z
  .object({
    evidenceClassification: viewerEvidenceClassificationSchema,
    jobs: z.array(sceneJobSchema).max(100),
    project: projectSchema,
    session: sessionSchema,
    snapshots: z.array(sceneSnapshotReferenceSchema).max(3),
  })
  .strict()
  .superRefine((workspace, context) => {
    if (workspace.project.tenantId !== workspace.session.actor.tenantId) {
      context.addIssue({
        code: "custom",
        message: "The project and session must share one tenant scope.",
        path: ["project", "tenantId"],
      });
    }
    workspace.jobs.forEach((job, index) => {
      if (job.projectId !== workspace.project.id) {
        context.addIssue({
          code: "custom",
          message: "Scene jobs must match the requested project.",
          path: ["jobs", index, "projectId"],
        });
      }
    });
    workspace.snapshots.forEach((snapshot, index) => {
      if (snapshot.projectId !== workspace.project.id) {
        context.addIssue({
          code: "custom",
          message: "Scene source snapshots must match the requested project.",
          path: ["snapshots", index, "projectId"],
        });
      }
    });
  });

export type SceneWorkspace = z.infer<typeof sceneWorkspaceSchema>;
export type ViewerEvidenceClassification = z.infer<typeof viewerEvidenceClassificationSchema>;
