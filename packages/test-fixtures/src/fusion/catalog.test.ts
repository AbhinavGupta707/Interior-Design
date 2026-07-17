import { describe, expect, it } from "vitest";

import {
  fusionAcceptanceFixtures,
  fusionAdversarialFixtures,
  fusionFixtureRights,
} from "./catalog.js";
import { deterministicSha256 } from "./deterministic.js";

describe("C9 synthetic fusion fixtures", () => {
  it("is visibly synthetic, rights-cleared, training-denied and hash-addressed", () => {
    const fixtureIds = new Set<string>();
    const sourceReferences = new Set<string>();
    for (const fixture of fusionAcceptanceFixtures) {
      expect(fixtureIds.has(fixture.id)).toBe(false);
      fixtureIds.add(fixture.id);
      expect(fixture.visiblySynthetic).toBe(true);
      expect(fixture.rights).toBe(fusionFixtureRights);
      expect(fixture.rights).toMatchObject({
        serviceProcessingConsent: true,
        synthetic: true,
        trainingUseConsent: "denied",
      });
      const { manifestSha256, ...manifest } = fixture;
      expect(manifestSha256).toBe(deterministicSha256(manifest));
      expect(manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.isFrozen(fixture.truth.roomDimensions)).toBe(true);

      for (const source of fixture.sources) {
        const referenceKey = `${fixture.id}:${source.kind}:${source.referenceId}`;
        expect(sourceReferences.has(referenceKey)).toBe(false);
        sourceReferences.add(referenceKey);
        expect(source.referenceSha256).toBe(deterministicSha256(source.referencePayload));
        expect(source.rights.trainingUseConsent).toBe("denied");
        expect(source.referencePayload.syntheticLabel).toContain("VISIBLY SYNTHETIC C9");
      }
    }
  });

  it("contains every required source kind and failure-inclusive geometry condition", () => {
    const sourceKinds = new Set(
      fusionAcceptanceFixtures.flatMap(({ sources }) => sources.map(({ kind }) => kind)),
    );
    expect(sourceKinds).toEqual(
      new Set([
        "measurement-set",
        "plan-proposal",
        "reconstruction-result",
        "roomplan-proposal",
        "user-assertion-set",
      ]),
    );
    expect(fusionAcceptanceFixtures.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scale-level-drift"),
        expect.stringContaining("missing-extra-outlier"),
        expect.stringContaining("disconnected-occluded"),
        expect.stringContaining("degenerate-collinear"),
        expect.stringContaining("reflection"),
      ]),
    );
    expect(
      fusionAcceptanceFixtures.some(({ truth }) => truth.requiredUnknownRegionIds.length > 0),
    ).toBe(true);
    expect(
      fusionAcceptanceFixtures.some(({ truth }) => truth.expectedConnectedComponentCount > 1),
    ).toBe(true);
  });

  it("uses only safe integer millimetres, microdegrees, ppm, counts and observations", () => {
    const inspect = (value: unknown): void => {
      if (typeof value === "number") {
        expect(Number.isSafeInteger(value)).toBe(true);
        return;
      }
      if (Array.isArray(value)) {
        for (const child of value) inspect(child);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) inspect(child);
      }
    };
    inspect(fusionAcceptanceFixtures);
  });

  it("includes deterministic adversarial cases without executable payloads", () => {
    expect(fusionAdversarialFixtures.map(({ kind }) => kind).sort()).toEqual([
      "collinear-anchors",
      "duplicate-reference",
      "non-finite-number",
      "overflow-coordinate",
      "path-injection",
      "reflection-transform",
      "url-injection",
    ]);
    for (const fixture of fusionAdversarialFixtures) {
      expect(fixture.visiblySynthetic).toBe(true);
      expect(fixture.rights.trainingUseConsent).toBe("denied");
      expect(fixture.expectedSafeCode).toMatch(/^[A-Z][A-Z0-9_]{2,79}$/u);
      expect(fixture.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });
});
