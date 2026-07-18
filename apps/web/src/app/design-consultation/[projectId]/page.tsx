import type { Metadata } from "next";

import { ConsultationWorkspace } from "../../../features/design-consultation/consultation-workspace";

export const metadata: Metadata = {
  title: "Design consultation · Home Design Studio",
};

export default async function DesignConsultationPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  return <ConsultationWorkspace projectId={(await params).projectId} />;
}
