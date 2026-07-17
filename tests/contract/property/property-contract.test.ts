import {
  propertyDossierSchema,
  propertyResolutionResponseSchema,
  selectProjectPropertyRequestSchema,
  uprnSchema,
} from "../../../packages/contracts/src/index";
import { describe, expect, it } from "vitest";

import { dossier, resolution } from "../../../apps/web/test/c3/fixtures";

describe("c3-property-v1 consumer contract", () => {
  it("preserves leading-zero UPRNs and strict resolution cardinality", () => {
    expect(uprnSchema.parse("000000000014")).toBe("000000000014");
    expect(propertyResolutionResponseSchema.parse(resolution)).toEqual(resolution);
    expect(() =>
      propertyResolutionResponseSchema.parse({ ...resolution, candidates: [], status: "matched" }),
    ).toThrow();
  });

  it("accepts the synthetic dossier with every classification and denied training", () => {
    const parsed = propertyDossierSchema.parse(dossier);
    expect(new Set(parsed.items.map((item) => item.classification))).toEqual(
      new Set(["source-observation", "user-assertion", "estimate", "inference", "unknown"]),
    );
    expect(parsed.sources.every((source) => source.source.modelTrainingAllowed === false)).toBe(
      true,
    );
    expect(parsed.items.every((item) => item.interiorClaim === "none")).toBe(true);
    expect(parsed.coverageWarnings).toHaveLength(1);
    expect(parsed.planningStatus).toBe("not-reviewed");
  });

  it("keeps manual identity free of an invented UPRN, coordinate or browser authority", () => {
    const manual = selectProjectPropertyRequestSchema.parse({
      address: { countryCode: "GB", line1: "1 Synthetic Lane" },
      expectedVersion: 0,
      jurisdiction: "unknown",
      mode: "manual",
    });
    expect(manual).not.toHaveProperty("identifiers");
    expect(manual).not.toHaveProperty("location");
    expect(() => selectProjectPropertyRequestSchema.parse({ ...manual, role: "owner" })).toThrow();
  });

  it("requires confidence only for estimates/inferences and explicit unknown values", () => {
    const unknown = dossier.items.find((item) => item.classification === "unknown")!;
    expect(unknown.value).toEqual({ kind: "unknown" });
    expect(unknown.sourceRecordIds).toEqual([]);
    expect(() =>
      propertyDossierSchema.parse({
        ...dossier,
        items: dossier.items.map((item) =>
          item.classification === "unknown"
            ? { ...item, confidencePercent: 50, value: { kind: "text", value: "Invented" } }
            : item,
        ),
      }),
    ).toThrow();
  });
});
