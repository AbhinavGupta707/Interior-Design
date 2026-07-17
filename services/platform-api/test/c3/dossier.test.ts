import {
  projectPropertySchema,
  propertySourceRecordSchema,
  propertySourceSchema,
  type HomeIntake,
  type PropertySourceRecord,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  buildPropertyDossier,
  parsePropertyAdapterDossierItems,
} from "../../src/modules/property/dossier.js";

const now = "2026-07-17T12:00:00.000Z";
const projectId = "719f83b4-937d-40ab-a079-4d59a2086381";
const propertyId = "18bebf49-45f8-48ac-bb2f-691654fc999d";

const fixtureSource = propertySourceSchema.parse({
  coverage: "fixture-complete",
  dataset: "Synthetic property identities and context",
  datasetVersion: "c3-fixture-v1",
  licence: { id: "synthetic-fixture", title: "Repository synthetic fixture" },
  modelTrainingAllowed: false,
  participantSharingAllowed: true,
  providerId: "fixture-property",
  retrievedAt: now,
  serviceProcessingAllowed: true,
});

function sourceRecord(
  id: string,
  fields: readonly string[],
  providerId: string,
): PropertySourceRecord {
  return propertySourceRecordSchema.parse({
    fields,
    id,
    normalizedPayloadSha256: "a".repeat(64),
    projectId,
    propertyId,
    source: { ...fixtureSource, providerId },
  });
}

const property = projectPropertySchema.parse({
  address: {
    countryCode: "GB",
    line1: "14 Example Mews",
    locality: "Testford",
    postcode: "ZZ1 1ZZ",
  },
  displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
  identifiers: [{ scheme: "UPRN", value: "000000000014" }],
  interiorKnowledgeStatus: "unknown-without-evidence",
  jurisdiction: "england",
  location: { coordinates: [530000, 180000], crs: "EPSG:27700" },
  mode: "candidate",
  projectId,
  propertyId,
  selectedAt: now,
  source: fixtureSource,
  updatedAt: now,
  version: 1,
});

const intake: HomeIntake = {
  accessibilityNeeds: [],
  bathrooms: 1,
  bedrooms: 2,
  dwellingType: "terraced-house",
  evidenceAvailable: { photographs: true, plans: false, roomCapture: false, video: false },
  goals: ["Create a calm whole-home direction"],
  household: { adults: 2, children: 0, pets: 0 },
  levels: 2,
  mustChange: [],
  mustKeep: [],
  styleWords: ["calm"],
};

describe("C3 dossier generation", () => {
  it("produces all five epistemic classes, intake assertions, and explicit unknowns", () => {
    const dossier = buildPropertyDossier({
      adapterItems: [
        {
          classification: "estimate",
          confidencePercent: 55,
          key: "indicative-floor-area",
          label: "Indicative floor area",
          value: { kind: "integer", unit: "m2", value: 78 },
        },
        {
          classification: "inference",
          confidencePercent: 60,
          key: "likely-property-form",
          label: "Likely property form",
          value: { kind: "text", value: "Terraced house" },
        },
      ],
      generatedAt: now,
      identitySource: sourceRecord(
        "b263a593-a73d-42ee-adfe-1ed077e0130f",
        ["property-identity"],
        "fixture-property",
      ),
      intake: {
        intake,
        sourceRecord: sourceRecord(
          "b263a593-a73d-42ee-adfe-1ed077e01310",
          ["project-intake"],
          "project-intake",
        ),
      },
      property,
      version: 1,
      workflowSource: sourceRecord(
        "b263a593-a73d-42ee-adfe-1ed077e01311",
        ["selection-mode"],
        "property-workflow",
      ),
    });

    expect(new Set(dossier.items.map((item) => item.classification))).toEqual(
      new Set(["source-observation", "user-assertion", "estimate", "inference", "unknown"]),
    );
    expect(dossier.items.filter((item) => item.key.startsWith("intake-"))).toHaveLength(4);
    expect(
      dossier.items.filter((item) => item.classification === "unknown").map((item) => item.key),
    ).toEqual(["current-room-layout", "wall-thicknesses", "structural-system", "legal-boundary"]);
    expect(dossier.items.map((item) => item.interiorClaim)).toEqual(
      Array.from({ length: dossier.items.length }, () => "none"),
    );
    expect(dossier.planningStatus).toBe("not-reviewed");
    expect(dossier.coverageWarnings.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects adapter estimates without confidence and source observations with confidence", () => {
    expect(() =>
      parsePropertyAdapterDossierItems([
        {
          classification: "estimate",
          key: "bad-estimate",
          label: "Bad estimate",
          value: { kind: "number", value: 1 },
        },
      ]),
    ).toThrow();
    expect(() =>
      parsePropertyAdapterDossierItems([
        {
          classification: "source-observation",
          confidencePercent: 50,
          key: "bad-observation",
          label: "Bad observation",
          value: { kind: "text", value: "Unsupported" },
        },
      ]),
    ).toThrow();
    expect(() =>
      parsePropertyAdapterDossierItems([
        {
          classification: "source-observation",
          key: "selection-mode",
          label: "Attempted workflow replacement",
          value: { kind: "text", value: "Unsafe" },
        },
      ]),
    ).toThrow(/cannot replace workflow fields/u);
  });

  it("keeps a manual identity locator-free while still making coverage limits explicit", () => {
    const manualProperty = projectPropertySchema.parse({
      ...property,
      identifiers: [],
      location: undefined,
      mode: "manual",
      source: { ...fixtureSource, coverage: "unknown", providerId: "manual-entry" },
    });
    const dossier = buildPropertyDossier({
      adapterItems: [],
      generatedAt: now,
      identitySource: sourceRecord(
        "b263a593-a73d-42ee-adfe-1ed077e01312",
        ["property-identity"],
        "manual-entry",
      ),
      property: manualProperty,
      version: 1,
      workflowSource: sourceRecord(
        "b263a593-a73d-42ee-adfe-1ed077e01313",
        ["selection-mode"],
        "property-workflow",
      ),
    });

    expect(dossier.property.identifiers).toEqual([]);
    expect(dossier.property.location).toBeUndefined();
    expect(dossier.items.find((item) => item.key === "property-identity")?.classification).toBe(
      "user-assertion",
    );
    expect(dossier.coverageWarnings.join(" ")).toMatch(/no invented UPRN or coordinate/u);
  });
});
