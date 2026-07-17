import { EvidenceWorkspace } from "../../../features/evidence/evidence-workspace";

interface EvidencePageProps {
  params: Promise<{ projectId: string }>;
}

export default async function EvidencePage({ params }: EvidencePageProps) {
  return <EvidenceWorkspace projectId={(await params).projectId} />;
}
