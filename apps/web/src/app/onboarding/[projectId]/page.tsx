import type { Metadata } from "next";

import { IntakeScreen } from "../../../features/onboarding/intake-screen";

export const metadata: Metadata = {
  title: "Home intake",
};

export default async function IntakePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <IntakeScreen projectId={projectId} />;
}
