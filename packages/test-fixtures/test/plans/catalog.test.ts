import { describe, expect, it } from "vitest";

import { sha256Hex } from "../../src/plans/bytes.js";
import { developmentPlanFixtures } from "../../src/plans/development-catalog.js";
import {
  holdoutAdversarialPlanFixtures,
  holdoutHardNegativePlanFixtures,
  holdoutInBoxPlanFixtures,
  holdoutPlanFixtures,
} from "../../src/plans/holdout/catalog.js";

describe("C6 rights-cleared plan fixtures", () => {
  it("pins source bytes, rights, split and training denial for every fixture", () => {
    const fixtures = [...developmentPlanFixtures, ...holdoutPlanFixtures];
    expect(fixtures.length).toBeGreaterThanOrEqual(30);
    expect(new Set(fixtures.map(({ id }) => id)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map(({ sha256 }) => sha256)).size).toBe(fixtures.length);

    for (const fixture of fixtures) {
      expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(sha256Hex(fixture.bytes)).toBe(fixture.sha256);
      expect(fixture.bytes.byteLength).toBeGreaterThan(16);
      expect(fixture.rights).toMatchObject({
        creator: "Interior Design C6 synthetic QA lane",
        licence: "CC0-1.0",
        origin: "generated-in-repository",
        right: "creator-dedicated",
        serviceProcessingConsent: true,
        synthetic: true,
        trainingUseConsent: "denied",
      });
      expect(fixture.rights.allowedPurpose).toEqual([
        "local-ci-evaluation",
        "security-testing",
        "ui-acceptance",
      ]);
      expect(fixture.scope.sourceStatus).toBe("ready");
      expect(fixture.scope.objectKey).toBe(`tenant/c6-synthetic/${fixture.id}`);
    }
  });

  it("keeps the declared holdout input box, hard negatives and attacks disjoint", () => {
    expect(holdoutInBoxPlanFixtures).toHaveLength(10);
    expect(holdoutHardNegativePlanFixtures).toHaveLength(6);
    expect(holdoutAdversarialPlanFixtures).toHaveLength(13);
    expect(holdoutPlanFixtures.every(({ rights }) => rights.split === "holdout")).toBe(true);
    expect(holdoutInBoxPlanFixtures.every(({ truth }) => truth !== undefined)).toBe(true);
    expect(
      holdoutHardNegativePlanFixtures.every(({ expected }) => expected.disposition === "abstained"),
    ).toBe(true);
    expect(
      holdoutAdversarialPlanFixtures.some(
        ({ expected }) => expected.textPolicy === "inert-label-only",
      ),
    ).toBe(true);
  });

  it("contains vector, PDF and raster evidence without customer or address strings", () => {
    const mimeTypes = new Set(holdoutPlanFixtures.map(({ mimeType }) => mimeType));
    expect(mimeTypes).toEqual(
      new Set(["application/pdf", "image/jpeg", "image/png", "image/svg+xml"]),
    );
    for (const fixture of holdoutPlanFixtures) {
      const printable = new TextDecoder("utf8", { fatal: false }).decode(fixture.bytes);
      expect(printable).not.toMatch(/postcode|uprn|customer|real[- ]?home|@gmail\.com/iu);
    }
  });
});
