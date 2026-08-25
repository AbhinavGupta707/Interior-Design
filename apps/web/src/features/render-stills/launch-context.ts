import { sceneJobIdSchema } from "@interior-design/contracts";
import { z } from "zod";

export const renderLaunchContextSchema = z
  .object({
    sourceSceneJobId: sceneJobIdSchema,
    specificationId: z.uuid().optional(),
    specificationRevision: z.coerce.number().int().positive().max(999_999_999).optional(),
  })
  .strict()
  .refine(
    ({ specificationId, specificationRevision }) =>
      (specificationId === undefined) === (specificationRevision === undefined),
    {
      message: "Specification identity and revision must be supplied together.",
      path: ["specificationId"],
    },
  );

export type RenderLaunchContext = z.infer<typeof renderLaunchContextSchema>;

export function renderStillsLaunchHref(projectId: string, context: RenderLaunchContext): string {
  const parsed = renderLaunchContextSchema.parse(context);
  return `/render-stills/${encodeURIComponent(projectId)}?${new URLSearchParams({
    sourceSceneJobId: parsed.sourceSceneJobId,
    ...(parsed.specificationId ? { specificationId: parsed.specificationId } : {}),
    ...(parsed.specificationRevision
      ? { specificationRevision: String(parsed.specificationRevision) }
      : {}),
  }).toString()}`;
}
