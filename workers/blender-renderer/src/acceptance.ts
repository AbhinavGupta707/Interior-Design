import type { RenderArtifactRole } from "@interior-design/contracts";

import { rendererFailure } from "./errors.js";
import { sha256 } from "./hash.js";

type RequiredArtifactRole = Exclude<RenderArtifactRole, "illustrative-enhancement-png">;

export interface ExactByteReplayEvidence {
  readonly artifactByteHashesEqual: Readonly<Record<RequiredArtifactRole, boolean>>;
  readonly primaryArtifactByteHashes: Readonly<Record<RequiredArtifactRole, string>>;
  readonly replayArtifactByteHashes: Readonly<Record<RequiredArtifactRole, string>>;
}

export function requireExactByteReplay(
  roles: readonly RequiredArtifactRole[],
  primary: ReadonlyMap<RenderArtifactRole, Uint8Array>,
  replay: ReadonlyMap<RenderArtifactRole, Uint8Array>,
): ExactByteReplayEvidence {
  const primaryArtifactByteHashes = {} as Record<RequiredArtifactRole, string>;
  const replayArtifactByteHashes = {} as Record<RequiredArtifactRole, string>;
  const artifactByteHashesEqual = {} as Record<RequiredArtifactRole, boolean>;
  for (const role of roles) {
    const primaryBytes = primary.get(role);
    const replayBytes = replay.get(role);
    if (primaryBytes === undefined || replayBytes === undefined) {
      rendererFailure("RENDER_REPLAY_ARTIFACT_MISSING");
    }
    const primarySha256 = sha256(primaryBytes);
    const replaySha256 = sha256(replayBytes);
    primaryArtifactByteHashes[role] = primarySha256;
    replayArtifactByteHashes[role] = replaySha256;
    artifactByteHashesEqual[role] = primarySha256 === replaySha256;
  }
  if (!Object.values(artifactByteHashesEqual).every((equal) => equal)) {
    rendererFailure("RENDER_REPLAY_BYTE_MISMATCH");
  }
  return { artifactByteHashesEqual, primaryArtifactByteHashes, replayArtifactByteHashes };
}
