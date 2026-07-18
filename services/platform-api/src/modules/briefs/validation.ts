import { designBriefSchema } from "@interior-design/contracts";

import { briefInvalid } from "./errors.js";
import type { BriefRevisionRecord } from "./types.js";

const sha256Pattern = /^[a-f0-9]{64}$/u;

export function validateBriefRevisionRecord(value: BriefRevisionRecord): BriefRevisionRecord {
  const brief = designBriefSchema.safeParse(value.brief);
  if (
    !brief.success ||
    !Number.isInteger(value.canonicalByteLength) ||
    value.canonicalByteLength < 1 ||
    value.canonicalByteLength > 1_048_576 ||
    !sha256Pattern.test(value.contentSha256) ||
    !sha256Pattern.test(value.snapshotSha256) ||
    !["accepted", "created", "reopened", "updated"].includes(value.reason)
  ) {
    throw briefInvalid(
      "BRIEF_KERNEL_OUTPUT_INVALID",
      "The deterministic brief kernel produced an invalid bounded revision.",
    );
  }
  return { ...value, brief: brief.data };
}
