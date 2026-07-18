import { knownAttributionSchema } from "@interior-design/contracts";
import { z } from "zod";

import {
  assetPlacementRequestSchemaVersion,
  assetPlacementResourcePolicy,
  type AssetPlacementRequest,
} from "./types.js";

const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const coordinateSchema = z.int().min(-10_000_000).max(10_000_000);
const dimensionSchema = z.int().positive().max(1_000_000);
const faceSchema = z.enum(["all", "bottom", "inside", "outside", "top"]);
const allowedAssetIdsSchema = z
  .array(uuidSchema)
  .max(assetPlacementResourcePolicy.maximumAllowedAssetIdsPerTarget)
  .refine((ids) => new Set(ids).size === ids.length, "Allowed asset IDs must be unique.")
  .optional();

const boundsSchema = z
  .object({
    maximumXMm: coordinateSchema,
    maximumYMm: coordinateSchema,
    minimumXMm: coordinateSchema,
    minimumYMm: coordinateSchema,
  })
  .strict()
  .refine(
    ({ maximumXMm, maximumYMm, minimumXMm, minimumYMm }) =>
      minimumXMm < maximumXMm && minimumYMm < maximumYMm,
    "Placement bounds require positive width and depth.",
  );

const replacementSchema = uuidSchema.optional();
const targetCore = {
  allowedAssetIds: allowedAssetIdsSchema,
  replaceElementId: replacementSchema,
  targetId: uuidSchema,
};

const furnishingTargetSchema = z
  .object({
    ...targetCore,
    anchorPointsMm: z
      .array(z.object({ xMm: coordinateSchema, yMm: coordinateSchema }).strict())
      .min(1)
      .max(assetPlacementResourcePolicy.maximumAnchorPointsPerTarget),
    boundsMm: boundsSchema,
    exclusionsMm: z
      .array(boundsSchema)
      .max(assetPlacementResourcePolicy.maximumExclusionsPerTarget),
    floorZMm: coordinateSchema,
    kind: z.literal("furnishing-zone"),
    levelId: uuidSchema,
    maximumHeightMm: dimensionSchema,
    spaceId: uuidSchema,
  })
  .strict()
  .superRefine(({ anchorPointsMm }, context) => {
    const keys = anchorPointsMm.map(({ xMm, yMm }) => `${String(xMm)}:${String(yMm)}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Anchor points must be unique.",
        path: ["anchorPointsMm"],
      });
    }
  });

const finishTargetSchema = z
  .object({
    ...targetCore,
    face: faceSchema,
    kind: z.literal("finish-face"),
    maximumApplicationThicknessMm: dimensionSchema,
    spaceId: uuidSchema.optional(),
    targetElementId: uuidSchema,
  })
  .strict();

const lightTargetSchema = z
  .object({
    ...targetCore,
    kind: z.literal("light-point"),
    levelId: uuidSchema,
    maximumEnvelopeHeightMm: dimensionSchema,
    mountFace: faceSchema,
    positionMm: z
      .object({ xMm: coordinateSchema, yMm: coordinateSchema, zMm: coordinateSchema })
      .strict(),
    spaceId: uuidSchema.optional(),
    targetElementId: uuidSchema,
  })
  .strict();

const requestSchema = z
  .object({
    catalog: z.unknown(),
    jobId: uuidSchema,
    projectId: uuidSchema,
    proposalAttribution: knownAttributionSchema,
    requestedMaximumCandidates: z
      .int()
      .positive()
      .max(assetPlacementResourcePolicy.maximumCandidatesPerRequest),
    schemaVersion: z.literal(assetPlacementRequestSchemaVersion),
    seedSha256: sha256Schema,
    sourcePins: z
      .object({
        acceptedBriefContentSha256: sha256Schema,
        constraintsSha256: sha256Schema,
        workingSnapshotSha256: sha256Schema,
      })
      .strict(),
    targets: z
      .array(
        z.discriminatedUnion("kind", [
          finishTargetSchema,
          furnishingTargetSchema,
          lightTargetSchema,
        ]),
      )
      .min(1)
      .max(assetPlacementResourcePolicy.maximumTargetsPerRequest),
  })
  .strict()
  .superRefine(({ proposalAttribution, targets }, context) => {
    const targetIds = targets.map(({ targetId }) => targetId);
    if (new Set(targetIds).size !== targetIds.length) {
      context.addIssue({
        code: "custom",
        message: "Target IDs must be unique.",
        path: ["targets"],
      });
    }
    if (new Set(proposalAttribution.evidenceIds).size !== proposalAttribution.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Proposal attribution evidence IDs must be unique.",
        path: ["proposalAttribution", "evidenceIds"],
      });
    }
  });

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBounds(
  left: z.infer<typeof boundsSchema>,
  right: z.infer<typeof boundsSchema>,
): number {
  return (
    left.minimumXMm - right.minimumXMm ||
    left.minimumYMm - right.minimumYMm ||
    left.maximumXMm - right.maximumXMm ||
    left.maximumYMm - right.maximumYMm
  );
}

export function parseAndNormalizePlacementRequest(
  value: unknown,
): AssetPlacementRequest | undefined {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const targets = parsed.data.targets
    .map((target) => {
      const shared = {
        ...target,
        ...(target.allowedAssetIds === undefined
          ? {}
          : { allowedAssetIds: [...target.allowedAssetIds].sort() }),
      };
      if (target.kind !== "furnishing-zone") return shared;
      return {
        ...shared,
        anchorPointsMm: [...target.anchorPointsMm].sort(
          (left, right) => left.xMm - right.xMm || left.yMm - right.yMm,
        ),
        exclusionsMm: [...target.exclusionsMm].sort(compareBounds),
      };
    })
    .sort((left, right) => compareStrings(left.targetId, right.targetId));
  return {
    ...parsed.data,
    catalog: parsed.data.catalog as AssetPlacementRequest["catalog"],
    proposalAttribution: {
      ...parsed.data.proposalAttribution,
      evidenceIds: [...parsed.data.proposalAttribution.evidenceIds].sort(compareStrings),
    },
    targets,
  };
}
