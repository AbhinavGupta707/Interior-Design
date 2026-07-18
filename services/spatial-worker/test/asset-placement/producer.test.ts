import { modelOperationRequestSchema } from "@interior-design/contracts";
import {
  assetSha256,
  creatorOwnedSyntheticAssetCatalog,
  deterministicC12Uuid,
} from "@interior-design/interior-assets";
import { describe, expect, it } from "vitest";

import {
  DeterministicAssetPlacementProducer,
  assetPlacementRequestSchemaVersion,
  assetPlacementResourcePolicy,
  type AssetPlacementRequest,
  type FurnishingPlacementTarget,
} from "../../src/asset-placement/index.js";

const hash = (character: string) => character.repeat(64);
const id = (name: string) => deterministicC12Uuid(`c12:asset-placement-test:${name}`);

function cloneUnknown(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Fixture value is not a record.");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Fixture value is not an array.");
  return value;
}

function baseRequest(): AssetPlacementRequest {
  return {
    catalog: creatorOwnedSyntheticAssetCatalog,
    jobId: id("job"),
    projectId: id("project"),
    proposalAttribution: {
      claimId: id("claim"),
      evidenceIds: [id("evidence-b"), id("evidence-a")],
      method: { kind: "system", name: "C12 deterministic placement test", version: "1.0.0" },
      state: "source-derived",
      verification: { status: "not-reviewed" },
    },
    requestedMaximumCandidates: 100,
    schemaVersion: assetPlacementRequestSchemaVersion,
    seedSha256: hash("1"),
    sourcePins: {
      acceptedBriefContentSha256: hash("2"),
      constraintsSha256: hash("3"),
      workingSnapshotSha256: hash("4"),
    },
    targets: [
      {
        anchorPointsMm: [{ xMm: 0, yMm: 0 }],
        boundsMm: {
          maximumXMm: 5_000,
          maximumYMm: 5_000,
          minimumXMm: -5_000,
          minimumYMm: -5_000,
        },
        exclusionsMm: [],
        floorZMm: 0,
        kind: "furnishing-zone",
        levelId: id("level"),
        maximumHeightMm: 3_000,
        spaceId: id("space"),
        targetId: id("furnishing-target"),
      },
      {
        face: "top",
        kind: "finish-face",
        maximumApplicationThicknessMm: 20,
        spaceId: id("space"),
        targetElementId: id("floor-surface"),
        targetId: id("finish-target"),
      },
      {
        kind: "light-point",
        levelId: id("level"),
        maximumEnvelopeHeightMm: 1_000,
        mountFace: "bottom",
        positionMm: { xMm: 0, yMm: 0, zMm: 2_400 },
        spaceId: id("space"),
        targetElementId: id("ceiling-surface"),
        targetId: id("light-target"),
      },
    ],
  };
}

function sofaId(): string {
  const asset = creatorOwnedSyntheticAssetCatalog.assets.find(
    ({ ref }) => ref.category === "three-seat-sofa",
  );
  if (asset === undefined) throw new TypeError("Synthetic sofa fixture is missing.");
  return asset.ref.id;
}

function floorFinishId(): string {
  const asset = creatorOwnedSyntheticAssetCatalog.assets.find(
    ({ ref }) => ref.category === "floor-finish-timber-tone",
  );
  if (asset === undefined) throw new TypeError("Synthetic finish fixture is missing.");
  return asset.ref.id;
}

function clearanceTarget(
  exclusionsMm: FurnishingPlacementTarget["exclusionsMm"] = [],
): FurnishingPlacementTarget {
  return {
    allowedAssetIds: [sofaId()],
    anchorPointsMm: [{ xMm: 0, yMm: 0 }],
    boundsMm: {
      maximumXMm: 1_150,
      maximumYMm: 1_250,
      minimumXMm: -1_150,
      minimumYMm: -500,
    },
    exclusionsMm,
    floorZMm: 0,
    kind: "furnishing-zone",
    levelId: id("level"),
    maximumHeightMm: 1_000,
    spaceId: id("space"),
    targetId: id("clearance-target"),
  };
}

