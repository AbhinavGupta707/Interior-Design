import { sceneJobIdSchema } from "@interior-design/contracts";

export type ViewerSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export function exactSceneJobFromSearchParams(params: ViewerSearchParams): string | undefined {
  const candidate = params.jobId;
  if (typeof candidate !== "string") return undefined;
  const parsed = sceneJobIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function exactSceneJobHref(projectId: string, sceneJobId: string): string {
  return `/viewer/${encodeURIComponent(projectId)}?${new URLSearchParams({ jobId: sceneJobId }).toString()}`;
}

export function selectedSceneJobId(
  jobs: readonly Readonly<{ readonly id: string }>[],
  currentJobId: string | undefined,
  exactJobId: string | undefined,
): string | undefined {
  if (currentJobId !== undefined && jobs.some(({ id }) => id === currentJobId)) {
    return currentJobId;
  }
  if (exactJobId !== undefined && jobs.some(({ id }) => id === exactJobId)) return exactJobId;
  return jobs[0]?.id;
}
