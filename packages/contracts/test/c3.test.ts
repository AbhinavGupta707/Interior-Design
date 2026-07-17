import {
  projectPropertySchema,
  propertyDossierSchema,
  propertyResolutionResponseSchema,
  propertySourceSchema,
  selectProjectPropertyRequestSchema,
  uprnSchema,
} from "../src/index.js";

import { describe, expect, it } from "vitest";

const projectId = "719f83b4-937d-40ab-a079-4d59a2086381";
const propertyId = "18bebf49-45f8-48ac-bb2f-691654fc999d";
const candidateId = "91ab8df3-17a4-499a-83fe-bde8fdbff0ea";
const resolutionId = "e68db487-bff1-443f-9996-96ff77faccef";
const sourceRecordId = "b263a593-a73d-42ee-adfe-1ed077e0130f";
const now = "2026-07-17T12:00:00.000Z";
const later = "2026-07-17T12:15:00.000Z";
const hash = "a".repeat(64);

const source = propertySourceSchema.parse({
  coverage: "fixture-complete",
  dataset: "Synthetic property identities",
  datasetVersion: "c3-fixture-v1",
  licence: { id: "synthetic-fixture", title: "Repository synthetic fixture" },
  modelTrainingAllowed: false,
  participantSharingAllowed: true,
  providerId: "fixture-property",
  retrievedAt: now,
  serviceProcessingAllowed: true,
});

const address = {
  countryCode: "GB",
  line1: "14 Example Mews",
  locality: "Testford",
  postcode: "ZZ1 1ZZ",
} as const;

const property = projectPropertySchema.parse({
  address,
  displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
  identifiers: [{ scheme: "UPRN", value: "000000000014" }],
  interiorKnowledgeStatus: "unknown-without-evidence",
  jurisdiction: "england",
  location: { coordinates: [530000, 180000], crs: "EPSG:27700" },
  mode: "candidate",
  projectId,
  propertyId,
  selectedAt: now,
  source,
  updatedAt: now,
  version: 1,
});

describe("C3 property and dossier contracts", () => {
  it("keeps UPRNs as bounded strings so leading zeroes are not lost", () => {
    expect(uprnSchema.parse("000000000014")).toBe("000000000014");
    expect(() => uprnSchema.parse("1234567890123")).toThrow();
    expect(() => uprnSchema.parse("12A4")).toThrow();
  });

  it("requires resolution status to agree with candidate count", () => {
    const candidate = {
      address,
      candidateId,
      displayAddress: property.displayAddress,
      identifiers: property.identifiers,
      jurisdiction: "england",
      location: property.location,
      source,
    };
    expect(
      propertyResolutionResponseSchema.parse({
        candidates: [candidate],
        expiresAt: later,
        manualEntryAllowed: true,
        providerState: "fixture",
        resolutionId,
        status: "matched",
      }).status,
    ).toBe("matched");
    expect(() =>
      propertyResolutionResponseSchema.parse({
        candidates: [candidate],
        expiresAt: later,
        manualEntryAllowed: true,
        providerState: "fixture",
        resolutionId,
        status: "no-match",
      }),
    ).toThrow(/candidate count/u);
    expect(
      propertyResolutionResponseSchema.parse({
        candidates: [],
        expiresAt: later,
        manualEntryAllowed: true,
        providerState: "disabled",
        resolutionId,
        status: "unavailable",
      }).providerState,
    ).toBe("disabled");
    expect(() =>
      propertyResolutionResponseSchema.parse({
        candidates: [candidate],
        expiresAt: later,
        manualEntryAllowed: true,
        providerState: "disabled",
        resolutionId,
        status: "matched",
      }),
    ).toThrow(/provider state/u);
  });

  it("keeps candidate selection opaque and supports an explicit manual fallback", () => {
    expect(
      selectProjectPropertyRequestSchema.parse({
        candidateId,
        expectedVersion: 0,
        mode: "candidate",
        resolutionId,
      }).mode,
    ).toBe("candidate");
    expect(
      selectProjectPropertyRequestSchema.parse({
        address,
        expectedVersion: 0,
        jurisdiction: "england",
        mode: "manual",
      }).mode,
    ).toBe("manual");
  });

  it("requires sources for external observations and confidence only for estimates", () => {
    const dossier = {
      coverageWarnings: [
        "Synthetic context is incomplete and does not establish the current interior.",
      ],
      generatedAt: now,
      interiorKnowledgeStatus: "unknown-without-evidence",
      items: [
        {
          classification: "source-observation",
          interiorClaim: "none",
          key: "dwelling-type",
          label: "Dwelling type",
          sourceRecordIds: [sourceRecordId],
          value: { kind: "text", value: "Semi-detached house" },
        },
        {
          classification: "estimate",
          confidencePercent: 55,
          interiorClaim: "none",
          key: "construction-age-band",
          label: "Construction age band",
          sourceRecordIds: [sourceRecordId],
          value: { kind: "text", value: "1930–1949" },
        },
        {
          classification: "unknown",
          interiorClaim: "none",
          key: "current-room-layout",
          label: "Current room layout",
          sourceRecordIds: [],
          value: { kind: "unknown" },
        },
      ],
      planningStatus: "not-reviewed",
      property,
      sources: [
        {
          fields: ["dwelling-type", "construction-age-band"],
          id: sourceRecordId,
          normalizedPayloadSha256: hash,
          projectId,
          propertyId,
          source,
        },
      ],
      version: 1,
    } as const;

    expect(propertyDossierSchema.parse(dossier).items).toHaveLength(3);
    expect(() =>
      propertyDossierSchema.parse({
        ...dossier,
        items: [{ ...dossier.items[0], sourceRecordIds: [] }],
      }),
    ).toThrow(/source record/u);
    expect(() =>
      propertyDossierSchema.parse({
        ...dossier,
        items: [{ ...dossier.items[1], confidencePercent: undefined }],
      }),
    ).toThrow(/confidence/u);
    expect(() =>
      propertyDossierSchema.parse({
        ...dossier,
        sources: [{ ...dossier.sources[0], projectId: candidateId }],
      }),
    ).toThrow(/belong/u);
  });

  it("forbids turning an identity point into an implicit interior or training permission", () => {
    expect(property.interiorKnowledgeStatus).toBe("unknown-without-evidence");
    expect(property.location).toMatchObject({ crs: "EPSG:27700" });
    expect(source.modelTrainingAllowed).toBe(false);
    expect(() => propertySourceSchema.parse({ ...source, modelTrainingAllowed: true })).toThrow();
  });
});
