import type { Metadata } from "next";

import { HomeownerJourney } from "../../../features/homeowner-journey/homeowner-journey";

export const metadata: Metadata = {
  title: "Home journey · Home Design Studio",
};

export default async function HomeJourneyPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  return <HomeownerJourney projectId={(await params).projectId} />;
}
