import type { Metadata } from "next";

import { ReconstructionWorkspace } from "../../../features/reconstruction/reconstruction-workspace";

export const metadata: Metadata = {
  title: "Media reconstruction · Home Design Studio",
};

export default async function ReconstructionPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  return <ReconstructionWorkspace projectId={(await params).projectId} />;
}
