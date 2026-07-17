import type {
  Asset,
  ModelBranch,
  PlanCalibration,
  PlanProcessingJob,
  PlanProposal,
  Project,
  Session,
} from "@interior-design/contracts";

export const uuid = (sequence: number): string =>
  `90000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

export const project: Project = {
  createdAt: "2026-07-17T12:00:00.000Z",
  id: uuid(1),
  name: "Synthetic plan correction",
  status: "draft",
  tenantId: uuid(2),
  updatedAt: "2026-07-17T12:00:00.000Z",
  version: 1,
};

export const session: Session = {
  actor: {
    displayName: "C6 owner",
    role: "owner",
    subject: "fixture:c6-owner",
    tenantId: project.tenantId,
    userId: uuid(3),
  },
  authMode: "local-fixture",
  expiresAt: "2099-07-18T12:00:00.000Z",
};

export const asset: Asset = {
  createdAt: "2026-07-17T12:00:00.000Z",
  declaredMimeType: "application/pdf",
  detectedMimeType: "application/pdf",
  fileName: "synthetic-ground-floor.pdf",
  id: uuid(4),
  kind: "plan",
  projectId: project.id,
  rights: {
    basis: "owned-by-user",
    serviceProcessingConsent: true,
    trainingUseConsent: "denied",
  },
  source: { byteSize: 12_000, sha256: "a".repeat(64) },
  status: "ready",
  updatedAt: "2026-07-17T12:00:00.000Z",
};

export const job: PlanProcessingJob = {
  assetId: asset.id,
  attempt: 1,
  createdAt: "2026-07-17T12:01:00.000Z",
  id: uuid(5),
  pageIndex: 0,
  parserPreference: "fixture",
  projectId: project.id,
  resultId: uuid(6),
  retryable: false,
  schemaVersion: "c6-plan-job-v1",
  sourceSha256: asset.source.sha256,
  state: "proposed",
  updatedAt: "2026-07-17T12:02:00.000Z",
  version: 2,
};

const region = (minimumX: number, minimumY: number, maximumX: number, maximumY: number) => ({
  maximum: { x: maximumX, y: maximumY },
  minimum: { x: minimumX, y: minimumY },
});

const levelId = uuid(10);
const wallIds = [uuid(11), uuid(12), uuid(13), uuid(14)] as const;

export const proposal: PlanProposal = {
  candidates: [
    {
      candidateId: levelId,
      confidence: 98,
      elevationMillimetres: 0,
      kind: "level",
      sourceRegion: region(0, 0, 10_000, 8_000),
      suggestedName: "Ground floor",
    },
    {
      candidateId: wallIds[0],
      confidence: 94,
      end: { x: 8_000, y: 1_000 },
      heightMillimetres: 2_600,
      kind: "wall",
      levelCandidateId: levelId,
      sourceRegion: region(900, 900, 8_100, 1_100),
      start: { x: 1_000, y: 1_000 },
      thicknessMillimetres: 180,
    },
    {
      candidateId: wallIds[1],
      confidence: 93,
      end: { x: 8_000, y: 6_000 },
      kind: "wall",
      levelCandidateId: levelId,
      sourceRegion: region(7_900, 900, 8_100, 6_100),
      start: { x: 8_000, y: 1_000 },
    },
    {
      candidateId: wallIds[2],
      confidence: 92,
      end: { x: 1_000, y: 6_000 },
      kind: "wall",
      levelCandidateId: levelId,
      sourceRegion: region(900, 5_900, 8_100, 6_100),
      start: { x: 8_000, y: 6_000 },
      thicknessMillimetres: 180,
    },
    {
      candidateId: wallIds[3],
      confidence: 91,
      end: { x: 1_000, y: 1_000 },
      kind: "wall",
      levelCandidateId: levelId,
      sourceRegion: region(900, 900, 1_100, 6_100),
      start: { x: 1_000, y: 6_000 },
      thicknessMillimetres: 180,
    },
    {
      candidateId: uuid(15),
      confidence: 87,
      end: { x: 3_000, y: 1_000 },
      hostWallCandidateId: wallIds[0],
      kind: "opening",
      levelCandidateId: levelId,
      openingKind: "door",
      sillHeightMillimetres: 0,
      sourceRegion: region(2_000, 900, 3_000, 1_100),
      start: { x: 2_000, y: 1_000 },
    },
    {
      boundaryWallCandidateIds: [...wallIds],
      candidateId: uuid(16),
      confidence: 89,
      kind: "space",
      levelCandidateId: levelId,
      sourceRegion: region(1_000, 1_000, 8_000, 6_000),
      suggestedName: "Living room",
    },
  ],
  createdAt: "2026-07-17T12:02:00.000Z",
  findings: [
    {
      affectedCandidateIds: [uuid(15)],
      code: "OPENING_HEIGHT_UNKNOWN",
      message: "Opening height was not present in the source.",
      severity: "warning",
    },
  ],
  jobId: job.id,
  normalizedInputSha256: "b".repeat(64),
  overallConfidence: 91,
  parser: {
    adapterId: "repository.fixture",
    adapterVersion: "1",
    manifestSha256: "c".repeat(64),
    mode: "deterministic-fixture",
    normalizers: [{ name: "fixture.normalizer", version: "1" }],
  },
  projectId: project.id,
  proposalId: uuid(6),
  schemaVersion: "c6-plan-proposal-v1",
  source: {
    assetId: asset.id,
    byteSize: asset.source.byteSize,
    coordinateSpace: "fixture-microunits",
    detectedMimeType: "application/pdf",
    heightSourceUnits: 8_000,
    pageIndex: 0,
    projectId: project.id,
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    sha256: asset.source.sha256,
    widthSourceUnits: 10_000,
  },
  status: "proposal",
  unresolvedRegions: [],
};

export const calibration: PlanCalibration = {
  createdAt: "2026-07-17T12:03:00.000Z",
  createdBy: session.actor.userId,
  evidence: {
    knownLengthMillimetres: 7_000,
    method: "known-length",
    sourceEnd: { x: 8_000, y: 1_000 },
    sourceStart: { x: 1_000, y: 1_000 },
  },
  id: uuid(20),
  jobId: job.id,
  projectId: project.id,
  proposalId: proposal.proposalId,
  residualMillimetres: 0,
  sourceToModel: {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    denominator: 1,
    rounding: "half-away-from-zero",
    translateXMillimetres: 0,
    translateYMillimetres: 0,
  },
};

export const branch: ModelBranch = {
  createdAt: "2026-07-17T12:00:00.000Z",
  createdBy: session.actor.userId,
  headSnapshotId: uuid(31),
  headSnapshotSha256: "d".repeat(64),
  id: uuid(30),
  modelId: uuid(32),
  name: "Imported existing plan",
  profile: "existing",
  projectId: project.id,
  revision: 0,
  schemaVersion: "c5-model-branch-v1",
  sourceSnapshotId: uuid(31),
  updatedAt: "2026-07-17T12:00:00.000Z",
};
