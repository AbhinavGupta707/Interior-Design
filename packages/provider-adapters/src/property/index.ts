import {
  propertyAddressSchema,
  propertyLocationSchema,
  propertySourceSchema,
  resolvePropertyRequestSchema,
  uprnSchema,
  type PropertyAddress,
  type PropertyDossierValue,
  type PropertyJurisdiction,
  type PropertySource,
  type ResolvePropertyRequest,
} from "@interior-design/contracts";

export const propertyAdapterContractVersion = "c3-property-v1" as const;
export const syntheticPropertyDatasetVersion = "c3-fixture-v1" as const;

export type PropertyAdapterMode = "disabled" | "fixture" | "unavailable";
export type PropertyAdapterClock = () => Date;

export interface PropertyAdapterDossierItem {
  readonly classification: "estimate" | "inference" | "source-observation";
  readonly confidencePercent?: number;
  readonly key: string;
  readonly label: string;
  readonly note?: string;
  readonly value: PropertyDossierValue;
}

export interface PropertyAdapterCandidate {
  readonly address: PropertyAddress;
  readonly displayAddress: string;
  readonly dossierItems: readonly PropertyAdapterDossierItem[];
  readonly identifiers: readonly { readonly scheme: "UPRN"; readonly value: string }[];
  readonly jurisdiction: PropertyJurisdiction;
  readonly location?:
    | { readonly coordinates: readonly [number, number]; readonly crs: "EPSG:27700" }
    | { readonly coordinates: readonly [number, number]; readonly crs: "EPSG:4326" };
  readonly source: PropertySource;
}

export type PropertyAdapterResolution =
  | {
      readonly candidates: readonly [PropertyAdapterCandidate];
      readonly providerState: "fixture";
      readonly status: "matched";
    }
  | {
      readonly candidates: readonly [PropertyAdapterCandidate, ...PropertyAdapterCandidate[]];
      readonly providerState: "fixture";
      readonly status: "ambiguous";
    }
  | {
      readonly candidates: readonly [];
      readonly providerState: "fixture";
      readonly status: "no-match";
    }
  | {
      readonly candidates: readonly [];
      readonly providerState: "disabled" | "unavailable";
      readonly status: "unavailable";
    };

export interface PropertyAdapter {
  resolve(request: ResolvePropertyRequest): Promise<PropertyAdapterResolution>;
}

interface FixtureCatalogEntry {
  readonly address: PropertyAddress;
  readonly aliases: readonly string[];
  readonly ambiguityGroup?: string;
  readonly displayAddress: string;
  readonly dossierItems: readonly PropertyAdapterDossierItem[];
  readonly jurisdiction: PropertyJurisdiction;
  readonly location: {
    readonly coordinates: readonly [number, number];
    readonly crs: "EPSG:27700";
  };
  readonly uprn: string;
}

const SHARED_POINT: FixtureCatalogEntry["location"] = {
  coordinates: [530_100, 180_100],
  crs: "EPSG:27700",
};

export const syntheticPropertyFixtureCatalog: readonly FixtureCatalogEntry[] = Object.freeze([
  {
    address: propertyAddressSchema.parse({
      countryCode: "GB",
      line1: "14 Example Mews",
      locality: "Testford",
      postcode: "ZZ1 1ZZ",
    }),
    aliases: [
      "14 Example Mews",
      "14 Example Mews Testford",
      "14 Example Mews Testford ZZ1 1ZZ",
      "ZZ1 1ZZ",
    ],
    displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
    dossierItems: [
      {
        classification: "source-observation",
        key: "fixture-dwelling-context",
        label: "Fixture dwelling context",
        note: "Synthetic context only; it does not establish the current interior.",
        value: { kind: "text", value: "Terraced-house context" },
      },
      {
        classification: "estimate",
        confidencePercent: 55,
        key: "indicative-floor-area",
        label: "Indicative floor area",
        note: "Synthetic bounded estimate for dossier comprehension testing only.",
        value: { kind: "integer", unit: "m2", value: 78 },
      },
      {
        classification: "inference",
        confidencePercent: 60,
        key: "likely-property-form",
        label: "Likely property form",
        note: "Synthetic inference; verify against project evidence.",
        value: { kind: "text", value: "Terraced house" },
      },
    ],
    jurisdiction: "england",
    location: { coordinates: [530_000, 180_000], crs: "EPSG:27700" },
    uprn: "000000000014",
  },
  {
    address: propertyAddressSchema.parse({
      countryCode: "GB",
      line1: "Flat 1, 20 Shared Point Court",
      locality: "Testford",
      postcode: "ZZ1 2ZZ",
    }),
    aliases: ["20 Shared Point Court", "Shared Point Court", "ZZ1 2ZZ"],
    ambiguityGroup: "shared-point-court",
    displayAddress: "Flat 1, 20 Shared Point Court, Testford, ZZ1 2ZZ",
    dossierItems: [
      {
        classification: "source-observation",
        key: "fixture-dwelling-context",
        label: "Fixture dwelling context",
        value: { kind: "text", value: "Flat context" },
      },
      {
        classification: "estimate",
        confidencePercent: 45,
        key: "indicative-floor-area",
        label: "Indicative floor area",
        value: { kind: "integer", unit: "m2", value: 54 },
      },
      {
        classification: "inference",
        confidencePercent: 58,
        key: "likely-property-form",
        label: "Likely property form",
        value: { kind: "text", value: "Purpose-built flat" },
      },
    ],
    jurisdiction: "england",
    location: SHARED_POINT,
    uprn: "000000000021",
  },
  {
    address: propertyAddressSchema.parse({
      countryCode: "GB",
      line1: "Flat 2, 20 Shared Point Court",
      locality: "Testford",
      postcode: "ZZ1 2ZZ",
    }),
    aliases: ["20 Shared Point Court", "Shared Point Court", "ZZ1 2ZZ"],
    ambiguityGroup: "shared-point-court",
    displayAddress: "Flat 2, 20 Shared Point Court, Testford, ZZ1 2ZZ",
    dossierItems: [
      {
        classification: "source-observation",
        key: "fixture-dwelling-context",
        label: "Fixture dwelling context",
        value: { kind: "text", value: "Flat context" },
      },
      {
        classification: "estimate",
        confidencePercent: 45,
        key: "indicative-floor-area",
        label: "Indicative floor area",
        value: { kind: "integer", unit: "m2", value: 56 },
      },
      {
        classification: "inference",
        confidencePercent: 58,
        key: "likely-property-form",
        label: "Likely property form",
        value: { kind: "text", value: "Purpose-built flat" },
      },
    ],
    jurisdiction: "england",
    location: SHARED_POINT,
    uprn: "000000000022",
  },
]);

