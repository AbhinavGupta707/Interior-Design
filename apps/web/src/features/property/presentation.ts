import type {
  PropertyAddress,
  PropertyDossierClassification,
  PropertyDossierItem,
  PropertyDossierValue,
} from "@interior-design/contracts";

export interface ClassificationPresentation {
  readonly description: string;
  readonly label: string;
  readonly shortLabel: string;
}

export const classificationPresentation: Readonly<
  Record<PropertyDossierClassification, ClassificationPresentation>
> = Object.freeze({
  estimate: Object.freeze({
    description: "A bounded calculation from named inputs. It is not a measured fact.",
    label: "Estimate",
    shortLabel: "Calculated",
  }),
  inference: Object.freeze({
    description: "An interpretation of evidence. It needs confirmation before use as fact.",
    label: "Inference",
    shortLabel: "Interpreted",
  }),
  "source-observation": Object.freeze({
    description:
      "A normalised source record reports this. It does not establish the current interior.",
    label: "Source observation",
    shortLabel: "Source-reported",
  }),
  unknown: Object.freeze({
    description: "No sufficient evidence is available. The system has not filled the gap.",
    label: "Unknown",
    shortLabel: "Not established",
  }),
  "user-assertion": Object.freeze({
    description: "A project participant supplied this. It has not been independently verified.",
    label: "User assertion",
    shortLabel: "User-provided",
  }),
});

type DossierUnit = "count" | "m" | "m2" | "mm" | "percent" | "rating" | "year";

const unitLabels: Readonly<Record<DossierUnit, string>> = {
  count: "",
  m: "m",
  m2: "m²",
  mm: "mm",
  percent: "%",
  rating: "rating",
  year: "",
};

export function formatDossierValue(value: PropertyDossierValue): string {
  if (value.kind === "unknown") return "Not established";
  if (value.kind === "boolean") return value.value ? "Yes" : "No";
  if (value.kind === "text") return value.value;

  const suffix = value.unit ? unitLabels[value.unit] : "";
  if (suffix === "%") return `${String(value.value)}%`;
  return suffix.length > 0 ? `${String(value.value)} ${suffix}` : String(value.value);
}

export function formatPropertyAddress(address: PropertyAddress): string {
  return [address.line1, address.line2, address.locality, address.postcode]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

export function formatPropertyDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function dossierItemConfidence(item: PropertyDossierItem): string | undefined {
  if (item.classification !== "estimate" && item.classification !== "inference") {
    return undefined;
  }
  return item.confidencePercent === undefined
    ? undefined
    : `${String(item.confidencePercent)}% confidence`;
}
