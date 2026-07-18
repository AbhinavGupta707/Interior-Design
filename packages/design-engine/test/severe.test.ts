import type {
  DesignBrief,
  InteriorAssetRef,
  ModelOperationRequest,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { runDeterministicDesignEngine } from "../src/index.js";
import type { DesignCandidateTemplate } from "../src/types.js";
import {
  attribution,
  furnishingOperation,
  id,
  ids,
  known,
  makeAsset,
  makeExistingSnapshot,
  makeRequest,
  template,
} from "./support.js";

function twoFurnishingTemplates(
  asset: InteriorAssetRef,
  placements: readonly [
    {
      readonly rotation?: number;
      readonly xMm: number;
      readonly yMm: number;
      readonly zMm?: number;
    },
    {
      readonly rotation?: number;
      readonly xMm: number;
      readonly yMm: number;
      readonly zMm?: number;
    },
  ],
): readonly DesignCandidateTemplate[] {
  return placements.map((placement, index) => {
    const elementId = id(300 + index);
    const operation = furnishingOperation({
      asset,
      elementId,
      operationId: id(320 + index),
      xMm: placement.xMm,
      yMm: placement.yMm,
      ...(placement.rotation === undefined ? {} : { rotationMilliDegrees: placement.rotation }),
      ...(placement.zMm === undefined ? {} : { zMm: placement.zMm }),
    });
    return template({
      direction: index === 0 ? "circulation-first" : "conversation-first",
      elementId,
      objectives: index === 0 ? [9_000, 5_000] : [5_000, 9_000],
      operation,
      templateId: id(340 + index),
    });
  });
}

function expectFailure(
  request: unknown,
  code:
    | "INVALID_INPUT"
    | "MALFORMED_GEOMETRY"
    | "NO_FEASIBLE_CANDIDATE"
    | "NO_FEASIBLE_DIVERSE_SET"
    | "NUMERIC_RANGE_EXCEEDED"
    | "RESOURCE_LIMIT"
    | "SOURCE_PIN_MISMATCH"
    | "UNSUPPORTED_HARD_REQUIREMENT",
): void {
  const result = runDeterministicDesignEngine(request);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.abstention.code).toBe(code);
  expect(JSON.stringify(result)).not.toContain("Private household statement");
}

function addFixedObject(
  snapshot: ReturnType<typeof makeExistingSnapshot>,
  input: {
    readonly depthMm: number;
    readonly id: string;
    readonly widthMm: number;
    readonly xMm: number;
    readonly yMm: number;
  },
): void {
  snapshot.elements.fixedObjects.push({
    category: known("synthetic-fixed-object"),
    dimensions: known({ depthMm: input.depthMm, heightMm: 900, widthMm: input.widthMm }),
    elementType: "fixed-object",
    id: input.id,
    levelId: ids.level,
    name: known("Synthetic fixed object"),
    origin: attribution,
    placement: {
      position: known({ xMm: input.xMm, yMm: input.yMm, zMm: 0 }),
      rotationMilliDegrees: known(0),
    },
  });
}

