import type {
  Asset,
  Project,
  ReconstructionJob,
  ReconstructionResult,
  Session,
} from "@interior-design/contracts";

export const uuid = (sequence: number): string =>
  `91000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

export const project: Project = {
  createdAt: "2026-07-17T12:00:00.000Z",
  id: uuid(1),
  name: "Synthetic reconstruction project",
  status: "draft",
  tenantId: uuid(2),
  updatedAt: "2026-07-17T12:00:00.000Z",
  version: 1,
};

export const session: Session = {
  actor: {
    displayName: "Synthetic C8 owner",
    role: "owner",
    subject: "fixture:c8-owner",
    tenantId: project.tenantId,
    userId: uuid(3),
  },
  authMode: "local-fixture",
  expiresAt: "2099-07-18T12:00:00.000Z",
};

export const imageAsset: Asset = {
  createdAt: "2026-07-17T12:01:00.000Z",
  declaredMimeType: "image/jpeg",
  detectedMimeType: "image/jpeg",
  fileName: "visibly-synthetic-room.jpg",
  id: uuid(4),
  kind: "photograph",
  projectId: project.id,
  rights: {
    basis: "owned-by-user",
    serviceProcessingConsent: true,
    trainingUseConsent: "denied",
  },
  source: { byteSize: 2_048, sha256: "1".repeat(64) },
  status: "ready",
  updatedAt: "2026-07-17T12:02:00.000Z",
};

export const job: ReconstructionJob = {
  attempt: 1,
  createdAt: "2026-07-17T12:03:00.000Z",
  id: uuid(5),
  projectId: project.id,
  request: {
    appearanceMode: "disabled",
    label: "Synthetic room reconstruction",
    mode: "rgb-sfm",
    registrationAnchors: [],
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    sources: [
      {
        assetId: imageAsset.id,
        byteSize: imageAsset.source.byteSize,
        detectedMimeType: "image/jpeg",
        kind: "rgb-image",
        sha256: imageAsset.source.sha256,
      },
    ],
  },
  retryable: false,
  schemaVersion: "c8-reconstruction-job-v1",
  state: "created",
  updatedAt: "2026-07-17T12:03:00.000Z",
  version: 1,
};

const tool = {
  adapterId: "synthetic.geometry",
  adapterVersion: "1.0.0-fixture",
  configSha256: "2".repeat(64),
  executableVersion: "fixture-only",
};

const artifact = (
  kind: "calibrated-cameras" | "diagnostics" | "sparse-point-cloud",
  sequence: number,
) => ({
  artifactId: uuid(sequence),
  byteSize: 1_024,
  contentSha256: sequence.toString(16).slice(-1).repeat(64),
  dimensionalAuthority: "proposal-only" as const,
  kind,
  mediaType: "application/json",
  sourceManifestSha256: "3".repeat(64),
  toolManifestSha256: "4".repeat(64),
});

export const partialResult: ReconstructionResult = {
  createdAt: "2026-07-17T12:05:00.000Z",
  findings: ["PARTIAL_REGISTRATION", "DISCONNECTED_COMPONENTS", "SCALE_UNKNOWN"],
  geometry: {
    alignment: { anchorCount: 0 },
    artifacts: [artifact("calibrated-cameras", 6), artifact("sparse-point-cloud", 7)],
    componentCount: 2,
    coordinateSystem: "right-handed-local",
    inputFrameCount: 10,
    manifestSha256: "5".repeat(64),
    registeredFrameCount: 6,
    scaleStatus: "unknown",
    schemaVersion: "c8-geometry-result-v1",
    tool,
    unit: "arbitrary-units",
  },
  jobId: job.id,
  projectId: project.id,
  resultId: uuid(8),
  schemaVersion: "c8-reconstruction-result-v1",
  sourceManifestSha256: "3".repeat(64),
  status: "completed",
};

export const abstainedResult: ReconstructionResult = {
  createdAt: "2026-07-17T12:06:00.000Z",
  diagnosticArtifact: artifact("diagnostics", 9),
  findings: ["INSUFFICIENT_OVERLAP", "SYNTHETIC_FIXTURE_ONLY"],
  jobId: job.id,
  projectId: project.id,
  resultId: uuid(10),
  safeCode: "INSUFFICIENT_OVERLAP",
  schemaVersion: "c8-reconstruction-result-v1",
  sourceManifestSha256: "3".repeat(64),
  status: "abstained",
};

export const workspace = {
  assets: [imageAsset],
  capabilities: {
    appearanceProvider: "unavailable" as const,
    geometryWorker: "unavailable" as const,
    gpu: "unavailable" as const,
  },
  jobs: [job],
  project,
  session,
};
