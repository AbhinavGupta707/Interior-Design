import type { Metadata } from "next";

import { PropertyWorkspace } from "../../../features/property/property-workspace";

export const metadata: Metadata = {
  title: "Property dossier",
};

interface PropertyPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function PropertyPage({ params }: PropertyPageProps) {
  return <PropertyWorkspace projectId={(await params).projectId} />;
}