function normalizeQuery(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim()
    .replaceAll(/\s+/gu, " ");
}

function sourceAt(retrievedAt: string): PropertySource {
  return propertySourceSchema.parse({
    coverage: "fixture-complete",
    dataset: "Synthetic property identities and context",
    datasetVersion: syntheticPropertyDatasetVersion,
    licence: {
      id: "synthetic-fixture",
      title: "Repository synthetic fixture",
    },
    modelTrainingAllowed: false,
    participantSharingAllowed: true,
    providerId: "fixture-property",
    retrievedAt,
    serviceProcessingAllowed: true,
  });
}

function candidateFrom(entry: FixtureCatalogEntry, retrievedAt: string): PropertyAdapterCandidate {
  return {
    address: entry.address,
    displayAddress: entry.displayAddress,
    dossierItems: entry.dossierItems,
    identifiers: [{ scheme: "UPRN", value: uprnSchema.parse(entry.uprn) }],
    jurisdiction: entry.jurisdiction,
    location: propertyLocationSchema.parse(entry.location),
    source: sourceAt(retrievedAt),
  };
}

export interface FixturePropertyAdapterOptions {
  readonly clock?: PropertyAdapterClock;
  readonly injectOutage?: boolean;
}

export class FixturePropertyAdapter implements PropertyAdapter {
  readonly #clock: PropertyAdapterClock;
  readonly #injectOutage: boolean;

  constructor(options: FixturePropertyAdapterOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#injectOutage = options.injectOutage ?? false;
  }

  resolve(untrustedRequest: ResolvePropertyRequest): Promise<PropertyAdapterResolution> {
    const request = resolvePropertyRequestSchema.parse(untrustedRequest);
    if (this.#injectOutage) {
      return Promise.resolve({
        candidates: [],
        providerState: "unavailable",
        status: "unavailable",
      });
    }

    const query = normalizeQuery(request.query);
    const matches = syntheticPropertyFixtureCatalog.filter((entry) =>
      entry.aliases.some((alias) => normalizeQuery(alias) === query),
    );
    if (matches.length === 0) {
      return Promise.resolve({ candidates: [], providerState: "fixture", status: "no-match" });
    }

    const retrievedAt = this.#clock().toISOString();
    const candidates = matches.map((entry) => candidateFrom(entry, retrievedAt));
    if (candidates.length === 1) {
      return Promise.resolve({
        candidates: [candidates[0] as PropertyAdapterCandidate],
        providerState: "fixture",
        status: "matched",
      });
    }
    return Promise.resolve({
      candidates: candidates as [PropertyAdapterCandidate, ...PropertyAdapterCandidate[]],
      providerState: "fixture",
      status: "ambiguous",
    });
  }
}

export class DisabledPropertyAdapter implements PropertyAdapter {
  resolve(untrustedRequest: ResolvePropertyRequest): Promise<PropertyAdapterResolution> {
    resolvePropertyRequestSchema.parse(untrustedRequest);
    return Promise.resolve({
      candidates: [],
      providerState: "disabled",
      status: "unavailable",
    });
  }
}

export class UnavailablePropertyAdapter implements PropertyAdapter {
  resolve(untrustedRequest: ResolvePropertyRequest): Promise<PropertyAdapterResolution> {
    resolvePropertyRequestSchema.parse(untrustedRequest);
    return Promise.resolve({
      candidates: [],
      providerState: "unavailable",
      status: "unavailable",
    });
  }
}

export function createPropertyAdapter(
  mode: PropertyAdapterMode,
  options: FixturePropertyAdapterOptions = {},
): PropertyAdapter {
  switch (mode) {
    case "disabled":
      return new DisabledPropertyAdapter();
    case "fixture":
      return new FixturePropertyAdapter(options);
    case "unavailable":
      return new UnavailablePropertyAdapter();
  }
}
