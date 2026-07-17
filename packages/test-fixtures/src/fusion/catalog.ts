import { deepFreeze, deterministicSha256, fusionFixtureUuid } from "./deterministic.js";
import type {
  FusionAcceptanceFixture,
  FusionAdversarialFixture,
  FusionCandidate,
  FusionCandidateGeometry,
  FusionConfidenceSample,
  FusionDiscrepancyKind,
  FusionExactTruth,
  FusionFixtureDisposition,
  FusionFixtureRights,
  FusionRoomDimensions,
  FusionSourceKind,
  FusionSourceManifest,
  FusionTransform,
} from "./types.js";

export const fusionFixtureRights = deepFreeze({
  allowedPurposes: ["local-ci-evaluation", "security-testing", "ui-acceptance"],
  creator: "Interior Design C9 synthetic QA lane",
  licence: "CC0-1.0",
  origin: "generated-in-repository",
  serviceProcessingConsent: true,
  synthetic: true,
  trainingUseConsent: "denied",
} satisfies FusionFixtureRights);

const standardKinds = Object.freeze([
  "plan-proposal",
  "roomplan-proposal",
  "reconstruction-result",
  "measurement-set",
  "user-assertion-set",
] satisfies readonly FusionSourceKind[]);

export const fusionAcceptanceFixtures = deepFreeze([
  makeFixture({
    description:
      "Five complementary proposal kinds observe different parts of a visibly synthetic two-floor townhouse.",
    discrepancies: ["dimension"],
    disposition: "meaningful-improvement",
    id: "c9-synthetic-complementary-two-floor",
    kinds: standardKinds,
    sequence: 1,
    status: "full",
    title: "Synthetic complementary two-floor fusion",
  }),
  makeFixture({
    description:
      "RoomPlan and reconstruction sources contain declared scale and level drift plus conflicting dimensions.",
    discrepancies: ["dimension", "level-alignment", "scale"],
    disposition: "meaningful-improvement",
    id: "c9-synthetic-scale-level-drift",
    kinds: standardKinds,
    sequence: 2,
    status: "full",
    title: "Synthetic scale and level drift",
    variant: "scale-level-drift",
  }),
  makeFixture({
    description:
      "Sources contain missing walls, one unsupported extra region, conflicting topology and a registration outlier.",
    discrepancies: ["extra-element", "missing-element", "position", "topology"],
    disposition: "meaningful-improvement",
    id: "c9-synthetic-missing-extra-outlier",
    kinds: standardKinds,
    requiredUnknownRegionIds: ["synthetic-garage-behind-occlusion"],
    sequence: 3,
    status: "partial",
    title: "Synthetic missing, extra and outlier evidence",
    variant: "missing-extra-outlier",
  }),
  makeFixture({
    description:
      "A disconnected upper-floor reconstruction remains a separate component and two occluded regions stay unknown.",
    discrepancies: ["topology", "unknown-region"],
    disposition: "meaningful-improvement",
    expectedConnectedComponentCount: 2,
    id: "c9-synthetic-disconnected-occluded",
    kinds: standardKinds,
    requiredUnknownRegionIds: ["synthetic-under-stair-void", "synthetic-upper-eaves"],
    sequence: 4,
    status: "partial",
    title: "Synthetic disconnected and occluded evidence",
    variant: "disconnected",
  }),
  makeFixture({
    abstentionCode: "DEGENERATE_ANCHORS",
    description:
      "Every cross-source control point is collinear, so a free similarity transform is rank deficient.",
    discrepancies: [],
    disposition: "honest-abstention",
    id: "c9-synthetic-degenerate-collinear",
    kinds: ["plan-proposal", "roomplan-proposal", "measurement-set"],
    sequence: 5,
    title: "Synthetic collinear-anchor abstention",
  }),
  makeFixture({
    abstentionCode: "REFLECTION_REJECTED",
    description:
      "A mirrored reconstruction cannot be converted into a permitted orientation-preserving similarity transform.",
    discrepancies: [],
    disposition: "honest-abstention",
    id: "c9-synthetic-reflection",
    kinds: ["plan-proposal", "reconstruction-result", "measurement-set"],
    sequence: 6,
    title: "Synthetic reflection abstention",
  }),
  makeFixture({
    abstentionCode: "INSUFFICIENT_SOURCE_KINDS",
    description:
      "Two attributable assertions of one source kind cannot independently establish a full-house proposal.",
    discrepancies: [],
    disposition: "honest-abstention",
    id: "c9-synthetic-assertion-only",
    kinds: ["user-assertion-set", "user-assertion-set"],
    sequence: 7,
    title: "Synthetic assertion-only abstention",
  }),
] satisfies readonly FusionAcceptanceFixture[]);

