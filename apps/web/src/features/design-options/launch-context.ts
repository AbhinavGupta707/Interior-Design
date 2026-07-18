import { designOptionLaunchContextSchema } from "./contracts";
import type { DesignOptionLaunchContext } from "./contracts";

export type DesignOptionSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function single(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Narrow hand-off port for an orchestrator-owned accepted-brief/model launch link.
 * Values remain untrusted and are parsed again by the C12 API before the server
 * revalidates the exact brief and model heads.
 */
export function designOptionLaunchContextFromSearchParams(
  searchParams: DesignOptionSearchParams,
): DesignOptionLaunchContext | undefined {
  const directions = single(searchParams.directions)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidate = {
    baseBrief: {
      briefId: single(searchParams.briefId),
      contentSha256: single(searchParams.briefSha256),
      revision: positiveInteger(single(searchParams.briefRevision)),
    },
    requestedDirections: directions,
    requestedOptionCount: positiveInteger(single(searchParams.optionCount)),
    sourceModel: {
      modelId: single(searchParams.modelId),
      profile: single(searchParams.modelProfile),
      snapshotId: single(searchParams.snapshotId),
      snapshotSha256: single(searchParams.snapshotSha256),
      snapshotVersion: positiveInteger(single(searchParams.snapshotVersion)),
    },
  };
  const parsed = designOptionLaunchContextSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
