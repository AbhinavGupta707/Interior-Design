import {
  InteriorAssetError,
  assetSha256,
  creatorOwnedSyntheticAssetCatalog,
  interiorAssetCatalogPolicy,
  parseAssetCatalogJson,
  safeInteriorAssetDiagnostic,
  validateAssetCatalog,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

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

function firstRecord(catalog: unknown): Record<string, unknown> {
  return record(array(record(catalog).assets)[0]);
}

function expectSafeCode(value: unknown, safeCode: string): void {
  expect(() => validateAssetCatalog(value)).toThrow(InteriorAssetError);
  try {
    validateAssetCatalog(value);
  } catch (error) {
    expect(safeInteriorAssetDiagnostic(error)).toEqual({ safeCode });
  }
}

describe("creator-owned synthetic asset catalog", () => {
  it("retains exact hashes, explicit integer geometry and the deny-by-default rights boundary", () => {
    const catalog = validateAssetCatalog(creatorOwnedSyntheticAssetCatalog);
    expect(catalog.assets.length).toBe(8);
    expect(new Set(catalog.assets.map(({ ref }) => ref.kind))).toEqual(
      new Set(["finish", "furnishing", "light"]),
    );
    for (const { content, metadata, ref } of catalog.assets) {
      const rights = {
        attributionRequired: ref.rights.attributionRequired,
        derivativesAllowed: ref.rights.derivativesAllowed,
        licenceId: ref.rights.licenceId,
        redistributionAllowed: ref.rights.redistributionAllowed,
        serviceProcessingAllowed: ref.rights.serviceProcessingAllowed,
        sourceKind: ref.rights.sourceKind,
        trainingAllowed: ref.rights.trainingAllowed,
        usage: ref.rights.usage,
      };
      const policy = {
        allowedRotationMilliDegrees: ref.placementPolicy.allowedRotationMilliDegrees,
        clearanceMm: ref.placementPolicy.clearanceMm,
        forwardAxis: ref.placementPolicy.forwardAxis,
        origin: ref.placementPolicy.origin,
      };
      expect(ref.contentSha256).toBe(assetSha256(content));
      expect(ref.metadataSha256).toBe(assetSha256(metadata));
      expect(ref.placementPolicy.policySha256).toBe(assetSha256(policy));
      expect(ref.rights.rightsRecordSha256).toBe(assetSha256(rights));
      expect(content.geometryEnvelopeMm).toEqual(ref.geometryEnvelopeMm);
      expect(content.coordinateConvention).toEqual({
        forwardAxis: "positive-y",
        handedness: "right",
        lengthUnit: "millimetre",
        origin: "bounding-box-centre-floor",
        xAxis: "right",
        yAxis: "forward",
        zAxis: "up",
      });
      expect(ref.rights).toMatchObject({
        derivativesAllowed: true,
        redistributionAllowed: false,
        serviceProcessingAllowed: true,
        sourceKind: "creator-owned-synthetic",
        trainingAllowed: false,
      });
      expect(JSON.stringify({ content, metadata, ref })).not.toMatch(
        /brand|price|stock|supplier|https?:|executable/iu,
      );
    }
  });

  it("canonicalizes insertion order while preserving one exact manifest hash", () => {
    const reordered = {
      ...creatorOwnedSyntheticAssetCatalog,
      assets: [...creatorOwnedSyntheticAssetCatalog.assets].reverse(),
    };
    const validated = validateAssetCatalog(reordered);
    expect(validated.manifestSha256).toBe(creatorOwnedSyntheticAssetCatalog.manifestSha256);
    expect(validated.assets.map(({ ref }) => ref.id)).toEqual(
      creatorOwnedSyntheticAssetCatalog.assets.map(({ ref }) => ref.id),
    );
  });

  it("rejects content, metadata, policy and manifest hash tampering", () => {
    for (const mutate of [
      (catalog: unknown) => {
        record(firstRecord(catalog).ref).contentSha256 = "0".repeat(64);
      },
      (catalog: unknown) => {
        record(firstRecord(catalog).ref).metadataSha256 = "1".repeat(64);
      },
      (catalog: unknown) => {
        record(record(firstRecord(catalog).ref).placementPolicy).policySha256 = "2".repeat(64);
      },
      (catalog: unknown) => {
        record(catalog).manifestSha256 = "3".repeat(64);
      },
    ]) {
      const tampered = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
      mutate(tampered);
      expectSafeCode(tampered, "ASSET_HASH_MISMATCH");
    }
  });

  it("rejects rights escalation and a forged rights hash fail-closed", () => {
    const escalated = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(record(firstRecord(escalated).ref).rights).trainingAllowed = true;
    expectSafeCode(escalated, "ASSET_RIGHTS_INVALID");

    const forged = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(record(firstRecord(forged).ref).rights).rightsRecordSha256 = "4".repeat(64);
    expectSafeCode(forged, "ASSET_HASH_MISMATCH");
  });

  it("rejects duplicate identities before accepting any manifest", () => {
    const duplicate = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    const assets = array(record(duplicate).assets);
    assets.push(cloneUnknown(assets[0]));
    expectSafeCode(duplicate, "ASSET_DUPLICATE");
  });

  it("rejects dimension, axis, rotation and clearance errors with stable codes", () => {
    const dimension = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(record(firstRecord(dimension).ref).geometryEnvelopeMm).widthMm = 0;
    expectSafeCode(dimension, "ASSET_DIMENSIONS_INVALID");

    const axis = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(record(firstRecord(axis).content).coordinateConvention).handedness = "left";
    expectSafeCode(axis, "ASSET_COORDINATE_CONVENTION_INVALID");

    const rotation = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(record(firstRecord(rotation).ref).placementPolicy).allowedRotationMilliDegrees = [
      45_000,
    ];
    expectSafeCode(rotation, "ASSET_ROTATIONS_INVALID");

    const clearance = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(record(firstRecord(clearance).ref).placementPolicy).clearanceMm = {
      back: -1,
      front: 0,
      left: 0,
      right: 0,
    };
    expectSafeCode(clearance, "ASSET_CLEARANCE_INVALID");
  });

  it("rejects hostile text, forbidden commerce/locator fields and accessors without leaking values", () => {
    const hostile = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(firstRecord(hostile).metadata).displayName = "\u001b[31mPRIVATE_ASSET_TOKEN";
    expectSafeCode(hostile, "ASSET_METADATA_HOSTILE");

    const forbidden = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    record(firstRecord(forbidden).metadata).price = 99;
    expectSafeCode(forbidden, "ASSET_METADATA_FORBIDDEN");

    let accessed = false;
    const accessor = Object.defineProperty({}, "assets", {
      enumerable: true,
      get() {
        accessed = true;
        return [];
      },
    });
    expectSafeCode(accessor, "ASSET_INPUT_MALFORMED");
    expect(accessed).toBe(false);

    const namedArray = cloneUnknown(creatorOwnedSyntheticAssetCatalog);
    const assetsWithProperty = array(record(namedArray).assets);
    Object.defineProperty(assetsWithProperty, "remoteLocator", {
      enumerable: true,
      value: "PRIVATE_REMOTE_VALUE",
    });
    expectSafeCode(namedArray, "ASSET_INPUT_MALFORMED");

    try {
      validateAssetCatalog(hostile);
    } catch (error) {
      expect(JSON.stringify(safeInteriorAssetDiagnostic(error))).not.toContain(
        "PRIVATE_ASSET_TOKEN",
      );
    }
  });

  it("bounds raw parsing before JSON allocation and rejects malformed UTF-8", () => {
    expect(() =>
      parseAssetCatalogJson("x".repeat(interiorAssetCatalogPolicy.maximumCatalogBytes + 1)),
    ).toThrow(expect.objectContaining({ safeCode: "ASSET_RESOURCE_LIMIT" }));
    expect(() => parseAssetCatalogJson(Uint8Array.from([0xc3, 0x28]))).toThrow(
      expect.objectContaining({ safeCode: "ASSET_INPUT_MALFORMED" }),
    );
  });
});
