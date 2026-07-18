import {
  c11DesignBriefSchemaVersion,
  designBriefSchema,
  type Actor,
  type BriefEntry,
  type BriefPatchOperation,
  type DesignBrief,
  type ReferenceBoardItem,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import type {
  BriefDomainKernel,
  BriefRevisionReason,
  BriefRevisionRecord,
} from "../../../src/modules/briefs/types.js";
import { InMemoryBriefSourceVerifier } from "../../../src/modules/briefs/sources.js";
import { alphaProjectId, alphaTenantId, editorUserId, ownerUserId } from "../../c4/fixtures.js";

export { alphaProjectId, alphaTenantId, editorUserId, ownerUserId };

export const c11Now = "2026-07-18T11:00:00.000Z";
export const briefId = "b1000000-0000-4000-8000-000000000001";
export const entryId = "b1000000-0000-4000-8000-000000000002";
export const secondEntryId = "b1000000-0000-4000-8000-000000000003";
export const referenceId = "b1000000-0000-4000-8000-000000000004";
export const assetId = "b1000000-0000-4000-8000-000000000005";
export const snapshotId = "b1000000-0000-4000-8000-000000000006";
export const sourceMessageId = "b1000000-0000-4000-8000-000000000007";
export const consultationSessionId = "b1000000-0000-4000-8000-000000000008";
export const rightsRecordSha256 = "b".repeat(64);

export const owner: Actor = {
  displayName: "Synthetic owner",
  role: "owner",
  subject: "fixture|owner-alpha",
  tenantId: alphaTenantId,
  userId: ownerUserId,
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nextAt(current: string | undefined, requested: string): string {
  if (current === undefined || Date.parse(requested) > Date.parse(current)) return requested;
  return new Date(Date.parse(current) + 1).toISOString();
}

function apply(
  entries: readonly BriefEntry[],
  references: readonly ReferenceBoardItem[],
  operations: readonly BriefPatchOperation[],
) {
  const nextEntries = new Map(entries.map((entry) => [entry.id, entry]));
  const nextReferences = new Map(references.map((item) => [item.id, item]));
  for (const operation of operations) {
    if (operation.kind === "entry.add") {
      if (nextEntries.has(operation.entry.id))
        throw Object.assign(new Error(), { code: "BRIEF_ENTRY_EXISTS" });
      nextEntries.set(operation.entry.id, operation.entry);
    } else if (operation.kind === "entry.replace") {
      if (!nextEntries.has(operation.expectedEntryId))
        throw Object.assign(new Error(), { code: "BRIEF_ENTRY_NOT_FOUND" });
      nextEntries.set(operation.expectedEntryId, operation.entry);
    } else if (operation.kind === "entry.remove") {
      if (!nextEntries.delete(operation.entryId))
        throw Object.assign(new Error(), { code: "BRIEF_ENTRY_NOT_FOUND" });
    } else if (operation.kind === "reference.add") {
      if (nextReferences.has(operation.item.id))
        throw Object.assign(new Error(), { code: "BRIEF_REFERENCE_EXISTS" });
      nextReferences.set(operation.item.id, operation.item);
    } else if (!nextReferences.delete(operation.itemId)) {
      throw Object.assign(new Error(), { code: "BRIEF_REFERENCE_NOT_FOUND" });
    }
  }
  return {
    entries: [...nextEntries.values()].sort((left, right) => left.id.localeCompare(right.id)),
    references: [...nextReferences.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function record(brief: DesignBrief, reason: BriefRevisionReason): BriefRevisionRecord {
  const snapshot = designBriefSchema.parse(brief);
  const snapshotSha256 = hash(snapshot);
  const contentSha256 = hash({
    entries: snapshot.entries,
    id: snapshot.id,
    projectId: snapshot.projectId,
    referenceBoard: snapshot.referenceBoard,
    schemaVersion: snapshot.schemaVersion,
  });
  return {
    brief: snapshot,
    canonicalByteLength: Buffer.byteLength(JSON.stringify(snapshot)),
    contentSha256,
    reason,
    snapshotSha256,
  };
}

export class FixtureBriefKernel implements BriefDomainKernel {
  create(input: Parameters<BriefDomainKernel["create"]>[0]) {
    const patched = apply([], [], input.operations);
    return record(
      designBriefSchema.parse({
        createdAt: input.at,
        entries: patched.entries,
        id: input.briefId,
        projectId: input.projectId,
        referenceBoard: patched.references,
        revision: 1,
        schemaVersion: c11DesignBriefSchemaVersion,
        status: "draft",
        updatedAt: input.at,
        updatedBy: input.actor.userId,
      }),
      "created",
    );
  }

  revise(input: Parameters<BriefDomainKernel["revise"]>[0]) {
    const { acceptedAt: _acceptedAt, acceptedBy: _acceptedBy, ...draft } = input.current;
    void _acceptedAt;
    void _acceptedBy;
    const patched = apply(input.current.entries, input.current.referenceBoard, input.operations);
    const reopened = input.current.status === "accepted";
    return record(
      designBriefSchema.parse({
        ...draft,
        entries: patched.entries,
        referenceBoard: patched.references,
        revision: input.current.revision + 1,
        status: "draft",
        updatedAt: nextAt(input.current.updatedAt, input.at),
        updatedBy: input.actor.userId,
      }),
      reopened ? "reopened" : "updated",
    );
  }

  accept(input: Parameters<BriefDomainKernel["accept"]>[0]) {
    if (input.current.status === "accepted") {
      throw Object.assign(new Error(), { code: "BRIEF_ALREADY_ACCEPTED" });
    }
    if (!input.current.entries.some(({ status }) => status === "active")) {
      throw Object.assign(new Error(), { code: "BRIEF_ACCEPTANCE_EMPTY" });
    }
    const at = nextAt(input.current.updatedAt, input.at);
    return record(
      designBriefSchema.parse({
        ...input.current,
        acceptedAt: at,
        acceptedBy: input.actor.userId,
        revision: input.current.revision + 1,
        status: "accepted",
        updatedAt: at,
        updatedBy: input.actor.userId,
      }),
      "accepted",
    );
  }
}

export function householdEntry(id = entryId): BriefEntry {
  return {
    category: "storage",
    classification: "household-assertion",
    id,
    priority: 4,
    provenance: {
      capturedAt: c11Now,
      method: "user-stated",
      statedByUserId: ownerUserId,
    },
    roomOrLevelElementIds: [],
    statement: "Keep enough closed storage for the synthetic household.",
    status: "active",
  };
}

export function evidenceEntry(id = entryId): BriefEntry {
  return {
    category: "retained-item",
    classification: "observed-evidence",
    id,
    priority: 5,
    provenance: { assetId, capturedAt: c11Now, method: "evidence-linked" },
    roomOrLevelElementIds: [],
    statement: "The rights-cleared synthetic image records a retained table.",
    status: "active",
  };
}

export function assistantEntry(id = entryId): BriefEntry {
  return {
    category: "style-aesthetic",
    classification: "preference",
    id,
    priority: 3,
    provenance: {
      capturedAt: c11Now,
      method: "assistant-extracted",
      sourceMessageId,
    },
    roomOrLevelElementIds: [],
    statement: "The synthetic consultation message states a preference for restrained colour.",
    status: "active",
  };
}

export function referenceItem(): ReferenceBoardItem {
  return {
    assetId,
    id: referenceId,
    rightsRecordSha256,
    sentiment: "like",
  };
}

export function sourceVerifier(): InMemoryBriefSourceVerifier {
  const verifier = new InMemoryBriefSourceVerifier();
  verifier.assets.set(`${alphaTenantId}:${alphaProjectId}:${assetId}`, {
    assetId,
    projectId: alphaProjectId,
    rightsRecordSha256,
    serviceProcessingConsent: true,
    sourceSha256: "a".repeat(64),
    status: "ready",
    tenantId: alphaTenantId,
    trainingUseConsent: "denied",
  });
  verifier.snapshots.set(`${alphaTenantId}:${alphaProjectId}:${snapshotId}`, {
    projectId: alphaProjectId,
    snapshotId,
    snapshotSha256: "c".repeat(64),
    tenantId: alphaTenantId,
  });
  verifier.messages.set(`${alphaTenantId}:${alphaProjectId}:${sourceMessageId}`, {
    contentSha256: "d".repeat(64),
    createdAt: c11Now,
    createdByUserId: ownerUserId,
    messageId: sourceMessageId,
    projectId: alphaProjectId,
    sessionId: consultationSessionId,
    tenantId: alphaTenantId,
  });
  return verifier;
}

export const correlation = {
  requestId: "c11-request-0001",
  spanId: "1".repeat(16),
  traceId: "1".repeat(32),
  traceParent: `00-${"1".repeat(32)}-${"1".repeat(16)}-00`,
};
