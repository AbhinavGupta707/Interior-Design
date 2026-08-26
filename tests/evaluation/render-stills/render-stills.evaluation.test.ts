import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  inspectRenderArtifact,
  inspectSegmentationPng,
} from "../../../packages/render-evaluation/src/index";
import {
  artifactFor,
  minimalExr,
  solidPng,
} from "../../../packages/render-evaluation/test/fixtures";

const featureRoot = path.resolve(process.cwd(), "apps/web/src/features/render-stills");
const capabilitySource = readFileSync(path.join(featureRoot, "capability-composition.ts"), "utf8");
const workspaceSource = readFileSync(path.join(featureRoot, "render-stills-workspace.tsx"), "utf8");
const verificationSource = readFileSync(path.join(featureRoot, "artifact-verification.ts"), "utf8");
const verifiedArtifactSource = readFileSync(
  path.join(featureRoot, "verified-artifact.tsx"),
  "utf8",
);

describe("C14 independent render-stills evidence evaluation", () => {
  it("separates full PNG decode evidence from EXR header-only evidence", async () => {
    const png = await solidPng({ b: 64, g: 96, r: 128 });
    const pngInspection = await inspectRenderArtifact(png, artifactFor(png, "geometry-safe-png"));
    const exr = minimalExr({ channels: ["Combined.R", "Depth.Z"] });
    const exrInspection = await inspectRenderArtifact(exr, artifactFor(exr, "multilayer-exr"));
    expect(pngInspection.validationScope).toBe("sharp-decoded-pixels-and-container");
    expect(exrInspection.validationScope).toBe("container-header-only-no-pixel-validation");
  });

  it("rejects segmentation palette contamination independently of renderer claims", async () => {
    const segmentation = await solidPng({ b: 9, g: 8, r: 7 });
    await expect(
      inspectSegmentationPng(segmentation, [
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).resolves.toMatchObject({
      missingPaletteColours: ["1,2,3", "4,5,6"],
      unexpectedColours: ["7,8,9"],
    });
  });

  it("uses exact authority labels and preserves the hardware evidence boundary", () => {
    expect(workspaceSource).toContain(
      "“Geometry-locked deterministic render”</strong> is derived visualisation only.",
    );
    expect(workspaceSource).toContain(
      "“Illustrative optional enhancement”</strong> is never canonical.",
    );
    expect(workspaceSource).toContain("Render capability on this configured host");
    expect(capabilitySource).toContain(
      'host.hardwareEvidence === "verified-authorised-host" ? "satisfied" : "deferred"',
    );
    expect(capabilitySource).toContain(
      "No authorised render host currently accepts new work for a frozen profile.",
    );
    expect(workspaceSource).toContain("safe result remains independently visible");
    expect(workspaceSource).not.toMatch(
      /survey accurate|as-built verified|structurally safe|regulatory approved|cost guaranteed|in stock|professionally approved/iu,
    );
  });

  it("requires safe access, type, bytes, hash and dimensions before an object URL", () => {
    const access = verifiedArtifactSource.indexOf("getArtifactAccess");
    const verification = verifiedArtifactSource.indexOf("fetchVerifiedArtifact(", access);
    const objectUrl = verifiedArtifactSource.indexOf("createObjectURL", verification);
    expect(access).toBeGreaterThanOrEqual(0);
    expect(verification).toBeGreaterThan(access);
    expect(objectUrl).toBeGreaterThan(verification);
    expect(verificationSource).toContain('crypto.subtle.digest("SHA-256"');
    expect(verificationSource).toContain("inspectPngHeader");
    expect(verificationSource).toContain("inspectExrHeader");
  });
});
