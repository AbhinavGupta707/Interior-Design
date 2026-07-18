import { briefPatchOperationSchema, userIdSchema } from "@interior-design/contracts";
import type {
  BriefEntry,
  BriefEntryClassification,
  BriefPatchOperation,
} from "@interior-design/contracts";
import { z } from "zod";

function correctionClassification(
  classification: BriefEntryClassification,
): BriefEntryClassification {
  if (classification === "inferred-suggestion") return "preference";
  if (classification === "observed-evidence") return "household-assertion";
  return classification;
}

function correctedEntry(entry: BriefEntry, actorUserId: string, correctedAt: string): BriefEntry {
  return {
    ...entry,
    classification: correctionClassification(entry.classification),
    provenance: {
      capturedAt: correctedAt,
      method: "user-stated",
      statedByUserId: actorUserId,
    },
  };
}

export function normalizeCorrectedBriefOperations(
  operations: readonly BriefPatchOperation[],
  actorUserId: string,
  correctedAt: string,
): readonly BriefPatchOperation[] {
  const actor = userIdSchema.parse(actorUserId);
  const timestamp = z.iso.datetime({ offset: true }).parse(correctedAt);
  return briefPatchOperationSchema.array().parse(
    operations.map((operation) => {
      if (operation.kind === "entry.add") {
        return { ...operation, entry: correctedEntry(operation.entry, actor, timestamp) };
      }
      if (operation.kind === "entry.replace") {
        return { ...operation, entry: correctedEntry(operation.entry, actor, timestamp) };
      }
      return operation;
    }),
  );
}
