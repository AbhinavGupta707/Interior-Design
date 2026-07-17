import { describe, expect, it } from "vitest";

import { assertExactReferences, authorize, type FusionPublicAction } from "./reference-boundary.js";
import {
  ids,
  owner,
  references,
  resource,
  validReferenceEnvelope,
} from "./synthetic-security-fixtures.js";

describe("C9 tenant, IDOR, reference and hash boundary", () => {
  it("denies foreign tenant and project before action or existence disclosure", () => {
    const actions: readonly FusionPublicAction[] = [
      "cancel",
      "create",
      "draft",
      "read",
      "retry",
      "review",
    ];
    for (const actor of [
      { ...owner, tenantId: "c9000000-0000-4000-8000-000000000999" },
      { ...owner, projectId: "c9000000-0000-4000-8000-000000000998" },
    ]) {
      for (const action of actions) {
        expect(() => {
          authorize(actor, resource, action);
        }).toThrow("FUSION_NOT_FOUND");
      }
    }
  });

  it("keeps viewers read-only and applies lifecycle checks to owner/editor", () => {
    const viewer = { ...owner, role: "viewer" as const };
    expect(() => {
      authorize(viewer, resource, "read");
    }).not.toThrow();
    for (const action of ["cancel", "create", "draft", "retry", "review"] as const) {
      expect(() => {
        authorize(viewer, resource, action);
      }).toThrow("FUSION_FORBIDDEN");
    }
    expect(() => {
      authorize(owner, resource, "cancel");
    }).not.toThrow();
    expect(() => {
      authorize(owner, resource, "review");
    }).toThrow("FUSION_PROPOSAL_NOT_READY");
    expect(() => {
      authorize(owner, { ...resource, proposalVersion: 1, state: "proposed" }, "review");
    }).not.toThrow();
  });

  it("accepts only the exact tenant/project/model/base/source reference graph", () => {
    expect(() => {
      assertExactReferences(references, validReferenceEnvelope);
    }).not.toThrow();
    for (const attacked of [
      { ...validReferenceEnvelope, tenantId: "c9000000-0000-4000-8000-000000000997" },
      { ...validReferenceEnvelope, projectId: "c9000000-0000-4000-8000-000000000996" },
      { ...validReferenceEnvelope, modelId: "c9000000-0000-4000-8000-000000000995" },
      { ...validReferenceEnvelope, baseSnapshotId: "c9000000-0000-4000-8000-000000000994" },
      {
        ...validReferenceEnvelope,
        sources: [
          { ...validReferenceEnvelope.sources[0], projectId: ids.tenantId },
          validReferenceEnvelope.sources[1],
        ],
      },
    ]) {
      expect(() => {
        assertExactReferences(references, attacked);
      }).toThrow("FUSION_REFERENCE_SCOPE_MISMATCH");
    }
  });

  it("rejects hash substitution, duplicate sources and unknown reference fields", () => {
    expect(() => {
      assertExactReferences(references, {
        ...validReferenceEnvelope,
        baseSnapshotSha256: "A".repeat(64),
      });
    }).toThrow("FUSION_REFERENCE_HASH_MISMATCH");
    expect(() => {
      assertExactReferences(references, {
        ...validReferenceEnvelope,
        sources: [validReferenceEnvelope.sources[0], validReferenceEnvelope.sources[0]],
      });
    }).toThrow("FUSION_REFERENCE_SOURCE_SET_MISMATCH");
    expect(() => {
      assertExactReferences(references, { ...validReferenceEnvelope, signedUrl: "synthetic" });
    }).toThrow("FUSION_REFERENCE_BUNDLE_INVALID");
  });
});
