import {
  briefEntrySchema,
  referenceBoardItemSchema,
  type Actor,
  type BriefEntry,
  type BriefPatchOperation,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  DesignBriefDomainError,
  DeterministicDesignBriefKernel,
  canonicalBriefSnapshot,
  canonicalDesignBriefJson,
  stableDesignBriefUuid,
} from "../src/index.js";

const projectId = "11000000-0000-4000-8000-000000000001";
const briefId = "11000000-0000-4000-8000-000000000002";
const ownerId = "11000000-0000-4000-8000-000000000003";
const editorId = "11000000-0000-4000-8000-000000000004";
const assetId = "11000000-0000-4000-8000-000000000005";
const snapshotId = "11000000-0000-4000-8000-000000000006";
const messageId = "11000000-0000-4000-8000-000000000007";
const roomA = "11000000-0000-4000-8000-000000000008";
const roomB = "11000000-0000-4000-8000-000000000009";
const now = "2026-07-18T10:00:00.000Z";

const owner: Actor = {
  displayName: "Synthetic owner",
  role: "owner",
  subject: "fixture|owner-c11",
  tenantId: "11000000-0000-4000-8000-000000000010",
  userId: ownerId,
};
const editor: Actor = { ...owner, role: "editor", userId: editorId };

function entry(id: string, overrides: Partial<BriefEntry> = {}): BriefEntry {
  return briefEntrySchema.parse({
    category: "storage",
    classification: "household-assertion",
    id,
    priority: 3,
    provenance: {
      capturedAt: now,
      method: "user-stated",
      statedByUserId: ownerId,
    },
    roomOrLevelElementIds: [roomB, roomA],
    statement: "Keep the synthetic hallway clear for daily circulation.",
    status: "active",
    ...overrides,
  });
}

function add(entryValue: BriefEntry): BriefPatchOperation {
  return { entry: entryValue, kind: "entry.add" };
}

function create(operations: readonly BriefPatchOperation[]) {
  return new DeterministicDesignBriefKernel().create({
    actor: owner,
    at: now,
    briefId,
    operations,
    projectId,
  });
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected deterministic failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(DesignBriefDomainError);
    expect((error as DesignBriefDomainError).code).toBe(code);
  }
}

