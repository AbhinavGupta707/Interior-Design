import type {
  ProjectProperty,
  PropertyCandidate,
  PropertyDossier,
  PropertyResolutionResponse,
  PropertySource,
  PropertySourceRecord,
} from "@interior-design/contracts";

export const projectId = "33333333-3333-4333-8333-333333333333";
export const propertyId = "44444444-4444-4444-8444-444444444444";
export const sourceRecordId = "55555555-5555-4555-8555-555555555555";

export const fixtureSource: PropertySource = {
  coverage: "fixture-complete",
  dataset: "C3 synthetic property catalogue",
  datasetVersion: "c3-fixture-1",
  licence: { id: "repository-test", title: "Repository synthetic test data" },
  modelTrainingAllowed: false,
  participantSharingAllowed: true,
  providerId: "repository-fixture",
  retrievedAt: "2026-07-17T12:00:00.000Z",
  serviceProcessingAllowed: true,
};

export const candidate: PropertyCandidate = {
  address: {
    countryCode: "GB",
    line1: "14 Example Mews",
    locality: "Testford",
    postcode: "ZZ1 1ZZ",
  },
  candidateId: "66666666-6666-4666-8666-666666666666",
  displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
  identifiers: [{ scheme: "UPRN", value: "000000000014" }],
  jurisdiction: "england",
  location: { coordinates: [530_014, 180_014], crs: "EPSG:27700" },
  source: fixtureSource,
};

export const resolution: PropertyResolutionResponse = {
  candidates: [candidate],
  expiresAt: "2099-07-17T12:15:00.000Z",
  manualEntryAllowed: true,
  providerState: "fixture",
  resolutionId: "77777777-7777-4777-8777-777777777777",
  status: "matched",
};

export const selectedProperty: ProjectProperty = {
  address: candidate.address,
  displayAddress: candidate.displayAddress,
  identifiers: candidate.identifiers,
  interiorKnowledgeStatus: "unknown-without-evidence",
  jurisdiction: candidate.jurisdiction,
  location: candidate.location,
  mode: "candidate",
  projectId,
  propertyId,
  selectedAt: "2026-07-17T12:05:00.000Z",
  source: fixtureSource,
  updatedAt: "2026-07-17T12:05:00.000Z",
  version: 1,
};

export const sourceRecord: PropertySourceRecord = {
  fields: ["property-identity", "uprn", "location-point"],
  id: sourceRecordId,
  normalizedPayloadSha256: "a".repeat(64),
  projectId,
  propertyId,
  source: fixtureSource,
};

export const dossier: PropertyDossier = {
  coverageWarnings: [
    "Synthetic catalogue coverage does not establish the current interior, structure, legal boundary or planning position.",
  ],
  generatedAt: "2026-07-17T12:05:00.000Z",
  interiorKnowledgeStatus: "unknown-without-evidence",
  items: [
    {
      classification: "source-observation",
      interiorClaim: "none",
      key: "property-identity",
      label: "Property identity",
      sourceRecordIds: [sourceRecordId],
      value: { kind: "text", value: candidate.displayAddress },
    },
    {
      classification: "user-assertion",
      interiorClaim: "none",
      key: "household-priority",
      label: "Household priority",
      sourceRecordIds: [sourceRecordId],
      value: { kind: "text", value: "More daylight requested" },
    },
    {
      classification: "estimate",
      confidencePercent: 70,
      interiorClaim: "none",
      key: "context-year",
      label: "Context year",
      sourceRecordIds: [sourceRecordId],
      value: { kind: "integer", unit: "year", value: 1985 },
    },
    {
      classification: "inference",
      confidencePercent: 62,
      interiorClaim: "none",
      key: "locality-context",
      label: "Locality context",
      sourceRecordIds: [sourceRecordId],
      value: { kind: "text", value: "Synthetic residential context" },
    },
    {
      classification: "unknown",
      interiorClaim: "none",
      key: "current-layout",
      label: "Current interior layout",
      sourceRecordIds: [],
      value: { kind: "unknown" },
    },
  ],
  planningStatus: "not-reviewed",
  property: selectedProperty,
  sources: [sourceRecord],
  version: 1,
};
