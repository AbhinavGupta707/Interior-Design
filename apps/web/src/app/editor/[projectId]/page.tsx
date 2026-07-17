import { projectIdSchema } from "@interior-design/contracts";
import { notFound } from "next/navigation";

import { EditorWorkspace } from "../../../features/editor-2d/editor-workspace";

interface EditorPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function EditorPage({ params }: EditorPageProps) {
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) notFound();
  return <EditorWorkspace projectId={projectId.data} />;
}
