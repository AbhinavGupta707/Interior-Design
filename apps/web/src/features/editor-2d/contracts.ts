import type { modelBranchComparisonSchema } from "@interior-design/contracts";
import { modelBranchSchema, modelSnapshotRecordSchema } from "@interior-design/contracts";
import { z } from "zod";

export const editorBranchWorkspaceSchema = z
  .object({
    branch: modelBranchSchema,
    headSnapshot: modelSnapshotRecordSchema,
    sourceSnapshot: modelSnapshotRecordSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    if (
      workspace.headSnapshot.id !== workspace.branch.headSnapshotId ||
      workspace.headSnapshot.snapshotSha256 !== workspace.branch.headSnapshotSha256
    ) {
      context.addIssue({
        code: "custom",
        message: "The loaded head snapshot must match the exact branch head.",
        path: ["headSnapshot"],
      });
    }
    if (workspace.sourceSnapshot.id !== workspace.branch.sourceSnapshotId) {
      context.addIssue({
        code: "custom",
        message: "The loaded source snapshot must match the exact branch source.",
        path: ["sourceSnapshot"],
      });
    }
  });

export type EditorBranchWorkspace = z.infer<typeof editorBranchWorkspaceSchema>;
export type EditorBranchComparison = z.infer<typeof modelBranchComparisonSchema>;
