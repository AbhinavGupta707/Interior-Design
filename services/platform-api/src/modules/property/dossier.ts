import {
  propertyDossierSchema,
  propertyDossierValueSchema,
  type HomeIntake,
  type ProjectProperty,
  type PropertyDossier,
  type PropertyDossierItem,
  type PropertySourceRecord,
} from "@interior-design/contracts";
import type { PropertyAdapterDossierItem } from "@interior-design/provider-adapters/property";
import { z } from "zod";

const reservedDossierKeys = new Set([
  "selection-mode",
  "property-identity",
  "selected-for-project",
  "context-coverage-estimate",
  "interior-evidence-required",
  "current-room-layout",
  "wall-thicknesses",
  "structural-system",
  "legal-boundary",
]);

const propertyAdapterDossierItemSchema = z
  .object({
    classification: z.enum(["estimate", "inference", "source-observation"]),
    confidencePercent: z.int().min(0).max(100).optional(),
    key: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u),
    label: z.string().trim().min(1).max(120),
    note: z.string().trim().min(1).max(500).optional(),
    value: propertyDossierValueSchema,
  })
  .strict()
  .superRefine((item, context) => {
    const needsConfidence =
      item.classification === "estimate" || item.classification === "inference";
    if (needsConfidence !== (item.confidencePercent !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Adapter estimates and inferences require confidence only where applicable.",
        path: ["confidencePercent"],
      });
    }
  });

export function parsePropertyAdapterDossierItems(
  value: unknown,
): readonly PropertyAdapterDossierItem[] {
  return z
    .array(propertyAdapterDossierItemSchema)
    .max(20)
    .superRefine((items, context) => {
      const keys = new Set<string>();
      items.forEach((item, index) => {
        if (
          keys.has(item.key) ||
          reservedDossierKeys.has(item.key) ||
          item.key.startsWith("intake-")
        ) {
          context.addIssue({
            code: "custom",
            message: "Adapter dossier keys must be unique and cannot replace workflow fields.",
            path: [index, "key"],
          });
        }
        keys.add(item.key);
      });
    })
    .parse(value)
    .map((item) => ({
      classification: item.classification,
      ...(item.confidencePercent === undefined
        ? {}
        : { confidencePercent: item.confidencePercent }),
      key: item.key,
      label: item.label,
      ...(item.note === undefined ? {} : { note: item.note }),
      value: item.value,
    }));
}

export interface IntakeSnapshot {
  readonly intake: HomeIntake;
  readonly sourceRecord: PropertySourceRecord;
}

export interface BuildDossierInput {
  readonly adapterItems: readonly PropertyAdapterDossierItem[];
  readonly generatedAt: string;
  readonly identitySource: PropertySourceRecord;
  readonly intake?: IntakeSnapshot;
  readonly property: ProjectProperty;
  readonly version: number;
  readonly workflowSource: PropertySourceRecord;
}

function adapterItem(
  item: PropertyAdapterDossierItem,
  sourceRecordId: string,
): PropertyDossierItem {
  return {
    ...item,
    interiorClaim: "none",
    sourceRecordIds: [sourceRecordId],
  };
}

function intakeItems(snapshot: IntakeSnapshot): readonly PropertyDossierItem[] {
  const sourceRecordIds = [snapshot.sourceRecord.id];
  const items: PropertyDossierItem[] = [
    {
      classification: "user-assertion",
      interiorClaim: "none",
      key: "intake-dwelling-type",
      label: "Intake dwelling type",
      note: "Provided in the project intake; not independently verified.",
      sourceRecordIds,
      value: { kind: "text", value: snapshot.intake.dwellingType },
    },
  ];
  const integerAssertions = [
    ["intake-bedrooms", "Intake bedrooms", snapshot.intake.bedrooms],
    ["intake-bathrooms", "Intake bathrooms", snapshot.intake.bathrooms],
    ["intake-levels", "Intake levels", snapshot.intake.levels],
  ] as const;
  for (const [key, label, value] of integerAssertions) {
    if (value !== undefined) {
      items.push({
        classification: "user-assertion",
        interiorClaim: "none",
        key,
        label,
        note: "Provided in the project intake; not independently verified.",
        sourceRecordIds,
        value: { kind: "integer", unit: "count", value },
      });
    }
  }
  return items;
}