describe("deterministic design-brief kernel", () => {
  it("canonicalizes entry, room and reference ordering with stable hashes", () => {
    const firstId = "11000000-0000-4000-8000-000000000011";
    const secondId = "11000000-0000-4000-8000-000000000012";
    const referenceA = referenceBoardItemSchema.parse({
      assetId,
      id: "11000000-0000-4000-8000-000000000013",
      rightsRecordSha256: "a".repeat(64),
      sentiment: "like",
    });
    const referenceB = referenceBoardItemSchema.parse({
      assetId,
      id: "11000000-0000-4000-8000-000000000014",
      rightsRecordSha256: "a".repeat(64),
      sentiment: "context-only",
    });
    const left = create([
      add(entry(secondId)),
      add(entry(firstId)),
      { item: referenceB, kind: "reference.add" },
      { item: referenceA, kind: "reference.add" },
    ]);
    const right = create([
      { item: referenceA, kind: "reference.add" },
      add(entry(firstId)),
      { item: referenceB, kind: "reference.add" },
      add(entry(secondId)),
    ]);
    expect(left.snapshotSha256).toBe(right.snapshotSha256);
    expect(left.contentSha256).toBe(right.contentSha256);
    expect(left.brief.entries.map(({ id }) => id)).toEqual([firstId, secondId]);
    expect(left.brief.entries[0]?.roomOrLevelElementIds).toEqual([roomA, roomB]);
    expect(left.brief.referenceBoard.map(({ id }) => id)).toEqual([referenceA.id, referenceB.id]);
    expect(canonicalDesignBriefJson(left.brief)).toBe(canonicalDesignBriefJson(right.brief));
  });

  it("applies operations in exact caller order while preserving stable IDs", () => {
    const entryId = "11000000-0000-4000-8000-000000000015";
    const initial = create([add(entry(entryId))]);
    const replacement = entry(entryId, { statement: "A corrected synthetic storage requirement." });
    const revised = new DeterministicDesignBriefKernel().revise({
      actor: editor,
      at: "2026-07-18T10:01:00.000Z",
      current: initial.brief,
      operations: [{ entryId, kind: "entry.remove" }, add(replacement)],
    });
    expect(revised.brief.entries).toHaveLength(1);
    expect(revised.brief.entries[0]).toMatchObject({
      id: replacement.id,
      statement: replacement.statement,
    });
    expectCode(
      () =>
        new DeterministicDesignBriefKernel().revise({
          actor: editor,
          at: "2026-07-18T10:01:00.000Z",
          current: initial.brief,
          operations: [add(replacement), { entryId, kind: "entry.remove" }],
        }),
      "BRIEF_ENTRY_EXISTS",
    );
  });

  it("creates immutable revision snapshots and refuses missing or duplicate targets", () => {
    const entryId = "11000000-0000-4000-8000-000000000016";
    const created = create([add(entry(entryId))]);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.brief)).toBe(true);
    expect(Object.isFrozen(created.brief.entries)).toBe(true);
    expectCode(() => create([add(entry(entryId)), add(entry(entryId))]), "BRIEF_ENTRY_EXISTS");
    expectCode(
      () =>
        new DeterministicDesignBriefKernel().revise({
          actor: editor,
          at: now,
          current: created.brief,
          operations: [{ entryId: "11000000-0000-4000-8000-000000000099", kind: "entry.remove" }],
        }),
      "BRIEF_ENTRY_NOT_FOUND",
    );
  });

  it("records explicit acceptance as a revision and reopens only through an edit", () => {
    const created = create([add(entry("11000000-0000-4000-8000-000000000017"))]);
    const accepted = new DeterministicDesignBriefKernel().accept({
      actor: owner,
      at: "2026-07-18T10:02:00.000Z",
      current: created.brief,
    });
    expect(accepted).toMatchObject({ reason: "accepted" });
    expect(accepted.brief).toMatchObject({
      acceptedBy: ownerId,
      revision: 2,
      status: "accepted",
    });
    expect(accepted.contentSha256).toBe(created.contentSha256);
    expect(accepted.snapshotSha256).not.toBe(created.snapshotSha256);
    expectCode(
      () =>
        new DeterministicDesignBriefKernel().accept({
          actor: owner,
          at: "2026-07-18T10:03:00.000Z",
          current: accepted.brief,
        }),
      "BRIEF_ALREADY_ACCEPTED",
    );
    const reopened = new DeterministicDesignBriefKernel().revise({
      actor: editor,
      at: "2026-07-18T10:03:00.000Z",
      current: accepted.brief,
      operations: [
        add(
          entry("11000000-0000-4000-8000-000000000018", {
            category: "style-aesthetic",
            classification: "preference",
          }),
        ),
      ],
    });
    expect(reopened).toMatchObject({ reason: "reopened" });
    expect(reopened.brief).toMatchObject({ revision: 3, status: "draft" });
    expect(reopened.brief).not.toHaveProperty("acceptedAt");
    expect(reopened.brief).not.toHaveProperty("acceptedBy");
  });

  it("rejects empty, withdrawn-only and reference-only acceptance without hiding unknowns", () => {
    const kernel = new DeterministicDesignBriefKernel();
    const activeId = "11000000-0000-4000-8000-000000000030";
    const removed = kernel.revise({
      actor: editor,
      at: "2026-07-18T10:01:00.000Z",
      current: create([add(entry(activeId))]).brief,
      operations: [{ entryId: activeId, kind: "entry.remove" }],
    });
    expectCode(
      () => kernel.accept({ actor: owner, at: "2026-07-18T10:02:00.000Z", current: removed.brief }),
      "BRIEF_ACCEPTANCE_EMPTY",
    );
    const withdrawn = create([
      add(entry("11000000-0000-4000-8000-000000000031", { status: "withdrawn" })),
    ]);
    expectCode(
      () =>
        kernel.accept({
          actor: owner,
          at: "2026-07-18T10:02:00.000Z",
          current: withdrawn.brief,
        }),
      "BRIEF_ACCEPTANCE_EMPTY",
    );
    const referenceOnly = create([
      {
        item: referenceBoardItemSchema.parse({
          assetId,
          id: "11000000-0000-4000-8000-000000000032",
          rightsRecordSha256: "a".repeat(64),
          sentiment: "like",
        }),
        kind: "reference.add",
      },
    ]);
    expectCode(
      () =>
        kernel.accept({
          actor: owner,
          at: "2026-07-18T10:02:00.000Z",
          current: referenceOnly.brief,
        }),
      "BRIEF_ACCEPTANCE_EMPTY",
    );
    const unknown = create([
      add(
        entry("11000000-0000-4000-8000-000000000033", {
          classification: "unknown",
          statement: "The synthetic circulation preference remains explicitly unknown.",
        }),
      ),
    ]);
    const acceptedUnknown = kernel.accept({
      actor: owner,
      at: "2026-07-18T10:02:00.000Z",
      current: unknown.brief,
    });
    expect(acceptedUnknown.brief.entries).toEqual(unknown.brief.entries);
    expect(acceptedUnknown.brief.entries[0]?.classification).toBe("unknown");
  });

  it("makes timestamps strictly monotonic even under a repeated clock value", () => {
    const created = create([add(entry("11000000-0000-4000-8000-000000000019"))]);
    const revised = new DeterministicDesignBriefKernel().revise({
      actor: editor,
      at: now,
      current: created.brief,
      operations: [add(entry("11000000-0000-4000-8000-000000000020"))],
    });
    expect(Date.parse(revised.brief.updatedAt)).toBe(Date.parse(created.brief.updatedAt) + 1);
  });

  it("enforces classification/provenance boundaries", () => {
    const systemObserved = entry("11000000-0000-4000-8000-000000000021", {
      classification: "observed-evidence",
      provenance: {
        capturedAt: now,
        method: "system-derived",
        sourceSnapshotId: snapshotId,
      },
    });
    expect(create([add(systemObserved)]).brief.entries).toHaveLength(1);
    const assistantPreference = entry("11000000-0000-4000-8000-000000000022", {
      classification: "preference",
      provenance: { capturedAt: now, method: "assistant-extracted", sourceMessageId: messageId },
    });
    expect(create([add(assistantPreference)]).brief.entries).toHaveLength(1);
    expectCode(
      () =>
        create([
          add(
            entry("11000000-0000-4000-8000-000000000023", {
              classification: "hard-constraint",
              provenance: {
                capturedAt: now,
                method: "assistant-suggested",
                sourceMessageId: messageId,
              },
            }),
          ),
        ]),
      "BRIEF_INVALID_CLASSIFICATION_PROVENANCE",
    );
    expectCode(
      () =>
        create([
          add(
            entry("11000000-0000-4000-8000-000000000024", {
              classification: "household-assertion",
              provenance: { assetId, capturedAt: now, method: "evidence-linked" },
            }),
          ),
        ]),
      "BRIEF_INVALID_CLASSIFICATION_PROVENANCE",
    );
  });

  it("rejects duplicate element IDs, malformed values and oversized patches", () => {
    const duplicatedRooms = entry("11000000-0000-4000-8000-000000000025", {
      roomOrLevelElementIds: [roomA, roomA],
    });
    expectCode(() => create([add(duplicatedRooms)]), "BRIEF_INVALID_PATCH");
    expectCode(
      () =>
        create(
          Array.from({ length: 101 }, (_, index) =>
            add(entry(`11000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`)),
          ),
        ),
      "BRIEF_RESOURCE_LIMIT",
    );
    expectCode(() => canonicalBriefSnapshot({ malformed: Number.NaN }), "BRIEF_INVALID_PATCH");
  });

  it("derives deterministic UUIDs without collapsing ordered identity parts", () => {
    const first = stableDesignBriefUuid("synthetic", projectId, "storage", "0");
    expect(first).toBe(stableDesignBriefUuid("synthetic", projectId, "storage", "0"));
    expect(first).not.toBe(stableDesignBriefUuid("synthetic", projectId, "storage", "1"));
    expect(first).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
    expect(stableDesignBriefUuid("a\u001fb", "c")).not.toBe(stableDesignBriefUuid("a", "b\u001fc"));
  });
});
