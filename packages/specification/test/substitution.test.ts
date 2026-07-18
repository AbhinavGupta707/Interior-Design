import { describe, expect, it } from "vitest";

import {
  buildCatalogReplacementOperation,
  buildInitialSpecificationLines,
  previewCatalogReplacement,
  substituteSpecificationLine,
} from "../src/index.js";
import type { SpecificationDomainError } from "../src/index.js";
import { catalogAsset, initialLinesInput, only, snapshot } from "./support.js";

describe("exact C5 catalog substitution", () => {
  it("preserves stable identity/type/placement/origin and replaces catalog-derived furnishing values", () => {
    const currentSnapshot = snapshot();
    const currentLine = only(buildInitialSpecificationLines(initialLinesInput()));
    const replacement = catalogAsset({
      versionId: "c1300000-0000-4000-8000-000000000099",
      widthMm: 1_200,
    });
    const operation = buildCatalogReplacementOperation({
      currentLine,
      replacementAsset: replacement,
      snapshot: currentSnapshot,
    });
    const existing = only(currentSnapshot.elements.furnishings);
    expect(operation).toMatchObject({
      element: {
        elementType: "furnishing",
        id: existing.id,
        placement: existing.placement,
        origin: existing.origin,
      },
      expectedElementId: existing.id,
      schemaVersion: "c12-design-element-operation-v1",
      type: "design.element.replace.v1",
    });
    expect(
      operation.element.elementType === "furnishing" && operation.element.dimensions,
    ).toMatchObject({
      knowledge: "known",
      value: { widthMm: 1_200 },
    });
  });

  it("rejects cross-kind and existing/as-built mutation", () => {
    const line = only(buildInitialSpecificationLines(initialLinesInput()));
    expect(() =>
      buildCatalogReplacementOperation({
        currentLine: line,
        replacementAsset: catalogAsset({ kind: "finish" }),
        snapshot: snapshot(),
      }),
    ).toThrow(
      expect.objectContaining<Partial<SpecificationDomainError>>({
        code: "CROSS_KIND_REPLACEMENT",
      }),
    );
    expect(() =>
      previewCatalogReplacement({
        currentLine: line,
        replacementAsset: catalogAsset({ versionId: "c1300000-0000-4000-8000-000000000098" }),
        snapshot: snapshot("existing"),
      }),
    ).toThrow();
  });

  it("fails closed on an exact one-millimetre containment breach", () => {
    const line = only(buildInitialSpecificationLines(initialLinesInput()));
    // Centre x=1500 in a 0..3000 room: width 3002 crosses both sides by exactly 1 mm.
    expect(() =>
      previewCatalogReplacement({
        currentLine: line,
        replacementAsset: catalogAsset({
          versionId: "c1300000-0000-4000-8000-000000000097",
          widthMm: 3_002,
        }),
        snapshot: snapshot(),
      }),
    ).toThrow(
      expect.objectContaining<Partial<SpecificationDomainError>>({ code: "GEOMETRY_INVALID" }),
    );
  });

  it("holds the integer containment boundary across a deterministic property sweep", () => {
    const line = only(buildInitialSpecificationLines(initialLinesInput()));
    for (let deltaMm = -128; deltaMm <= 128; deltaMm += 1) {
      const widthMm = 3_000 + deltaMm;
      const versionId = `c1300000-0000-4000-8000-${(10_000 + deltaMm).toString().padStart(12, "0")}`;
      const invoke = () =>
        previewCatalogReplacement({
          currentLine: line,
          replacementAsset: catalogAsset({ versionId, widthMm }),
          snapshot: snapshot(),
        });
      if (widthMm <= 3_000) {
        expect(invoke).not.toThrow();
      } else {
        expect(invoke).toThrow(
          expect.objectContaining<Partial<SpecificationDomainError>>({ code: "GEOMETRY_INVALID" }),
        );
      }
    }
  });

  it("updates only exact catalog pins on the single schedule line", () => {
    const current = only(buildInitialSpecificationLines(initialLinesInput()));
    const replacement = catalogAsset({ versionId: "c1300000-0000-4000-8000-000000000096" });
    const next = substituteSpecificationLine({
      confirmationId: "c1300000-0000-4000-8000-000000000095",
      current,
      replacementAsset: replacement,
    });
    expect(next).toMatchObject({
      elementId: current.elementId,
      levelId: current.levelId,
      lineId: current.lineId,
      roomAssignment: current.roomAssignment,
      selectionSource: { kind: "confirmed-substitution" },
    });
    expect(next.assetVersionId).toBe(replacement.versionId);
  });
});
