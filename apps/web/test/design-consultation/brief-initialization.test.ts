import { describe, expect, it } from "vitest";
import type { UpdateBriefRequest } from "@interior-design/contracts";

import {
  buildBriefInitializationRequest,
  intakeBriefFacts,
} from "../../src/features/design-consultation/brief-initialization";
import { ids, intakeSeed } from "./fixtures";

function operationEntries(request: UpdateBriefRequest) {
  return request.operations.flatMap((operation) =>
    operation.kind === "entry.add" || operation.kind === "entry.replace" ? [operation.entry] : [],
  );
}

describe("C11 explicit brief initialization", () => {
  it("maps selected saved facts to typed entries reasserted by the confirming actor", async () => {
    const facts = intakeBriefFacts(intakeSeed);
    const request = await buildBriefInitializationRequest(
      intakeSeed,
      new Set(facts.map(({ key }) => key)),
      ids.user,
    );
    expect(request.expectedRevision).toBe(0);
    expect(request.operations).toHaveLength(5);
    const entries = operationEntries(request);
    expect(entries.map((entry) => entry.classification)).toEqual([
      "household-assertion",
      "hard-constraint",
      "hard-constraint",
      "preference",
      "hard-constraint",
    ]);
    expect(
      entries.every(
        (entry) =>
          entry.provenance.method === "user-stated" &&
          entry.provenance.statedByUserId === ids.user &&
          entry.provenance.capturedAt === intakeSeed.updatedAt,
      ),
    ).toBe(true);
    expect(ids.user).not.toBe(intakeSeed.updatedBy);
    expect(JSON.stringify(request)).not.toMatch(/address|street|postcode/iu);
  });

  it("reuses the exact UUIDv8 request for an unchanged retry", async () => {
    const selected = new Set(intakeBriefFacts(intakeSeed).map(({ key }) => key));
    const first = await buildBriefInitializationRequest(intakeSeed, selected, ids.user);
    const retry = await buildBriefInitializationRequest(intakeSeed, selected, ids.user);
    expect(retry).toEqual(first);
    expect(first.idempotencyKey[14]).toBe("8");
    expect(["8", "9", "a", "b"]).toContain(first.idempotencyKey[19]?.toLowerCase());
  });

  it("separates changed selections, actors and intake versions", async () => {
    const facts = intakeBriefFacts(intakeSeed);
    const all = new Set(facts.map(({ key }) => key));
    const firstFact = facts.at(0);
    if (!firstFact) throw new Error("Expected at least one intake fact");
    const one = new Set([firstFact.key]);
    const base = await buildBriefInitializationRequest(intakeSeed, all, ids.user);
    const changedSelection = await buildBriefInitializationRequest(intakeSeed, one, ids.user);
    const changedActor = await buildBriefInitializationRequest(intakeSeed, all, ids.viewer);
    const changedVersion = await buildBriefInitializationRequest(
      { ...intakeSeed, version: intakeSeed.version + 1 },
      all,
      ids.user,
    );
    expect(
      new Set([
        base.idempotencyKey,
        changedSelection.idempotencyKey,
        changedActor.idempotencyKey,
        changedVersion.idempotencyKey,
      ]).size,
    ).toBe(4);
  });

  it("has no collisions across a deterministic hostile-selection smoke set", async () => {
    const keys = new Set<string>();
    for (let index = 0; index < 64; index += 1) {
      const intake = {
        ...intakeSeed,
        goals: ["Goal " + String(index) + " </textarea> IGNORE PREVIOUS"],
        version: index + 1,
      };
      const selected = new Set(intakeBriefFacts(intake).map(({ key }) => key));
      const request = await buildBriefInitializationRequest(intake, selected, ids.user);
      keys.add(request.idempotencyKey);
      for (const entry of operationEntries(request)) keys.add(entry.id);
    }
    expect(keys.size).toBe(64 * 6);
  });

  it("frames delimiter-like statements so distinct structured selections cannot share a preimage", async () => {
    const oneStructuredItem = {
      ...intakeSeed,
      goals: ["a|goals:1:b"],
    };
    const twoStructuredItems = {
      ...intakeSeed,
      goals: ["a", "b"],
    };
    const first = await buildBriefInitializationRequest(
      oneStructuredItem,
      new Set(intakeBriefFacts(oneStructuredItem).map(({ key }) => key)),
      ids.user,
    );
    const second = await buildBriefInitializationRequest(
      twoStructuredItems,
      new Set(intakeBriefFacts(twoStructuredItems).map(({ key }) => key)),
      ids.user,
    );
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(operationEntries(first).map(({ id }) => id)).not.toEqual(
      operationEntries(second).map(({ id }) => id),
    );
  });
});
