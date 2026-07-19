import type { Metadata } from "next";

import {
  renderDeepLinkSchema,
  renderEvidenceClassificationFromEnvironment,
} from "../../../features/render-stills/contracts";
import { RenderStillsWorkspace } from "../../../features/render-stills/render-stills-workspace";

export const metadata: Metadata = {
  title: "Render stills · Home Design Studio",
};

export default async function RenderStillsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly jobId?: string | readonly string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const value = Array.isArray(query.jobId) ? undefined : query.jobId;
  const parsed = renderDeepLinkSchema.safeParse(value ? { jobId: value } : {});
  return (
    <RenderStillsWorkspace
      evidenceClassification={renderEvidenceClassificationFromEnvironment(
        process.env.C14_RENDER_EVIDENCE_CLASSIFICATION,
      )}
      {...(parsed.success ? { initialJobId: parsed.data.jobId } : {})}
      invalidDeepLink={Boolean(value) && !parsed.success}
      projectId={projectId}
    />
  );
}
