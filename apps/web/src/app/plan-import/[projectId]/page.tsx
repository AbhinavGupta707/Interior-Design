import type { Metadata } from "next";

import { PlanImportWorkspace } from "../../../features/plan-import/plan-import-workspace";

export const metadata: Metadata = {
  title: "Floor-plan correction · Home Design Studio",
};

export default async function PlanImportPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  return <PlanImportWorkspace projectId={(await params).projectId} />;
}
