import {
  canonicalHomeSnapshotSchema,
  type CanonicalHomeSnapshot,
  type KnownAttribution,
  type ModelProfile,
} from "@interior-design/contracts";

export const alphaTenantId = "10000000-0000-4000-8000-000000000001";
export const betaTenantId = "10000000-0000-4000-8000-000000000002";
export const ownerUserId = "20000000-0000-4000-8000-000000000001";
export const editorUserId = "20000000-0000-4000-8000-000000000002";
export const viewerUserId = "20000000-0000-4000-8000-000000000003";
export const betaUserId = "20000000-0000-4000-8000-000000000004";
export const alphaProjectId = "30000000-0000-4000-8000-000000000001";
export const betaProjectId = "30000000-0000-4000-8000-000000000002";
export const existingModelId = "40000000-0000-4000-8000-000000000001";
export const levelId = "50000000-0000-4000-8000-000000000001";
export const spaceId = "50000000-0000-4000-8000-000000000002";

function userAssertion(claimId: string): KnownAttribution {
  return {
    actorUserId: ownerUserId,
    claimId,
    evidenceIds: [],
    method: { kind: "fixture", name: "Synthetic C4 fixture", version: "1" },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

function known<T>(claimId: string, value: T) {
  return { attribution: userAssertion(claimId), knowledge: "known" as const, value };
}

function unknown(claimId: string) {
  return {
    attribution: {
      claimId,
      evidenceIds: [],
      method: { kind: "fixture" as const, name: "Synthetic C4 fixture", version: "1" },
      reason: "not-provided" as const,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

export function canonicalSnapshotFixture(
  options: {
    readonly derivedFromSnapshotSha256?: string;
    readonly limitationDetail?: string;
    readonly modelId?: string;
    readonly profile?: ModelProfile;
    readonly projectId?: string;
  } = {},
): CanonicalHomeSnapshot {
  const profile = options.profile ?? "existing";
  return canonicalHomeSnapshotSchema.parse({
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    ...(options.derivedFromSnapshotSha256 === undefined
      ? {}
      : { derivedFromSnapshotSha256: options.derivedFromSnapshotSha256 }),
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [],
      levels: [
        {
          elementType: "level",
          elevationMm: unknown("60000000-0000-4000-8000-000000000003"),
          id: levelId,
          name: known("60000000-0000-4000-8000-000000000001", "Synthetic ground level"),
          origin: userAssertion("60000000-0000-4000-8000-000000000002"),
          storeyHeightMm: unknown("60000000-0000-4000-8000-000000000004"),
        },
      ],
      lights: [],
      openings: [],
      spaces: [
        {
          boundary: known("60000000-0000-4000-8000-000000000007", [
            { xMm: 0, yMm: 0 },
            { xMm: 4_000, yMm: 0 },
            { xMm: 4_000, yMm: 3_000 },
            { xMm: 0, yMm: 3_000 },
          ]),
          boundedByElementIds: [],
          classification: known(
            "60000000-0000-4000-8000-000000000008",
            "synthetic-unclassified-space",
          ),
          elementType: "space",
          id: spaceId,
          levelId,
          name: known("60000000-0000-4000-8000-000000000005", "Synthetic room"),
          origin: userAssertion("60000000-0000-4000-8000-000000000006"),
        },
      ],
      stairs: [],
      surfaces: [],
      walls: [],
    },
    knownLimitations: [
      {
        code: "SYNTHETIC_NOT_SURVEYED",
        detail:
          options.limitationDetail ??
          "Synthetic user assertions only; dimensions and condition are not surveyed or as-built truth.",
      },
    ],
    modelId: options.modelId ?? existingModelId,
    profile,
    projectId: options.projectId ?? alphaProjectId,
    schemaVersion: "c4-canonical-home-v1",
  });
}
