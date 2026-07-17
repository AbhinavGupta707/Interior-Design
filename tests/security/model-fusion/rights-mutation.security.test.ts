import { describe, expect, it } from "vitest";

import {
  assertOperationDraftOnly,
  assertRights,
  assertZeroCanonicalMutation,
} from "./reference-boundary.js";
import { validDraft } from "./synthetic-security-fixtures.js";

describe("C9 rights, training and draft-only mutation boundary", () => {
  it("requires service processing and fixes training use to denied", () => {
    expect(() => {
      assertRights({ serviceProcessingConsent: true, trainingUseConsent: "denied" });
    }).not.toThrow();
    for (const rights of [
      { serviceProcessingConsent: false, trainingUseConsent: "denied" },
      { serviceProcessingConsent: true, trainingUseConsent: "allowed" },
      { serviceProcessingConsent: true, trainingUseConsent: "unspecified" },
      { serviceProcessingConsent: true, trainingUseConsent: "denied", training: true },
    ]) {
      expect(() => {
        assertRights(rights);
      }).toThrow("FUSION_RIGHTS_DENIED");
    }
  });

  it("accepts an exact branch/revision/head-hash-pinned C5 operation draft", () => {
    expect(() => {
      assertOperationDraftOnly(validDraft);
    }).not.toThrow();
  });

  it.each([
    ["empty operations", { ...validDraft, operations: [] }],
    ["empty decisions", { ...validDraft, decisionIds: [] }],
    ["stale head hash", { ...validDraft, expectedHeadSnapshotSha256: "uppercase" }],
    [
      "direct commit route",
      {
        ...validDraft,
        operations: [{ kind: "move-wall-v1", endpoint: "/v1/model-operations/commit" }],
      },
    ],
    [
      "embedded canonical snapshot",
      { ...validDraft, operations: [{ kind: "move-wall-v1", canonicalSnapshot: {} }] },
    ],
    ["unknown auto-commit field", { ...validDraft, autoCommit: true }],
  ])("rejects %s", (_name, draft) => {
    expect(() => {
      assertOperationDraftOnly(draft);
    }).toThrow();
  });

  it("detects any branch or canonical snapshot mutation during draft creation", () => {
    expect(() => {
      assertZeroCanonicalMutation({
        afterBranchRevision: 7,
        afterSnapshotSha256: "a".repeat(64),
        beforeBranchRevision: 7,
        beforeSnapshotSha256: "a".repeat(64),
      });
    }).not.toThrow();
    expect(() => {
      assertZeroCanonicalMutation({
        afterBranchRevision: 8,
        afterSnapshotSha256: "b".repeat(64),
        beforeBranchRevision: 7,
        beforeSnapshotSha256: "a".repeat(64),
      });
    }).toThrow("FUSION_CANONICAL_MUTATION_DETECTED");
  });
});
