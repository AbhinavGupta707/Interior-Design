export function homeJourneyHref(projectId: string): string {
  return `/home/${encodeURIComponent(projectId)}`;
}
