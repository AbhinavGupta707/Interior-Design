import { createFusionJobRequestSchema, type FusionSource } from "@interior-design/contracts";

import { convertRoomPlanToProposal } from "../../src/roomplan/converter.js";
import { sha256 } from "../../src/roomplan/canonical.js";
import type {
  FusionAcquisitionBundle,
  FusionSourcePayload,
  LeasedFusionAttempt,
} from "../../src/model-fusion/types.js";
import { SYNTHETIC_IDS, syntheticNormalized, syntheticSources } from "../roomplan/fixtures.js";

const planSourceId = "ca000000-0000-4000-8000-000000000001";
const roomSourceId = "ca000000-0000-4000-8000-000000000002";

function baseSnapshot() {
  const sources = syntheticSources();
  const normalized = sources.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
  if (!normalized) throw new Error("Synthetic RoomPlan normalized artifact is missing.");
  const proposal = convertRoomPlanToProposal(syntheticNormalized(), {
    captureSessionId: SYNTHETIC_IDS.captureSession,
    createdAt: "2026-07-17T12:00:00.000Z",
    normalizedArtifactId: SYNTHETIC_IDS.normalizedArtifact,
    normalizedInputSha256: normalized.sha256,
    packageId: SYNTHETIC_IDS.package,
    packageManifestSha256: "f".repeat(64),
    projectId: SYNTHETIC_IDS.project,
    proposalId: SYNTHETIC_IDS.proposal,
  });
  if (proposal.status !== "proposal") throw new Error("Synthetic RoomPlan conversion abstained.");
  return proposal.proposedSnapshot;
}

export const workerSources: readonly FusionSource[] = [
  {
    coordinateFrame: "source-local-arbitrary",
    elementCount: 4,
    evidenceState: "source-derived",
    id: planSourceId,
    kind: "plan-proposal",
    referenceId: planSourceId,
    rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
    scaleStatus: "unknown",
    schemaVersion: "c6-plan-proposal-v1",
    sha256: "1".repeat(64),
  },
  {
    coordinateFrame: "source-local-metric",
    elementCount: 6,
    evidenceState: "source-derived",
    id: roomSourceId,
    kind: "roomplan-proposal",
    referenceId: roomSourceId,
    rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
    scaleStatus: "metric-estimated",
    schemaVersion: "c7-capture-proposal-v1",
    sha256: "2".repeat(64),
  },
];

export function fusionWorkerFixture(): {
  readonly acquired: FusionAcquisitionBundle;
  readonly lease: LeasedFusionAttempt;
} {
  const snapshot = baseSnapshot();
  const request = createFusionJobRequestSchema.parse({
    anchorGroups: [],
    baseSnapshot: {
      modelId: snapshot.modelId,
      profile: "existing",
      snapshotId: "ca000000-0000-4000-8000-000000000010",
      snapshotSha256: "3".repeat(64),
    },
    inferencePolicy: "label-and-expose",
    label: "Visibly synthetic worker fusion",
    sources: workerSources,
  });
  const payloads: FusionSourcePayload[] = workerSources.map((descriptor) => ({
    descriptor,
    payload: { fixture: descriptor.kind, referenceId: descriptor.referenceId },
  }));
  return {
    acquired: { baseSnapshot: snapshot, sources: payloads },
    lease: {
      attempt: 1,
      jobId: "ca000000-0000-4000-8000-000000000020",
      leaseExpiresAt: "2026-07-17T13:00:00.000Z",
      leaseToken: "ca000000-0000-4000-8000-000000000021",
      projectId: SYNTHETIC_IDS.project,
      request,
      sourceManifestSha256: sha256({ base: request.baseSnapshot, sources: request.sources }),
      stage: "registering",
      tenantId: SYNTHETIC_IDS.tenant,
    },
  };
}
