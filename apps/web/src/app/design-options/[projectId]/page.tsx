import type { Metadata } from "next";

import { evidenceClassificationFromEnvironment } from "../../../features/design-options/contracts";
import { DesignOptionsWorkspace } from "../../../features/design-options/design-options-workspace";
import { designOptionLaunchContextFromSearchParams } from "../../../features/design-options/launch-context";
import type { DesignOptionSearchParams } from "../../../features/design-options/launch-context";

export const metadata: Metadata = {
  title: "Design options · Home Design Studio",
};

export default async function DesignOptionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<DesignOptionSearchParams>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const launchContext = designOptionLaunchContextFromSearchParams(query);
  return (
    <DesignOptionsWorkspace
      evidenceClassification={evidenceClassificationFromEnvironment(
        process.env.C12_OPTION_EVIDENCE_CLASSIFICATION,
      )}
      {...(launchContext ? { launchContext } : {})}
      projectId={projectId}
    />
  );
}
