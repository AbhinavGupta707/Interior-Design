import type { Metadata } from "next";

import { ViewerWorkspace } from "../../../features/viewer-3d/viewer-workspace";

export const metadata: Metadata = {
  title: "3D walkthrough · Home Design Studio",
};

export default async function ViewerPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  return <ViewerWorkspace projectId={(await params).projectId} />;
}
