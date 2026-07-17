import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { syntheticRoomPlanFixtures } from "./synthetic-dataset.js";

const manifestPath = resolve(
  process.cwd(),
  "tests/evaluation/roomplan/rights-controlled-split.json",
);

describe("C7 rights-controlled RoomPlan evaluation split", () => {
  it("contains only declared synthetic conformance fixtures in Git", async () => {
    const manifest = await readManifest();
    expect(manifest.dataPolicy).toEqual({
      customerDataPresent: false,
      rawRoomPlanEncodingInGit: false,
      trainingUseConsent: "denied",
    });
    const synthetic = requireSplit(manifest, "synthetic-conformance");
    expect(synthetic.status).toBe("available");
    expect(synthetic.evidenceClass).toBe("synthetic-conformance");
    expect(new Set(synthetic.fixtureIds)).toEqual(
      new Set(syntheticRoomPlanFixtures.map(({ id }) => id)),
    );
    expect(synthetic.rights).toEqual({
      basis: "generated-by-project",
      evaluationUseAllowed: true,
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    });
  });

  it("keeps both physical splits empty and promotion-ineligible until per-capture rights exist", async () => {
    const manifest = await readManifest();
    for (const name of ["physical-development", "physical-holdout"] as const) {
      const split = requireSplit(manifest, name);
      expect(split).toMatchObject({
        evidenceClass: "physical-field",
        fixtureIds: [],
        status: "not-acquired",
      });
      expect(split.rights).toMatchObject({
        evaluationUseAllowed: false,
        serviceProcessingConsent: false,
        trainingUseConsent: "denied",
      });
    }
  });

  it("retains a stable manifest digest for review without claiming it hashes scan data", async () => {
    const bytes = await readFile(manifestPath);
    expect(createHash("sha256").update(bytes).digest("hex")).toMatch(/^[a-f0-9]{64}$/u);
    expect(bytes.toString("utf8")).not.toMatch(
      /CapturedRoom|CapturedStructure|deviceSerial|address/iu,
    );
  });
});

interface RightsSplitManifest {
  readonly dataPolicy: {
    readonly customerDataPresent: boolean;
    readonly rawRoomPlanEncodingInGit: boolean;
    readonly trainingUseConsent: string;
  };
  readonly splits: readonly RightsSplit[];
}

interface RightsSplit {
  readonly evidenceClass: string;
  readonly fixtureIds: readonly string[];
  readonly name: string;
  readonly rights: {
    readonly basis: string;
    readonly evaluationUseAllowed: boolean;
    readonly serviceProcessingConsent: boolean;
    readonly trainingUseConsent: string;
  };
  readonly status: string;
}

async function readManifest(): Promise<RightsSplitManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as RightsSplitManifest;
}

function requireSplit(manifest: RightsSplitManifest, name: string): RightsSplit {
  const split = manifest.splits.find((candidate) => candidate.name === name);
  if (split === undefined) throw new Error(`Missing rights split ${name}.`);
  return split;
}