export function buildPropertyDossier(input: BuildDossierInput): PropertyDossier {
  const identitySourceIds = [input.identitySource.id];
  const workflowSourceIds = [input.workflowSource.id];
  const items: PropertyDossierItem[] = [
    {
      classification: "source-observation",
      interiorClaim: "none",
      key: "selection-mode",
      label: "Property selection mode",
      note: "Workflow observation only; it is not a claim about the building or interior.",
      sourceRecordIds: workflowSourceIds,
      value: {
        kind: "text",
        value: input.property.mode === "candidate" ? "Fixture candidate" : "Manual entry",
      },
    },
    {
      classification: input.property.mode === "candidate" ? "source-observation" : "user-assertion",
      interiorClaim: "none",
      key: "property-identity",
      label: "Selected property identity",
      note:
        input.property.mode === "candidate"
          ? "Normalized synthetic identity; an address or point does not establish the interior."
          : "User-provided address text; no UPRN or coordinate was invented.",
      sourceRecordIds: identitySourceIds,
      value: { kind: "text", value: input.property.displayAddress },
    },
    {
      classification: "user-assertion",
      interiorClaim: "none",
      key: "selected-for-project",
      label: "Selected for this project",
      note: "Records the authorised user's project selection, not independent verification.",
      sourceRecordIds: workflowSourceIds,
      value: { kind: "boolean", value: true },
    },
    {
      classification: "estimate",
      confidencePercent: 70,
      interiorClaim: "none",
      key: "context-coverage-estimate",
      label: "Context coverage estimate",
      note: "A bounded workflow estimate of dossier context, not home-model completeness.",
      sourceRecordIds: workflowSourceIds,
      value: {
        kind: "number",
        unit: "percent",
        value: input.property.mode === "candidate" ? 60 : 15,
      },
    },
    {
      classification: "inference",
      confidencePercent: 99,
      interiorClaim: "none",
      key: "interior-evidence-required",
      label: "Interior evidence required",
      note: "Inferred from the explicit absence of current-interior evidence.",
      sourceRecordIds: workflowSourceIds,
      value: { kind: "boolean", value: true },
    },
    ...input.adapterItems.map((item) => adapterItem(item, input.identitySource.id)),
    ...(input.intake === undefined ? [] : intakeItems(input.intake)),
    ...[
      ["current-room-layout", "Current room layout"],
      ["wall-thicknesses", "Wall thicknesses"],
      ["structural-system", "Structural system"],
      ["legal-boundary", "Legal boundary"],
    ].map(([key, label]): PropertyDossierItem => ({
      classification: "unknown",
      interiorClaim: "none",
      key: key as string,
      label: label as string,
      note: "Unknown until supported by suitable project evidence and review.",
      sourceRecordIds: [],
      value: { kind: "unknown" },
    })),
  ];

  const sources = [
    input.identitySource,
    input.workflowSource,
    ...(input.intake === undefined ? [] : [input.intake.sourceRecord]),
  ];
  return propertyDossierSchema.parse({
    coverageWarnings: [
      "An address, UPRN or identity point does not establish the current interior, structure or legal boundary.",
      "Planning context is not reviewed; missing or unavailable records must not be read as clearance.",
      input.property.mode === "candidate"
        ? "Repository synthetic context is incomplete and must be replaced or verified with project evidence."
        : "Manual identity has unknown provider coverage and contains no invented UPRN or coordinate.",
    ],
    generatedAt: input.generatedAt,
    interiorKnowledgeStatus: "unknown-without-evidence",
    items,
    planningStatus: "not-reviewed",
    property: input.property,
    sources,
    version: input.version,
  });
}
