import type { Metadata } from "next";

import { FusionWorkspace } from "../../../features/discrepancy-review/fusion-workspace";

export const metadata: Metadata = {
  title: "Model fusion · Home Design Studio",
};

export default async function FusionPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  return <FusionWorkspace projectId={(await params).projectId} />;
}
