import { sceneJobIdSchema } from "@interior-design/contracts";
import { z } from "zod";

import type { RenderCapabilities } from "./contracts";

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

export function selectRenderLaunchSource(
  sources: RenderCapabilities["sources"],
  context?: RenderLaunchContext,
) {
  const source = context
    ? sources.find(({ sourceSceneJobId }) => sourceSceneJobId === context.sourceSceneJobId)
    : sources[0];

  if (!source) {
    return undefined;
  }

  const specification = context?.specificationId
    ? source.specifications.find(
        ({ specificationId, specificationRevision }) =>
          specificationId === context.specificationId &&
          specificationRevision === context.specificationRevision,
      )
    : source.specifications[0];

  if (context?.specificationId && !specification) {
    return undefined;
  }

  return { source, specification };
}

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
