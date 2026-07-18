import type { Metadata } from "next";

import { ViewerWorkspace } from "../../../features/viewer-3d/viewer-workspace";
import {
  exactSceneJobFromSearchParams,
  type ViewerSearchParams,
} from "../../../features/viewer-3d/deep-link";

export const metadata: Metadata = {
  title: "3D walkthrough · Home Design Studio",
};

export default async function ViewerPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<ViewerSearchParams>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const initialJobId = exactSceneJobFromSearchParams(query);
  return (
    <ViewerWorkspace
      {...(initialJobId === undefined ? {} : { initialJobId })}
      projectId={route.projectId}
    />
  );
}
