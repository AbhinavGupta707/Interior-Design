import { describe, expect, it } from "vitest";

import {
  adversarialFixtureDefinitions,
  createAdversarialFixture,
  fixtureDefinition,
  fixtureSha256,
} from "../../fixtures/c2/adversarial/factory.js";

const requiredAttackClasses = [
  "codec-metadata",
  "control-character",
  "decompression-bomb",
  "extension-mime-confusion",
  "external-resource",
  "filename-shell-metacharacters",
  "gps-privacy",
  "image-bomb",
  "output-flood",
  "path-traversal",
  "pdf-bomb",
  "polyglot",
  "svg-active-content",
  "video-bomb",
  "xxe",
] as const;

describe("C2 safe deterministic adversarial fixtures", () => {
  it("is unique, deterministic, nonempty, and below the tiny-fixture ceiling", () => {
    const ids = adversarialFixtureDefinitions.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of adversarialFixtureDefinitions) {
      const first = createAdversarialFixture(fixture.id);
      const second = createAdversarialFixture(fixture.id);
      expect(first.byteLength).toBeGreaterThan(0);
      expect(first.byteLength).toBeLessThanOrEqual(4_096);
      expect(second).toEqual(first);
      expect(fixtureSha256(fixture.id)).toMatch(/^[a-f0-9]{64}$/u);
      expect(fixtureDefinition(fixture.id)).toEqual(fixture);
    }
  });

  it("covers every declared hostile-input class", () => {
    const covered = new Set(
      adversarialFixtureDefinitions.flatMap((fixture) => [...fixture.attackClasses]),
    );
    for (const attackClass of requiredAttackClasses) {
      expect(covered.has(attackClass), `missing ${attackClass}`).toBe(true);
    }
  });

  it("contains only reserved/nonexistent external targets and no obvious customer data", () => {
    const allText = adversarialFixtureDefinitions
      .map((fixture) => createAdversarialFixture(fixture.id).toString("latin1"))
      .join("\n");
    expect(allText).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    expect(allText).not.toContain("BEGIN PRIVATE KEY");
    expect(allText).not.toContain("Authorization: Bearer");
    const urls = allText.match(/https?:\/\/[^\s"'<>]+/giu) ?? [];
    for (const value of urls) {
      const url = new URL(value);
      expect(
        url.hostname === "www.w3.org" || url.hostname.endsWith(".invalid"),
        `unexpected fixture URL host: ${url.hostname}`,
      ).toBe(true);
    }
    expect(allText).not.toMatch(/file:\/\/(?!\/synthetic\/nonexistent)/iu);
  });

  it("proves privacy and active-content sentinels are present before processing", () => {
    expect(createAdversarialFixture("exif-gps-jpeg").includes("SYNTHETIC_GPS_SENTINEL")).toBe(true);
    expect(createAdversarialFixture("png-svg-polyglot").includes("must-not-execute")).toBe(true);
    expect(createAdversarialFixture("svg-external-resource").includes("media-fetch.invalid")).toBe(
      true,
    );
    expect(createAdversarialFixture("svg-xxe").includes("<!ENTITY")).toBe(true);
  });

  it("uses metadata claims instead of actual expanded bomb payloads", () => {
    expect(createAdversarialFixture("image-dimension-claim").byteLength).toBeLessThan(100);
    expect(createAdversarialFixture("pdf-page-count-claim").byteLength).toBeLessThan(512);
    expect(createAdversarialFixture("pdf-decompression-claim").byteLength).toBeLessThan(512);
    expect(createAdversarialFixture("video-duration-claim").byteLength).toBeLessThan(100);
  });
});