describe("severe deterministic spatial validation", () => {
  it("rejects a rectangle whose corners lie in a concave room but whose edge crosses the notch", () => {
    const room = makeExistingSnapshot([
      { xMm: 0, yMm: 0 },
      { xMm: 4_000, yMm: 0 },
      { xMm: 4_000, yMm: 4_000 },
      { xMm: 3_000, yMm: 4_000 },
      { xMm: 3_000, yMm: 1_000 },
      { xMm: 1_000, yMm: 1_000 },
      { xMm: 1_000, yMm: 4_000 },
      { xMm: 0, yMm: 4_000 },
    ]);
    const asset = makeAsset({
      geometryEnvelopeMm: { depthMm: 500, heightMm: 800, widthMm: 2_500 },
    });
    const candidates = twoFurnishingTemplates(asset, [
      { xMm: 2_000, yMm: 2_500 },
      { xMm: 2_000, yMm: 3_200 },
    ]);
    expectFailure(
      makeRequest({ assets: [asset], candidateTemplates: candidates, existing: room }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("applies the explicit room-boundary touch policy with no epsilon", () => {
    const asset = makeAsset();
    const candidates = twoFurnishingTemplates(asset, [
      { xMm: 500, yMm: 700 },
      { xMm: 500, yMm: 1_500 },
    ]);
    expect(
      runDeterministicDesignEngine(makeRequest({ assets: [asset], candidateTemplates: candidates }))
        .ok,
    ).toBe(true);
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: candidates,
        touch: { keepOut: "forbid", obstacle: "allow", room: "forbid" },
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("allows exact obstacle contact but rejects a one-millimetre overlap", () => {
    const room = makeExistingSnapshot();
    addFixedObject(room, { depthMm: 500, id: ids.fixed, widthMm: 1_000, xMm: 2_000, yMm: 1_000 });
    const asset = makeAsset();
    const touching = twoFurnishingTemplates(asset, [
      { xMm: 3_000, yMm: 1_000 },
      { xMm: 1_000, yMm: 1_000 },
    ]);
    expect(
      runDeterministicDesignEngine(
        makeRequest({ assets: [asset], candidateTemplates: touching, existing: room }),
      ).ok,
    ).toBe(true);
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: touching,
        existing: room,
        touch: { keepOut: "forbid", obstacle: "forbid", room: "allow" },
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
    const overlapping = twoFurnishingTemplates(asset, [
      { xMm: 2_999, yMm: 1_000 },
      { xMm: 1_001, yMm: 1_000 },
    ]);
    expectFailure(
      makeRequest({ assets: [asset], candidateTemplates: overlapping, existing: room }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("applies asymmetric per-side clearance before rotation and collision testing", () => {
    const room = makeExistingSnapshot();
    addFixedObject(room, {
      depthMm: 500,
      id: id(360),
      widthMm: 1_000,
      xMm: 1_200,
      yMm: 1_750,
    });
    addFixedObject(room, {
      depthMm: 500,
      id: id(361),
      widthMm: 1_000,
      xMm: 3_200,
      yMm: 1_750,
    });
    const base = makeAsset();
    const asset = makeAsset({
      placementPolicy: {
        ...base.placementPolicy,
        clearanceMm: { back: 0, front: 500, left: 0, right: 0 },
        policySha256: "9".repeat(64),
      },
    });
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: twoFurnishingTemplates(asset, [
          { xMm: 1_200, yMm: 1_000 },
          { xMm: 3_200, yMm: 1_000 },
        ]),
        existing: room,
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("rejects collisions against retained canonical furnishings as well as fixed objects", () => {
    const room = makeExistingSnapshot();
    room.elements.furnishings.push({
      category: known("existing-seat"),
      dimensions: known({ depthMm: 500, heightMm: 800, widthMm: 1_000 }),
      elementType: "furnishing",
      id: id(370),
      levelId: ids.level,
      name: known("Existing synthetic seat"),
      origin: attribution,
      placement: {
        position: known({ xMm: 2_000, yMm: 1_000, zMm: 0 }),
        rotationMilliDegrees: known(0),
      },
    });
    const asset = makeAsset();
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: twoFurnishingTemplates(asset, [
          { xMm: 2_001, yMm: 1_000 },
          { xMm: 1_999, yMm: 1_000 },
        ]),
        existing: room,
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("validates arbitrary milli-degree and cardinal rotations deterministically", () => {
    const asset = makeAsset();
    const request = makeRequest({
      assets: [asset],
      candidateTemplates: twoFurnishingTemplates(asset, [
        { rotation: 45_000, xMm: 1_500, yMm: 1_500 },
        { rotation: 90_000, xMm: 3_500, yMm: 1_500 },
      ]),
    });
    const first = runDeterministicDesignEngine(request);
    expect(first.ok).toBe(true);
    expect(runDeterministicDesignEngine(structuredClone(request))).toEqual(first);
  });

  it("rejects explicit keep-out intersection and honours keep-out boundary contact", () => {
    const asset = makeAsset();
    const candidates = twoFurnishingTemplates(asset, [
      { xMm: 1_500, yMm: 1_500 },
      { xMm: 1_600, yMm: 1_500 },
    ]);
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: candidates,
        keepOuts: [
          {
            id: id(400),
            levelId: ids.level,
            polygon: [
              { xMm: 1_250, yMm: 1_250 },
              { xMm: 1_750, yMm: 1_250 },
              { xMm: 1_750, yMm: 1_750 },
              { xMm: 1_250, yMm: 1_750 },
            ],
            sourceElementIds: [],
          },
        ],
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("abstains on vertical overflow before declaring a candidate valid", () => {
    const asset = makeAsset();
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: twoFurnishingTemplates(asset, [
          { xMm: 1_200, yMm: 1_000, zMm: 2_201 },
          { xMm: 3_200, yMm: 1_000, zMm: 2_201 },
        ]),
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("returns typed numeric, malformed-polygon and resource-ceiling abstentions", () => {
    const numeric = makeRequest({
      keepOuts: [
        {
          id: id(410),
          levelId: ids.level,
          polygon: [
            { xMm: Number.MAX_SAFE_INTEGER, yMm: 0 },
            { xMm: 100, yMm: 0 },
            { xMm: 100, yMm: 100 },
          ],
          sourceElementIds: [],
        },
      ],
    });
    expectFailure(numeric, "NUMERIC_RANGE_EXCEEDED");

    const malformed = makeRequest({
      keepOuts: [
        {
          id: id(411),
          levelId: ids.level,
          polygon: [
            { xMm: 0, yMm: 0 },
            { xMm: 100, yMm: 100 },
            { xMm: 0, yMm: 100 },
            { xMm: 100, yMm: 0 },
          ],
          sourceElementIds: [],
        },
      ],
    });
    expectFailure(malformed, "MALFORMED_GEOMETRY");

    expectFailure(
      {
        ...makeRequest(),
        keepOuts: [
          {
            id: id(412),
            levelId: ids.level,
            polygon: [
              { xMm: 0.5, yMm: 0 },
              { xMm: 100, yMm: 0 },
              { xMm: 100, yMm: 100 },
            ],
            sourceElementIds: [],
          },
        ],
      },
      "INVALID_INPUT",
    );

    const request = makeRequest();
    const tooManyAssets = Array.from({ length: 501 }, (_, index) => ({
      ...makeAsset(),
      id: id(1_000 + index),
      versionId: id(2_000 + index),
    }));
    expectFailure({ ...request, assets: tooManyAssets }, "RESOURCE_LIMIT");
  });

  it("fails closed on stale source pins and forged asset bindings", () => {
    const request = makeRequest();
    expectFailure(
      {
        ...request,
        workingModel: { ...request.workingModel, snapshotSha256: "0".repeat(64) },
      },
      "SOURCE_PIN_MISMATCH",
    );
    const candidateTemplates = request.candidateTemplates.map((candidate) => ({
      ...candidate,
      operations: candidate.operations.map((operation) =>
        operation.type === "design.element.create.v1"
          ? {
              ...operation,
              assetBinding: { ...operation.assetBinding, contentSha256: "f".repeat(64) },
            }
          : operation,
      ),
    }));
    expectFailure({ ...request, candidateTemplates }, "NO_FEASIBLE_CANDIDATE");
  });
});

describe("hard requirement and finish target boundaries", () => {
  it("abstains and routes an unsupported private hard requirement without echoing its prose", () => {
    const entry: DesignBrief["entries"][number] = {
      category: "accessibility",
      classification: "hard-constraint",
      id: id(500),
      priority: 5,
      provenance: {
        capturedAt: "2026-07-18T09:30:00.000Z",
        method: "user-stated",
        statedByUserId: ids.actor,
      },
      roomOrLevelElementIds: [],
      statement: "Private household statement",
      status: "active",
    };
    const result = runDeterministicDesignEngine(makeRequest({ briefEntries: [entry] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.abstention).toMatchObject({
      code: "UNSUPPORTED_HARD_REQUIREMENT",
      professionalReviewReasons: ["accessibility-clinical"],
    });
    expect(JSON.stringify(result)).not.toContain(entry.statement);
  });

  it("compares retained-element hashes and rejects removal", () => {
    const room = makeExistingSnapshot();
    const retainedId = id(510);
    room.elements.furnishings.push({
      category: known("retained-seat"),
      dimensions: known({ depthMm: 400, heightMm: 700, widthMm: 600 }),
      elementType: "furnishing",
      id: retainedId,
      levelId: ids.level,
      name: known("Retained synthetic seat"),
      origin: attribution,
      placement: {
        position: known({ xMm: 4_400, yMm: 3_500, zMm: 0 }),
        rotationMilliDegrees: known(0),
      },
    });
    const entry: DesignBrief["entries"][number] = {
      category: "retained-item",
      classification: "hard-constraint",
      id: id(511),
      priority: 5,
      provenance: {
        capturedAt: "2026-07-18T09:30:00.000Z",
        method: "user-stated",
        statedByUserId: ids.actor,
      },
      roomOrLevelElementIds: [retainedId],
      statement: "Retain the synthetic seat.",
      status: "active",
    };
    const fact = {
      briefEntryId: entry.id,
      kind: "retain-element" as const,
      retainedElementId: retainedId,
    };
    expect(
      runDeterministicDesignEngine(
        makeRequest({ briefConstraintFacts: [fact], briefEntries: [entry], existing: room }),
      ).ok,
    ).toBe(true);

    const asset = makeAsset();
    const candidates = twoFurnishingTemplates(asset, [
      { xMm: 1_200, yMm: 1_000 },
      { xMm: 3_200, yMm: 1_000 },
    ]).map((candidate, index) => ({
      ...candidate,
      operations: [
        {
          clientOperationId: id(520 + index),
          reason: "Remove a retained element to prove the exact hash guard.",
          schemaVersion: "c12-design-element-operation-v1" as const,
          target: { collection: "furnishings" as const, elementId: retainedId },
          type: "design.element.remove.v1" as const,
        },
        ...candidate.operations,
      ],
    }));
    expectFailure(
      makeRequest({
        assets: [asset],
        briefConstraintFacts: [fact],
        briefEntries: [entry],
        candidateTemplates: candidates,
        existing: room,
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });

  it("rejects a finish face outside the frozen valid target declaration", () => {
    const room = makeExistingSnapshot();
    addFixedObject(room, { depthMm: 500, id: ids.fixed, widthMm: 1_000, xMm: 4_000, yMm: 3_000 });
    const asset = makeAsset({ id: id(530), kind: "finish", versionId: id(531) });
    const finishOperation = (
      elementId: string,
      operationId: string,
      face: "inside" | "top",
    ): Extract<ModelOperationRequest, { readonly type: "design.element.create.v1" }> => ({
      assetBinding: {
        assetId: asset.id,
        assetVersionId: asset.versionId,
        contentSha256: asset.contentSha256,
        metadataSha256: asset.metadataSha256,
        placementPolicySha256: asset.placementPolicy.policySha256,
        rightsRecordSha256: asset.rights.rightsRecordSha256,
      },
      clientOperationId: operationId,
      element: {
        elementType: "finish",
        face,
        id: elementId,
        material: known("Synthetic finish"),
        name: known("Synthetic finish"),
        origin: attribution,
        targetElementId: ids.fixed,
      },
      reason: "Apply a creator-owned synthetic finish.",
      schemaVersion: "c12-design-element-operation-v1",
      type: "design.element.create.v1",
    });
    const candidates: DesignCandidateTemplate[] = [0, 1].map((index) => {
      const elementId = id(540 + index);
      const operation = finishOperation(elementId, id(550 + index), index === 0 ? "inside" : "top");
      return {
        assetPlacements: [
          {
            assignmentKey: "primary-finish",
            assetVersionId: asset.versionId,
            elementId,
          },
        ],
        direction: index === 0 ? "circulation-first" : "conversation-first",
        objectives: [
          {
            basisPoints: index === 0 ? 9_000 : 5_000,
            id: "circulation",
            rationale: "Synthetic objective.",
          },
          {
            basisPoints: index === 0 ? 5_000 : 9_000,
            id: "conversation",
            rationale: "Synthetic objective.",
          },
        ],
        operations: [operation],
        templateId: id(560 + index),
      };
    });
    expect(
      runDeterministicDesignEngine(
        makeRequest({
          assets: [asset],
          candidateTemplates: candidates,
          existing: room,
          finishTargets: [{ allowedFaces: ["inside", "top"], targetElementId: ids.fixed }],
        }),
      ).ok,
    ).toBe(true);
    expectFailure(
      makeRequest({
        assets: [asset],
        candidateTemplates: candidates,
        existing: room,
        finishTargets: [{ allowedFaces: ["outside"], targetElementId: ids.fixed }],
      }),
      "NO_FEASIBLE_CANDIDATE",
    );
  });
});
