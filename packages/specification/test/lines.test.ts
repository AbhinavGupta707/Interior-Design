import { describe, expect, it } from "vitest";

import { buildInitialSpecificationLines, projectSpecificationSchedules } from "../src/index.js";
import type { SpecificationDomainError } from "../src/index.js";
import { catalogAsset, initialLinesInput, only } from "./support.js";

describe("one immutable specification-line truth", () => {
  it("pins every exact C12/catalog hash and derives bounded quantity and room state", () => {
    const [line] = buildInitialSpecificationLines(initialLinesInput());
    expect(line).toMatchObject({
      decisionStatus: "selected",
      kind: "furnishing",
      quantity: { count: 1, state: "counted" },
      roomAssignment: { status: "assigned" },
      selectionSource: { kind: "confirmed-option" },
    });
    expect(line?.assetContentSha256).toHaveLength(64);
    expect(line?.assetMetadataSha256).toHaveLength(64);
    expect(line?.assetVersionSha256).toHaveLength(64);
    expect(line?.catalogReleaseSha256).toHaveLength(64);
    expect(line?.placementPolicySha256).toHaveLength(64);
    expect(line?.placementProjectionSha256).toHaveLength(64);
    expect(line?.rightsRecordSha256).toHaveLength(64);
  });

  it("fails closed for a forged C12 hash and withdrawn rights", () => {
    const exact = initialLinesInput();
    const forged = structuredClone(exact);
    only(forged.bundle.assetPlacements).asset.contentSha256 = "0".repeat(64);
    expect(() => buildInitialSpecificationLines(forged)).toThrow(
      expect.objectContaining<Partial<SpecificationDomainError>>({
        code: "ASSET_BINDING_MISMATCH",
      }),
    );
    expect(() =>
      buildInitialSpecificationLines(initialLinesInput(catalogAsset({ lifecycle: "withdrawn" }))),
    ).toThrow(
      expect.objectContaining<Partial<SpecificationDomainError>>({ code: "ASSET_NOT_SELECTABLE" }),
    );
  });

  it("projects all four schedules from the same line object without a persisted copy", () => {
    const lines = buildInitialSpecificationLines(initialLinesInput());
    const schedules = projectSpecificationSchedules(lines);
    expect(schedules.element[0]?.lines[0]).toStrictEqual(lines[0]);
    expect(schedules.room[0]?.lines[0]).toStrictEqual(lines[0]);
    expect(schedules["product-light"][0]?.lines[0]).toStrictEqual(lines[0]);
    expect(schedules.finish).toEqual([]);
  });

  it("is stable across repeated declaration ordering samples", () => {
    const line = only(buildInitialSpecificationLines(initialLinesInput()));
    for (let sample = 0; sample < 128; sample += 1) {
      const input = sample % 2 === 0 ? [line] : [...[line]].reverse();
      expect(projectSpecificationSchedules(input)).toEqual(projectSpecificationSchedules([line]));
    }
  });
});
