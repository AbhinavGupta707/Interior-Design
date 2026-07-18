import { updateBriefRequestSchema } from "@interior-design/contracts";
import type {
  BriefEntryCategory,
  BriefEntryClassification,
  UpdateBriefRequest,
} from "@interior-design/contracts";

import type { ConsultationIntakeSeed } from "./contracts";

export interface IntakeBriefFact {
  readonly category: BriefEntryCategory;
  readonly classification: BriefEntryClassification;
  readonly key: string;
  readonly label: string;
  readonly priority: number;
  readonly statement: string;
}

async function deterministicUuid(source: string): Promise<string> {
  // RFC 9562 UUIDv8: first 128 bits of SHA-256 over the namespaced UTF-8 source strings below,
  // with the version and variant bits overwritten. This is intentionally not UUIDv5/SHA-1.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}

function facts(
  values: readonly string[],
  options: Omit<IntakeBriefFact, "key" | "statement"> & { readonly field: string },
): readonly IntakeBriefFact[] {
  return values.map((value, index) => ({
    category: options.category,
    classification: options.classification,
    key: options.field + ":" + String(index),
    label: options.label,
    priority: options.priority,
    statement: value,
  }));
}

export function intakeBriefFacts(intake: ConsultationIntakeSeed): readonly IntakeBriefFact[] {
  return [
    ...facts(intake.goals, {
      category: "spatial-need",
      classification: "household-assertion",
      field: "goals",
      label: "Goal",
      priority: 4,
    }),
    ...facts(intake.mustChange, {
      category: "household-change",
      classification: "hard-constraint",
      field: "must-change",
      label: "Must change",
      priority: 5,
    }),
    ...facts(intake.mustKeep, {
      category: "retained-item",
      classification: "hard-constraint",
      field: "must-keep",
      label: "Must keep",
      priority: 5,
    }),
    ...facts(intake.styleWords, {
      category: "style-aesthetic",
      classification: "preference",
      field: "style",
      label: "Style preference",
      priority: 3,
    }),
    ...facts(intake.accessibilityNeeds, {
      category: "accessibility",
      classification: "hard-constraint",
      field: "accessibility",
      label: "Accessibility need",
      priority: 5,
    }),
  ];
}

export async function buildBriefInitializationRequest(
  intake: ConsultationIntakeSeed,
  selectedKeys: ReadonlySet<string>,
  confirmingActorUserId: string,
): Promise<UpdateBriefRequest> {
  const selected = intakeBriefFacts(intake).filter(({ key }) => selectedKeys.has(key));
  const idempotencyKey = await deterministicUuid(
    JSON.stringify({
      actorUserId: confirmingActorUserId,
      intakeVersion: intake.version,
      items: selected.map(({ key, statement }) => ({ key, statement })),
      namespace: "c11-intake-brief-request-v1",
      projectId: intake.projectId,
    }),
  );
  const operations = await Promise.all(
    selected.map(async (fact) => ({
      entry: {
        category: fact.category,
        classification: fact.classification,
        id: await deterministicUuid(
          JSON.stringify({
            actorUserId: confirmingActorUserId,
            fact: { key: fact.key, statement: fact.statement },
            intakeVersion: intake.version,
            namespace: "c11-intake-brief-entry-v1",
            projectId: intake.projectId,
          }),
        ),
        priority: fact.priority,
        provenance: {
          capturedAt: intake.updatedAt,
          method: "user-stated" as const,
          statedByUserId: confirmingActorUserId,
        },
        roomOrLevelElementIds: [],
        statement: fact.statement,
        status: "active" as const,
      },
      kind: "entry.add" as const,
    })),
  );
  return updateBriefRequestSchema.parse({
    expectedRevision: 0,
    idempotencyKey,
    operations,
  });
}