describe("deterministic asset placement producer", () => {
  it("produces furnishing, finish and light candidates with exact retained asset bindings", async () => {
    const result = await new DeterministicAssetPlacementProducer().produce(
      baseRequest(),
      new AbortController().signal,
    );
    expect(result.status).toBe("produced");
    if (result.status !== "produced") return;
    expect(new Set(result.candidates.map(({ asset }) => asset.kind))).toEqual(
      new Set(["finish", "furnishing", "light"]),
    );
    for (const candidate of result.candidates) {
      const operation = modelOperationRequestSchema.parse(candidate.operation);
      expect(
        operation.type === "design.element.create.v1" ||
          operation.type === "design.element.replace.v1",
      ).toBe(true);
      if (
        operation.type !== "design.element.create.v1" &&
        operation.type !== "design.element.replace.v1"
      ) {
        continue;
      }
      expect(operation.element.id).toBe(candidate.elementId);
      expect(operation.assetBinding).toEqual({
        assetId: candidate.asset.id,
        assetVersionId: candidate.asset.versionId,
        contentSha256: candidate.asset.contentSha256,
        metadataSha256: candidate.asset.metadataSha256,
        placementPolicySha256: candidate.asset.placementPolicy.policySha256,
        rightsRecordSha256: candidate.asset.rights.rightsRecordSha256,
      });
    }
    const manifest = Object.fromEntries(
      Object.entries(result.manifest).filter(([key]) => key !== "manifestSha256"),
    );
    expect(result.manifest.manifestSha256).toBe(assetSha256(manifest));
    expect(result.manifest.externalNetworkUsed).toBe(false);
  });

  it("returns byte-identical candidates and retry manifest across repeated and insertion-order variants", async () => {
    const producer = new DeterministicAssetPlacementProducer();
    const direct = await producer.produce(baseRequest(), new AbortController().signal);
    const reorderedRequest = baseRequest();
    const reordered = {
      ...reorderedRequest,
      catalog: {
        ...reorderedRequest.catalog,
        assets: [...reorderedRequest.catalog.assets].reverse(),
      },
      proposalAttribution: {
        ...reorderedRequest.proposalAttribution,
        evidenceIds: [...reorderedRequest.proposalAttribution.evidenceIds].reverse(),
      },
      targets: [...reorderedRequest.targets].reverse(),
    };
    const second = await producer.produce(reordered, new AbortController().signal);
    expect(second).toEqual(direct);
  });

  it("uses exact per-side clearance, allows edge contact and rejects a one-millimetre collision", async () => {
    const producer = new DeterministicAssetPlacementProducer();
    const touching = {
      ...baseRequest(),
      requestedMaximumCandidates: 10,
      targets: [
        clearanceTarget([
          { maximumXMm: 1_200, maximumYMm: 1_250, minimumXMm: 1_150, minimumYMm: -500 },
        ]),
      ],
    };
    const touchingResult = await producer.produce(touching, new AbortController().signal);
    expect(touchingResult.status).toBe("produced");
    if (touchingResult.status === "produced") {
      expect(touchingResult.candidates).toHaveLength(1);
      expect(touchingResult.candidates[0]?.clearanceBounds2Mm).toEqual({
        coordinateScale: "two-integer-units-per-millimetre",
        maximumX2Mm: 2_300,
        maximumY2Mm: 2_500,
        minimumX2Mm: -2_300,
        minimumY2Mm: -1_000,
      });
    }

    const colliding = {
      ...touching,
      targets: [
        clearanceTarget([
          { maximumXMm: 1_200, maximumYMm: 1_250, minimumXMm: 1_149, minimumYMm: -500 },
        ]),
      ],
    };
    const collisionResult = await producer.produce(colliding, new AbortController().signal);
    expect(collisionResult).toMatchObject({
      safeCode: "NO_FEASIBLE_PLACEMENTS",
      status: "abstained",
    });
  });

  it("matches finish and light target faces without substituting an incompatible asset", async () => {
    const request = baseRequest();
    const result = await new DeterministicAssetPlacementProducer().produce(
      { ...request, targets: request.targets.slice(1) },
      new AbortController().signal,
    );
    expect(result.status).toBe("produced");
    if (result.status !== "produced") return;
    const finishes = result.candidates.filter(({ asset }) => asset.kind === "finish");
    const lights = result.candidates.filter(({ asset }) => asset.kind === "light");
    expect(finishes.map(({ asset }) => asset.category)).toEqual(["floor-finish-timber-tone"]);
    expect(finishes[0]?.targetFace).toBe("top");
    expect(lights.map(({ asset }) => asset.category)).toEqual(["pendant-light"]);
    expect(lights[0]?.targetFace).toBe("bottom");
  });

  it("retains a stable element ID for replacement operations", async () => {
    const request = baseRequest();
    const replacementId = id("replacement-finish");
    const target = request.targets.find(({ kind }) => kind === "finish-face");
    if (target === undefined || target.kind !== "finish-face")
      throw new TypeError("Finish target missing.");
    const result = await new DeterministicAssetPlacementProducer().produce(
      {
        ...request,
        targets: [
          { ...target, allowedAssetIds: [floorFinishId()], replaceElementId: replacementId },
        ],
      },
      new AbortController().signal,
    );
    expect(result.status).toBe("produced");
    if (result.status !== "produced") return;
    expect(result.candidates[0]?.elementId).toBe(replacementId);
    expect(result.candidates[0]?.operation).toMatchObject({
      element: { id: replacementId },
      expectedElementId: replacementId,
      type: "design.element.replace.v1",
    });
  });

  it("fails before search when the deterministic evaluation ceiling would be exceeded", async () => {
    const template = clearanceTarget();
    const { allowedAssetIds: _allowedAssetIds, ...unrestrictedTemplate } = template;
    void _allowedAssetIds;
    const targets = Array.from(
      { length: assetPlacementResourcePolicy.maximumTargetsPerRequest },
      (_, targetIndex) => ({
        ...unrestrictedTemplate,
        anchorPointsMm: Array.from(
          { length: assetPlacementResourcePolicy.maximumAnchorPointsPerTarget },
          (_entry, anchorIndex) => ({ xMm: anchorIndex * 10, yMm: targetIndex * 10 }),
        ),
        boundsMm: {
          maximumXMm: 5_000,
          maximumYMm: 5_000,
          minimumXMm: -5_000,
          minimumYMm: -5_000,
        },
        targetId: id(`resource-target-${String(targetIndex)}`),
      }),
    );
    const result = await new DeterministicAssetPlacementProducer().produce(
      { ...baseRequest(), requestedMaximumCandidates: 1, targets },
      new AbortController().signal,
    );
    expect(result).toEqual({ safeCode: "PLACEMENT_RESOURCE_LIMIT", status: "failed" });
  });

  it("returns explicit honest abstention for absent and infeasible applicable assets", async () => {
    const request = baseRequest();
    const noApplicable = await new DeterministicAssetPlacementProducer().produce(
      {
        ...request,
        targets: [{ ...clearanceTarget(), allowedAssetIds: [floorFinishId()] }],
      },
      new AbortController().signal,
    );
    expect(noApplicable).toMatchObject({ safeCode: "NO_APPLICABLE_ASSETS", status: "abstained" });

    const infeasible = await new DeterministicAssetPlacementProducer().produce(
      {
        ...request,
        targets: [
          {
            ...clearanceTarget(),
            boundsMm: { maximumXMm: 100, maximumYMm: 100, minimumXMm: -100, minimumYMm: -100 },
          },
        ],
      },
      new AbortController().signal,
    );
    expect(infeasible).toMatchObject({ safeCode: "NO_FEASIBLE_PLACEMENTS", status: "abstained" });
  });

  it("fails closed on rights tampering and hostile text without exposing the payload", async () => {
    const request = baseRequest();
    const rightsCatalog = cloneUnknown(request.catalog);
    const firstRights = record(record(record(array(record(rightsCatalog).assets)[0]).ref).rights);
    firstRights.trainingAllowed = true;
    const rights = await new DeterministicAssetPlacementProducer().produce(
      { ...request, catalog: rightsCatalog },
      new AbortController().signal,
    );
    expect(rights).toEqual({ safeCode: "ASSET_RIGHTS_INVALID", status: "failed" });

    const hostileCatalog = cloneUnknown(request.catalog);
    const firstMetadata = record(record(array(record(hostileCatalog).assets)[0]).metadata);
    firstMetadata.displayName = "\u001b[31mPRIVATE_PLACEMENT_TOKEN";
    const hostile = await new DeterministicAssetPlacementProducer().produce(
      { ...request, catalog: hostileCatalog },
      new AbortController().signal,
    );
    expect(hostile).toEqual({ safeCode: "ASSET_METADATA_HOSTILE", status: "failed" });
    expect(JSON.stringify(hostile)).not.toContain("PRIVATE_PLACEMENT_TOKEN");
  });

  it("honours cancellation before work and at the asynchronous search boundary", async () => {
    const producer = new DeterministicAssetPlacementProducer();
    const preCancelled = new AbortController();
    preCancelled.abort();
    await expect(producer.produce(baseRequest(), preCancelled.signal)).resolves.toEqual({
      safeCode: "PLACEMENT_CANCELLED",
      status: "cancelled",
    });

    const boundaryCancellation = new AbortController();
    queueMicrotask(() => {
      boundaryCancellation.abort();
    });
    await expect(producer.produce(baseRequest(), boundaryCancellation.signal)).resolves.toEqual({
      safeCode: "PLACEMENT_CANCELLED",
      status: "cancelled",
    });
  });

  it("rejects malformed worker envelopes without echoing their values", async () => {
    const malformed = { ...baseRequest(), bearerToken: "PRIVATE_BEARER_VALUE" };
    const result = await new DeterministicAssetPlacementProducer().produce(
      malformed,
      new AbortController().signal,
    );
    expect(result).toEqual({ safeCode: "PLACEMENT_INPUT_INVALID", status: "failed" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_BEARER_VALUE");
  });
});
