import type { BriefPatchOperation } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { normalizeCorrectedBriefOperations } from "../../src/features/design-consultation/corrected-operations";
import { ids, proposal } from "./fixtures";

describe("C11 corrected proposal attribution", () => {
  it("reattributes adopted or edited entries to the confirming actor", () => {
    const source = proposal.operations[0];
    if (source?.kind !== "entry.add") throw new Error("Expected entry.add fixture");
    const observedEntryId = ids.entries.at(0);
    if (!observedEntryId) throw new Error("Expected an observed-entry ID");
    const operations: readonly BriefPatchOperation[] = [
      {
        ...source,
        entry: {
          ...source.entry,
          classification: "inferred-suggestion",
          provenance: {
            capturedAt: "2026-07-18T09:00:00.000Z",
            method: "assistant-suggested",
            sourceMessageId: ids.message,
          },
        },
      },
      {
        ...source,
        entry: {
          ...source.entry,
          classification: "observed-evidence",
          id: observedEntryId,
          provenance: {
            assetId: ids.asset,
            capturedAt: "2026-07-18T09:00:00.000Z",
            method: "evidence-linked",
          },
        },
      },
    ];
    const normalized = normalizeCorrectedBriefOperations(
      operations,
      ids.user,
      "2026-07-18T09:20:00.000Z",
    );
    const entries = normalized.flatMap((operation) =>
      operation.kind === "entry.add" || operation.kind === "entry.replace" ? [operation.entry] : [],
    );
    expect(entries.map(({ classification }) => classification)).toEqual([
      "preference",
      "household-assertion",
    ]);
    for (const entry of entries) {
      expect(entry.provenance).toEqual({
        capturedAt: "2026-07-18T09:20:00.000Z",
        method: "user-stated",
        statedByUserId: ids.user,
      });
    }
  });
});
