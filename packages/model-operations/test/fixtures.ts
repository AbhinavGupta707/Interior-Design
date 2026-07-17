import {
  canonicalHomeSnapshotSchema,
  type CanonicalHomeSnapshot,
  type KnownAttribution,
} from "@interior-design/contracts";

export const projectId = "10000000-0000-4000-8000-000000000001";
export const modelId = "10000000-0000-4000-8000-000000000002";
export const userId = "10000000-0000-4000-8000-000000000003";
export const levelId = "10000000-0000-4000-8000-000000000004";
export const wallId = "10000000-0000-4000-8000-000000000005";
export const spaceId = "10000000-0000-4000-8000-000000000006";

let claimSequence = 100;

export function attribution(): KnownAttribution {
  claimSequence += 1;
  return {
    actorUserId: userId,
    claimId: `20000000-0000-4000-8000-${String(claimSequence).padStart(12, "0")}`,
    evidenceIds: [],
    method: { kind: "manual", name: "C5 unit fixture", version: "1" },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

export function known<T>(value: T) {
  return { attribution: attribution(), knowledge: "known" as const, value };
}

export function baseSnapshot(): CanonicalHomeSnapshot {
  return canonicalHomeSnapshotSchema.parse({
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [],
      levels: [
        {
          elementType: "level",
          elevationMm: known(0),
          id: levelId,
          name: known("Ground"),
          origin: attribution(),
          storeyHeightMm: known(2600),
        },
      ],
      lights: [],
      openings: [],
      spaces: [],
      stairs: [],
      surfaces: [],
      walls: [
        {
          alignment: "centre",
          baseOffsetMm: known(0),
          elementType: "wall",
          heightMm: known(2400),
          id: wallId,
          levelId,
          name: known("North wall"),
          origin: attribution(),
          path: known([
            { xMm: 0, yMm: 0 },
            { xMm: 4000, yMm: 0 },
          ]),
          thicknessMm: known(150),
        },
      ],
    },
    knownLimitations: [
      { code: "SYNTHETIC_FIXTURE", detail: "Synthetic model-operation unit fixture." },
    ],
    modelId,
    profile: "existing",
    projectId,
    schemaVersion: "c4-canonical-home-v1",
  });
}
