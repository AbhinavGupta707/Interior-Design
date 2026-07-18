import { describe, expect, it } from "vitest";

import {
  briefEntrySchema,
  briefPatchProposalSchema,
  c11RouteContract,
  consultationSessionSchema,
  designBriefSchema,
  updateBriefRequestSchema,
} from "../src/index.js";

const ids = {
  asset: "11111111-1111-4111-8111-111111111111",
  brief: "22222222-2222-4222-8222-222222222222",
  entry: "33333333-3333-4333-8333-333333333333",
  message: "44444444-4444-4444-8444-444444444444",
  project: "55555555-5555-4555-8555-555555555555",
  proposal: "66666666-6666-4666-8666-666666666666",
  session: "77777777-7777-4777-8777-777777777777",
  user: "88888888-8888-4888-8888-888888888888",
};

const userEntry = {
  category: "storage",
  classification: "hard-constraint",
  id: ids.entry,
  priority: 5,
  provenance: {
    capturedAt: "2026-07-18T08:00:00.000Z",
    method: "user-stated",
    statedByUserId: ids.user,
  },
  roomOrLevelElementIds: [],
  statement: "Retain accessible storage for mobility equipment near the entrance.",
  status: "active",
};

describe("C11 shared contracts", () => {
  it("distinguishes an attributable hard constraint from a preference", () => {
    expect(briefEntrySchema.parse(userEntry).classification).toBe("hard-constraint");
    expect(
      briefEntrySchema.parse({ ...userEntry, classification: "preference" }).classification,
    ).toBe("preference");
  });

  it("rejects evidence claims without an immutable evidence reference", () => {
    const parsed = briefEntrySchema.safeParse({
      ...userEntry,
      classification: "observed-evidence",
      provenance: { capturedAt: "2026-07-18T08:00:00.000Z", method: "evidence-linked" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects assistant suggestions without the exact source message", () => {
    const parsed = briefEntrySchema.safeParse({
      ...userEntry,
      classification: "inferred-suggestion",
      provenance: { capturedAt: "2026-07-18T08:00:00.000Z", method: "assistant-suggested" },
    });
    expect(parsed.success).toBe(false);
  });

  it("requires unique entries and accountable acceptance", () => {
    const base = {
      createdAt: "2026-07-18T08:00:00.000Z",
      entries: [userEntry],
      id: ids.brief,
      projectId: ids.project,
      referenceBoard: [],
      revision: 1,
      schemaVersion: "c11-design-brief-v1",
      status: "draft",
      updatedAt: "2026-07-18T08:00:00.000Z",
      updatedBy: ids.user,
    };
    expect(designBriefSchema.parse(base).status).toBe("draft");
    expect(designBriefSchema.safeParse({ ...base, entries: [userEntry, userEntry] }).success).toBe(
      false,
    );
    expect(designBriefSchema.safeParse({ ...base, status: "accepted" }).success).toBe(false);
    expect(
      designBriefSchema.safeParse({
        ...base,
        acceptedAt: "2026-07-18T09:00:00.000Z",
        acceptedBy: ids.user,
        status: "accepted",
      }).success,
    ).toBe(true);
  });

  it("freezes revision-checked idempotent patch commands", () => {
    const parsed = updateBriefRequestSchema.parse({
      expectedRevision: 0,
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      operations: [{ entry: userEntry, kind: "entry.add" }],
    });
    expect(parsed.operations).toHaveLength(1);
    expect(updateBriefRequestSchema.safeParse({ ...parsed, unknown: true }).success).toBe(false);
  });

  it("makes local consultation capability explicit", () => {
    const parsed = consultationSessionSchema.parse({
      baseBriefId: ids.brief,
      baseBriefRevision: 0,
      createdAt: "2026-07-18T08:00:00.000Z",
      createdBy: ids.user,
      id: ids.session,
      projectId: ids.project,
      providerMode: "deterministic-local",
      schemaVersion: "c11-consultation-session-v1",
      state: "active",
      turnCount: 0,
      updatedAt: "2026-07-18T08:00:00.000Z",
    });
    expect(parsed.providerMode).toBe("deterministic-local");
  });

  it("requires proposals to patch, clarify or route to review without external access", () => {
    const base = {
      baseBriefId: ids.brief,
      baseBriefRevision: 0,
      clarifyingQuestions: ["Which items must remain in the room?"],
      createdAt: "2026-07-18T08:00:00.000Z",
      expiresAt: "2026-07-18T08:30:00.000Z",
      id: ids.proposal,
      operations: [],
      professionalReview: [],
      projectId: ids.project,
      providerManifest: {
        adapter: "deterministic-local-v1",
        externalNetworkUsed: false,
        promptRegistryVersion: "brief-consultation-v1",
        toolRegistryVersion: "brief-tools-v1",
      },
      schemaVersion: "c11-brief-patch-proposal-v1",
      sessionId: ids.session,
      sourceMessageId: ids.message,
      status: "pending",
      summary: "One clarification is required before the brief can be updated.",
    };
    expect(briefPatchProposalSchema.parse(base).providerManifest.externalNetworkUsed).toBe(false);
    expect(
      briefPatchProposalSchema.safeParse({
        ...base,
        clarifyingQuestions: [],
      }).success,
    ).toBe(false);
    expect(
      briefPatchProposalSchema.safeParse({
        ...base,
        expiresAt: "2026-07-18T07:59:59.000Z",
      }).success,
    ).toBe(false);
  });

  it("freezes the exact C11 route inventory", () => {
    expect(Object.keys(c11RouteContract).sort()).toEqual([
      "acceptBrief",
      "cancelConsultation",
      "confirmProposal",
      "createConsultation",
      "getBrief",
      "getConsultation",
      "getProposal",
      "submitTurn",
      "updateBrief",
    ]);
  });
});
