import type { Metadata } from "next";

import {
  renderDeepLinkSchema,
  renderEvidenceClassificationFromEnvironment,
} from "../../../features/render-stills/contracts";
import { renderLaunchContextSchema } from "../../../features/render-stills/launch-context";
import { RenderStillsWorkspace } from "../../../features/render-stills/render-stills-workspace";

export const metadata: Metadata = {
  title: "Render stills · Home Design Studio",
};

export default async function RenderStillsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{
    readonly jobId?: string | readonly string[];
    readonly sourceSceneJobId?: string | readonly string[];
    readonly specificationId?: string | readonly string[];
    readonly specificationRevision?: string | readonly string[];
  }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const value = Array.isArray(query.jobId) ? undefined : query.jobId;
  const parsed = renderDeepLinkSchema.safeParse(value ? { jobId: value } : {});
  const launchValues = {
    sourceSceneJobId: Array.isArray(query.sourceSceneJobId) ? undefined : query.sourceSceneJobId,
    specificationId: Array.isArray(query.specificationId) ? undefined : query.specificationId,
    specificationRevision: Array.isArray(query.specificationRevision)
      ? undefined
      : query.specificationRevision,
  };
  const hasLaunchContext = Object.values(launchValues).some((item) => item !== undefined);
  const launch = renderLaunchContextSchema.safeParse(
    Object.fromEntries(Object.entries(launchValues).filter(([, item]) => item !== undefined)),
  );
  return (
    <RenderStillsWorkspace
      evidenceClassification={renderEvidenceClassificationFromEnvironment(
        process.env.C14_RENDER_EVIDENCE_CLASSIFICATION,
      )}
      {...(parsed.success ? { initialJobId: parsed.data.jobId } : {})}
      {...(hasLaunchContext && launch.success ? { launchContext: launch.data } : {})}
      invalidDeepLink={(Boolean(value) && !parsed.success) || (hasLaunchContext && !launch.success)}
      projectId={projectId}
    />
  );
}