export const fusionAdversarialFixtures = deepFreeze([
  adversarial(101, "collinear-anchors", "DEGENERATE_ANCHORS", {
    anchorsMillimetres: [
      [0, 0, 0],
      [1_000, 0, 0],
      [2_000, 0, 0],
    ],
  }),
  adversarial(102, "reflection-transform", "REFLECTION_REJECTED", {
    determinantPartsPerMillion: -1_000_000,
    matrixE9: [-1_000_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
  }),
  adversarial(103, "non-finite-number", "NON_FINITE_VALUE", {
    encodedAttackValue: "Number.NaN",
    target: "sources[0].anchors[0].sourcePoint.xMm",
  }),
  adversarial(104, "overflow-coordinate", "RESOURCE_LIMIT", {
    target: "sources[0].anchors[0].sourcePoint.xMm",
    value: 10_000_001,
  }),
  adversarial(105, "duplicate-reference", "DUPLICATE_SOURCE_REFERENCE", {
    referenceId: fusionFixtureUuid(91_000),
    repeated: 2,
  }),
  adversarial(106, "path-injection", "PUBLIC_LOCATION_FIELD_DENIED", {
    sourcePath: "../../private/customer-roomplan.json",
  }),
  adversarial(107, "url-injection", "PUBLIC_LOCATION_FIELD_DENIED", {
    signedUrl: "https://storage.invalid/private?X-Signature=synthetic-secret",
  }),
] satisfies readonly FusionAdversarialFixture[]);

interface FixtureOptions {
  readonly abstentionCode?: string;
  readonly description: string;
  readonly discrepancies: readonly FusionDiscrepancyKind[];
  readonly disposition: FusionFixtureDisposition;
  readonly expectedConnectedComponentCount?: number;
  readonly id: string;
  readonly kinds: readonly FusionSourceKind[];
  readonly requiredUnknownRegionIds?: readonly string[];
  readonly sequence: number;
  readonly status?: "full" | "partial";
  readonly title: string;
  readonly variant?: "disconnected" | "missing-extra-outlier" | "scale-level-drift";
}

function makeFixture(options: FixtureOptions): FusionAcceptanceFixture {
  const sources = options.kinds.map((kind, index) =>
    source(options.id, options.sequence, index, kind),
  );
  const truth = makeTruth(
    sources,
    options.sequence,
    options.discrepancies,
    options.requiredUnknownRegionIds ?? [],
    options.expectedConnectedComponentCount ?? 1,
  );
  const singleSourceCandidates = Object.fromEntries(
    sources.map((manifest, index) => [
      manifest.id,
      baselineCandidate(manifest, truth, options.sequence, index, options.variant),
    ]),
  );
  const referenceFusionCandidate =
    options.disposition === "honest-abstention"
      ? abstentionCandidate(sources, options.sequence, options.abstentionCode ?? "UNSAFE_INPUT")
      : fusedCandidate(sources, truth, options.sequence, options.status ?? "full");
  const scope = {
    baseSnapshotId: fusionFixtureUuid(options.sequence * 10_000 + 1),
    baseSnapshotSha256: deterministicSha256({ fixtureId: options.id, kind: "base-snapshot" }),
    modelId: fusionFixtureUuid(options.sequence * 10_000 + 2),
    profile: "existing" as const,
    projectId: fusionFixtureUuid(options.sequence * 10_000 + 3),
    tenantId: fusionFixtureUuid(options.sequence * 10_000 + 4),
  };
  const draft = {
    description: options.description,
    expected: {
      allowedAbstentionCodes: options.abstentionCode === undefined ? [] : [options.abstentionCode],
      disposition: options.disposition,
    },
    id: options.id,
    referenceFusionCandidate,
    rights: fusionFixtureRights,
    scope,
    singleSourceCandidates,
    sources,
    title: options.title,
    truth,
    visiblySynthetic: true as const,
  };
  return deepFreeze({ ...draft, manifestSha256: deterministicSha256(draft) });
}

function source(
  fixtureId: string,
  fixtureSequence: number,
  sourceIndex: number,
  kind: FusionSourceKind,
): FusionSourceManifest {
  const sourceSequence = fixtureSequence * 100 + sourceIndex + 1;
  const referencePayload = {
    fixtureId,
    sourceSequence,
    syntheticLabel: `VISIBLY SYNTHETIC C9 ${kind}`,
  };
  const isAssertion = kind === "user-assertion-set";
  const coordinateFrame =
    kind === "measurement-set" || isAssertion
      ? ("project-local" as const)
      : kind === "reconstruction-result"
        ? ("source-local-arbitrary" as const)
        : ("source-local-metric" as const);
  return deepFreeze({
    coordinateFrame,
    eligibleSingleSourceBaseline: !isAssertion,
    evidenceState: isAssertion
      ? ("user-asserted" as const)
      : kind === "measurement-set"
        ? ("observed" as const)
        : ("source-derived" as const),
    id: fusionFixtureUuid(100_000 + sourceSequence),
    kind,
    referenceId: fusionFixtureUuid(200_000 + sourceSequence),
    referencePayload,
    referenceSha256: deterministicSha256(referencePayload),
    rights: fusionFixtureRights,
    scaleStatus:
      kind === "reconstruction-result"
        ? ("metric-estimated" as const)
        : ("metric-validated" as const),
    schemaVersion: schemaVersion(kind),
  });
}

function schemaVersion(kind: FusionSourceKind): string {
  const versions: Readonly<Record<FusionSourceKind, string>> = {
    "measurement-set": "c9-synthetic-measurement-set-v1",
    "plan-proposal": "c6-plan-proposal-v1",
    "reconstruction-result": "c8-reconstruction-result-v1",
    "roomplan-proposal": "c7-capture-proposal-v1",
    "user-assertion-set": "c9-synthetic-user-assertion-set-v1",
  };
  return versions[kind];
}

function makeTruth(
  sources: readonly FusionSourceManifest[],
  sequence: number,
  expectedDiscrepancyKinds: readonly FusionDiscrepancyKind[],
  requiredUnknownRegionIds: readonly string[],
  expectedConnectedComponentCount: number,
): FusionExactTruth {
  const delta = sequence * 10;
  const rooms = [
    room("synthetic-ground-living", 5_000 + delta, 4_000, 2_500),
    room("synthetic-ground-kitchen", 4_000, 3_500 + delta, 2_500),
    room("synthetic-upper-bedroom", 4_800 + delta, 4_000, 2_450),
    room("synthetic-upper-bathroom", 2_600, 2_200 + delta, 2_450),
  ];
  return deepFreeze({
    expectedConnectedComponentCount,
    expectedDiscrepancyKinds: [...expectedDiscrepancyKinds].sort(),
    levelCount: 2,
    requiredUnknownRegionIds: [...requiredUnknownRegionIds].sort(),
    roomDimensions: rooms,
    sourceTransforms: Object.fromEntries(
      sources.map((manifest, index) => [manifest.id, sourceTruthTransform(manifest.kind, index)]),
    ),
    supportedRegionIds: [
      "synthetic-ground-east",
      "synthetic-ground-kitchen-centre",
      "synthetic-ground-living-centre",
      "synthetic-ground-north",
      "synthetic-ground-south",
      "synthetic-stair-core",
      "synthetic-upper-bathroom-centre",
      "synthetic-upper-bedroom-centre",
      "synthetic-upper-east",
      "synthetic-upper-west",
    ],
    topologyEdges: [
      "synthetic-ground-kitchen|synthetic-ground-living",
      "synthetic-ground-living|synthetic-stair-core",
      "synthetic-stair-core|synthetic-upper-bedroom",
      "synthetic-upper-bathroom|synthetic-upper-bedroom",
    ],
  });
}

function sourceTruthTransform(kind: FusionSourceKind, index: number): FusionTransform {
  if (kind === "plan-proposal") return transform(0, 0, 0, 0, 1_000_000);
  if (kind === "roomplan-proposal") return transform(1_200, -800, 0, 90_000_000, 1_000_000);
  if (kind === "reconstruction-result") {
    return transform(-600, 400, 3_100, -2_000_000, 997_000);
  }
  if (kind === "measurement-set") return transform(0, 0, 0, 0, 1_000_000);
  return transform(index, 0, 0, 0, 1_000_000);
}

function baselineCandidate(
  sourceManifest: FusionSourceManifest,
  truth: FusionExactTruth,
  sequence: number,
  sourceIndex: number,
  variant: FixtureOptions["variant"],
): FusionCandidate {
  if (!sourceManifest.eligibleSingleSourceBaseline) {
    return abstentionCandidate([sourceManifest], sequence + sourceIndex, "ASSERTION_ONLY");
  }
  if (sequence === 5 && sourceManifest.kind === "roomplan-proposal") {
    return abstentionCandidate([sourceManifest], sequence + sourceIndex, "DEGENERATE_ANCHORS");
  }
  if (sequence === 6 && sourceManifest.kind === "reconstruction-result") {
    return failedCandidate([sourceManifest], sequence + sourceIndex, "REFLECTION_REJECTED");
  }
  const profile = baselineProfile(sourceManifest.kind);
  const truthTransform = requiredTransform(truth, sourceManifest.id);
  const outlierMultiplier =
    variant === "missing-extra-outlier" && sourceManifest.kind === "reconstruction-result" ? 5 : 1;
  const driftMultiplier =
    variant === "scale-level-drift" &&
    ["reconstruction-result", "roomplan-proposal"].includes(sourceManifest.kind)
      ? 3
      : 1;
  const estimatedTransform = perturbTransform(
    truthTransform,
    profile.translationErrorMillimetres * outlierMultiplier,
    profile.rotationErrorMicrodegrees * outlierMultiplier,
    profile.scaleErrorPartsPerMillion * driftMultiplier,
  );
  const roomDimensions = truth.roomDimensions
    .slice(0, profile.roomCount)
    .map((dimensions, index) =>
      adjustRoom(dimensions, profile.dimensionErrorMillimetres + index * 5),
    );
  const topologyEdges = truth.topologyEdges.slice(0, profile.topologyEdgeCount);
  const coveredRegionIds = truth.supportedRegionIds.slice(0, profile.regionCount);
  if (variant === "missing-extra-outlier" && sourceManifest.kind === "reconstruction-result") {
    topologyEdges.push("synthetic-extra-shed|synthetic-ground-kitchen");
    coveredRegionIds.push("synthetic-extra-shed");
  }
  const connectedComponentCount =
    variant === "disconnected" && sourceManifest.kind === "reconstruction-result" ? 2 : 1;
  const levelCount =
    variant === "scale-level-drift" && sourceManifest.kind === "roomplan-proposal" ? 3 : 2;
  return proposedCandidate({
    correctionSeed: sequence * 10 + sourceIndex,
    geometry: {
      confidenceSamples: confidenceSamples(620_000 + sourceIndex * 35_000, sourceIndex),
      connectedComponentCount,
      coveredRegionIds,
      levelCount,
      roomDimensions,
      surfacedDiscrepancyKinds: [],
      topologyEdges,
      transforms: { [sourceManifest.id]: estimatedTransform },
      unknownRegionIds: truth.requiredUnknownRegionIds,
    },
    processingSeed: sequence * 10 + sourceIndex,
    sourceIds: [sourceManifest.id],
    status: profile.status,
  });
}

function fusedCandidate(
  sources: readonly FusionSourceManifest[],
  truth: FusionExactTruth,
  sequence: number,
  status: "full" | "partial",
): FusionCandidate {
  return proposedCandidate({
    correctionSeed: 500 + sequence,
    geometry: {
      confidenceSamples: confidenceSamples(810_000 + sequence * 5_000, sequence),
      connectedComponentCount: truth.expectedConnectedComponentCount,
      coveredRegionIds: truth.supportedRegionIds,
      levelCount: truth.levelCount,
      roomDimensions: truth.roomDimensions.map((dimensions, index) =>
        adjustRoom(dimensions, 4 + ((sequence + index) % 3) * 3),
      ),
      surfacedDiscrepancyKinds: truth.expectedDiscrepancyKinds,
      topologyEdges: truth.topologyEdges,
      transforms: Object.fromEntries(
        sources.map((manifest, index) => {
          const expected = requiredTransform(truth, manifest.id);
          return [manifest.id, perturbTransform(expected, 3 + index, 15_000 + index * 2_000, 20)];
        }),
      ),
      unknownRegionIds: truth.requiredUnknownRegionIds,
    },
    processingSeed: 500 + sequence,
    sourceIds: sources.map(({ id }) => id),
    status,
  });
}

function proposedCandidate(input: {
  readonly correctionSeed: number;
  readonly geometry: FusionCandidateGeometry;
  readonly processingSeed: number;
  readonly sourceIds: readonly string[];
  readonly status: "full" | "partial";
}): FusionCandidate {
  const started = input.correctionSeed * 100;
  return deepFreeze({
    correction: {
      automatedActionCount: 2 + (input.correctionSeed % 5),
      humanStudy: false,
      reviewCompletedMonotonicMilliseconds: started + 30 + (input.correctionSeed % 13),
      reviewStartedMonotonicMilliseconds: started,
    },
    geometry: input.geometry,
    processing: processing(input.processingSeed),
    sourceIds: input.sourceIds,
    status: input.status,
  });
}

function abstentionCandidate(
  sources: readonly FusionSourceManifest[],
  sequence: number,
  safeCode: string,
): FusionCandidate {
  return deepFreeze({
    processing: processing(800 + sequence),
    safeCode,
    sourceIds: sources.map(({ id }) => id),
    status: "abstained",
  });
}

function failedCandidate(
  sources: readonly FusionSourceManifest[],
  sequence: number,
  safeCode: string,
): FusionCandidate {
  return deepFreeze({
    processing: processing(900 + sequence),
    safeCode,
    sourceIds: sources.map(({ id }) => id),
    status: "failed",
  });
}

function processing(seed: number) {
  return {
    cpuMilliseconds: 25 + seed * 2,
    latencyMilliseconds: 40 + seed * 3,
    peakMemoryBytes: 24 * 1_048_576 + seed * 1_024,
  };
}

function confidenceSamples(base: number, seed: number): readonly FusionConfidenceSample[] {
  return [
    sample("registration", base, true),
    sample("dimension", Math.min(990_000, base + 40_000), true),
    sample("topology", Math.max(100_000, base - 70_000), seed % 4 !== 0),
    sample("level", Math.min(990_000, base + 80_000), true),
    sample("dimension", Math.max(100_000, base - 120_000), seed % 3 !== 0),
    sample("registration", Math.min(990_000, base + 20_000), true),
  ];
}

function sample(
  kind: FusionConfidenceSample["kind"],
  confidenceMillionths: number,
  correct: boolean,
): FusionConfidenceSample {
  return { confidenceMillionths, correct, kind };
}

function baselineProfile(kind: FusionSourceKind) {
  const profiles = {
    "measurement-set": {
      dimensionErrorMillimetres: 25,
      regionCount: 2,
      roomCount: 1,
      rotationErrorMicrodegrees: 250_000,
      scaleErrorPartsPerMillion: 500,
      status: "partial" as const,
      topologyEdgeCount: 1,
      translationErrorMillimetres: 35,
    },
    "plan-proposal": {
      dimensionErrorMillimetres: 80,
      regionCount: 7,
      roomCount: 3,
      rotationErrorMicrodegrees: 1_500_000,
      scaleErrorPartsPerMillion: 8_000,
      status: "partial" as const,
      topologyEdgeCount: 3,
      translationErrorMillimetres: 110,
    },
    "reconstruction-result": {
      dimensionErrorMillimetres: 140,
      regionCount: 8,
      roomCount: 4,
      rotationErrorMicrodegrees: 3_500_000,
      scaleErrorPartsPerMillion: 24_000,
      status: "partial" as const,
      topologyEdgeCount: 3,
      translationErrorMillimetres: 230,
    },
    "roomplan-proposal": {
      dimensionErrorMillimetres: 65,
      regionCount: 6,
      roomCount: 3,
      rotationErrorMicrodegrees: 1_100_000,
      scaleErrorPartsPerMillion: 6_000,
      status: "partial" as const,
      topologyEdgeCount: 2,
      translationErrorMillimetres: 85,
    },
    "user-assertion-set": {
      dimensionErrorMillimetres: 0,
      regionCount: 0,
      roomCount: 0,
      rotationErrorMicrodegrees: 0,
      scaleErrorPartsPerMillion: 0,
      status: "partial" as const,
      topologyEdgeCount: 0,
      translationErrorMillimetres: 0,
    },
  } satisfies Readonly<
    Record<
      FusionSourceKind,
      {
        readonly dimensionErrorMillimetres: number;
        readonly regionCount: number;
        readonly roomCount: number;
        readonly rotationErrorMicrodegrees: number;
        readonly scaleErrorPartsPerMillion: number;
        readonly status: "partial";
        readonly topologyEdgeCount: number;
        readonly translationErrorMillimetres: number;
      }
    >
  >;
  return profiles[kind];
}

function room(
  roomId: string,
  widthMillimetres: number,
  lengthMillimetres: number,
  heightMillimetres: number,
): FusionRoomDimensions {
  return { heightMillimetres, lengthMillimetres, roomId, widthMillimetres };
}

function adjustRoom(
  dimensions: FusionRoomDimensions,
  errorMillimetres: number,
): FusionRoomDimensions {
  return {
    heightMillimetres: dimensions.heightMillimetres + errorMillimetres,
    lengthMillimetres: dimensions.lengthMillimetres - errorMillimetres,
    roomId: dimensions.roomId,
    widthMillimetres: dimensions.widthMillimetres + errorMillimetres,
  };
}

function transform(
  x: number,
  y: number,
  z: number,
  yawMicrodegrees: number,
  scalePartsPerMillion: number,
): FusionTransform {
  return {
    rotationMicrodegrees: { x: 0, y: 0, z: yawMicrodegrees },
    scalePartsPerMillion,
    translationMillimetres: { x, y, z },
  };
}

function perturbTransform(
  expected: FusionTransform,
  translationErrorMillimetres: number,
  rotationErrorMicrodegrees: number,
  scaleErrorPartsPerMillion: number,
): FusionTransform {
  return {
    rotationMicrodegrees: {
      x: expected.rotationMicrodegrees.x,
      y: expected.rotationMicrodegrees.y,
      z: expected.rotationMicrodegrees.z + rotationErrorMicrodegrees,
    },
    scalePartsPerMillion: expected.scalePartsPerMillion + scaleErrorPartsPerMillion,
    translationMillimetres: {
      x: expected.translationMillimetres.x + translationErrorMillimetres,
      y: expected.translationMillimetres.y,
      z: expected.translationMillimetres.z,
    },
  };
}

function requiredTransform(truth: FusionExactTruth, sourceId: string): FusionTransform {
  const value = truth.sourceTransforms[sourceId];
  if (value === undefined) throw new Error(`Missing synthetic transform truth for ${sourceId}.`);
  return value;
}

function adversarial(
  sequence: number,
  kind: FusionAdversarialFixture["kind"],
  expectedSafeCode: string,
  payload: unknown,
): FusionAdversarialFixture {
  const draft = {
    expectedSafeCode,
    id: `c9-synthetic-adversarial-${kind}`,
    kind,
    payload,
    rights: fusionFixtureRights,
    visiblySynthetic: true as const,
  };
  return deepFreeze({ ...draft, manifestSha256: deterministicSha256({ ...draft, sequence }) });
}
