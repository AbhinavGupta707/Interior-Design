import {
  briefPatchOperationSchema,
  c11DesignBriefSchemaVersion,
  c11BriefPolicy,
  designBriefSchema,
  type Actor,
  type BriefEntry,
  type BriefPatchOperation,
  type DesignBrief,
  type ReferenceBoardItem,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { canonicalBriefSnapshot, type CanonicalBriefSnapshot } from "./canonical.js";
import { DesignBriefDomainError } from "./errors.js";

export type BriefRevisionReason = "accepted" | "created" | "reopened" | "updated";

export interface BriefRevisionSnapshot extends CanonicalBriefSnapshot {
  readonly reason: BriefRevisionReason;
}

export interface BriefMutationContext {
  readonly actor: Actor;
  readonly at: string;
}

export interface CreateBriefRevisionInput extends BriefMutationContext {
  readonly briefId: string;
  readonly operations: readonly BriefPatchOperation[];
  readonly projectId: string;
}

export interface ReviseBriefInput extends BriefMutationContext {
  readonly current: DesignBrief;
  readonly operations: readonly BriefPatchOperation[];
}

export interface AcceptBriefInput extends BriefMutationContext {
  readonly current: DesignBrief;
}

function validatedTimestamp(value: string, minimumExclusive?: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new DesignBriefDomainError("BRIEF_INVALID_TIMESTAMP");
  if (minimumExclusive === undefined || epoch > Date.parse(minimumExclusive)) {
    return new Date(epoch).toISOString();
  }
  return new Date(Date.parse(minimumExclusive) + 1).toISOString();
}

function validateClassification(entry: BriefEntry): void {
  const method = entry.provenance.method;
  const invalid =
    (entry.classification === "household-assertion" && method !== "user-stated") ||
    (entry.classification === "preference" &&
      method !== "user-stated" &&
      method !== "assistant-extracted") ||
    (entry.classification === "hard-constraint" && method === "assistant-suggested") ||
    (entry.classification === "observed-evidence" &&
      method === "system-derived" &&
      entry.provenance.sourceSnapshotId === undefined) ||
    (method === "user-stated" &&
      (entry.provenance.assetId !== undefined || entry.provenance.sourceMessageId !== undefined)) ||
    (method === "evidence-linked" &&
      (entry.provenance.statedByUserId !== undefined ||
        entry.provenance.sourceMessageId !== undefined)) ||
    ((method === "assistant-extracted" || method === "assistant-suggested") &&
      (entry.provenance.assetId !== undefined || entry.provenance.statedByUserId !== undefined));
  if (invalid) {
    throw new DesignBriefDomainError("BRIEF_INVALID_CLASSIFICATION_PROVENANCE");
  }
}

function parseOperations(
  operations: readonly BriefPatchOperation[],
): readonly BriefPatchOperation[] {
  if (operations.length === 0 || operations.length > c11BriefPolicy.maximumPatchOperations) {
    throw new DesignBriefDomainError("BRIEF_RESOURCE_LIMIT");
  }
  return operations.map((operation) => {
    const result = briefPatchOperationSchema.safeParse(operation);
    if (!result.success) throw new DesignBriefDomainError("BRIEF_INVALID_PATCH");
    if ("entry" in result.data) validateClassification(result.data.entry);
    return result.data;
  });
}

function applyOperations(
  currentEntries: readonly BriefEntry[],
  currentReferences: readonly ReferenceBoardItem[],
  operations: readonly BriefPatchOperation[],
): { readonly entries: readonly BriefEntry[]; readonly references: readonly ReferenceBoardItem[] } {
  const entries = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const references = new Map(currentReferences.map((item) => [item.id, item]));
  for (const operation of parseOperations(operations)) {
    switch (operation.kind) {
      case "entry.add": {
        if (entries.has(operation.entry.id)) {
          throw new DesignBriefDomainError("BRIEF_ENTRY_EXISTS");
        }
        entries.set(operation.entry.id, operation.entry);
        break;
      }
      case "entry.replace": {
        if (!entries.has(operation.expectedEntryId)) {
          throw new DesignBriefDomainError("BRIEF_ENTRY_NOT_FOUND");
        }
        entries.set(operation.expectedEntryId, operation.entry);
        break;
      }
      case "entry.remove": {
        if (!entries.delete(operation.entryId)) {
          throw new DesignBriefDomainError("BRIEF_ENTRY_NOT_FOUND");
        }
        break;
      }
      case "reference.add": {
        if (references.has(operation.item.id)) {
          throw new DesignBriefDomainError("BRIEF_REFERENCE_EXISTS");
        }
        references.set(operation.item.id, operation.item);
        break;
      }
      case "reference.remove": {
        if (!references.delete(operation.itemId)) {
          throw new DesignBriefDomainError("BRIEF_REFERENCE_NOT_FOUND");
        }
        break;
      }
    }
    if (
      entries.size > c11BriefPolicy.maximumBriefEntries ||
      references.size > c11BriefPolicy.maximumReferenceItems
    ) {
      throw new DesignBriefDomainError("BRIEF_RESOURCE_LIMIT");
    }
  }
  return { entries: [...entries.values()], references: [...references.values()] };
}

function revision(value: unknown, reason: BriefRevisionReason): BriefRevisionSnapshot {
  return Object.freeze({ ...canonicalBriefSnapshot(value), reason });
}

export class DeterministicDesignBriefKernel {
  create(input: CreateBriefRevisionInput): BriefRevisionSnapshot {
    const at = validatedTimestamp(input.at);
    const patched = applyOperations([], [], input.operations);
    return revision(
      designBriefSchema.parse({
        createdAt: at,
        entries: patched.entries,
        id: input.briefId,
        projectId: input.projectId,
        referenceBoard: patched.references,
        revision: 1,
        schemaVersion: c11DesignBriefSchemaVersion,
        status: "draft",
        updatedAt: at,
        updatedBy: input.actor.userId,
      }),
      "created",
    );
  }

  revise(input: ReviseBriefInput): BriefRevisionSnapshot {
    const current = designBriefSchema.parse(input.current);
    const { acceptedAt: _acceptedAt, acceptedBy: _acceptedBy, ...draft } = current;
    void _acceptedAt;
    void _acceptedBy;
    const at = validatedTimestamp(input.at, current.updatedAt);
    const patched = applyOperations(current.entries, current.referenceBoard, input.operations);
    const reopened = current.status === "accepted";
    return revision(
      designBriefSchema.parse({
        ...draft,
        entries: patched.entries,
        referenceBoard: patched.references,
        revision: current.revision + 1,
        status: "draft",
        updatedAt: at,
        updatedBy: input.actor.userId,
      }),
      reopened ? "reopened" : "updated",
    );
  }

  accept(input: AcceptBriefInput): BriefRevisionSnapshot {
    const current = designBriefSchema.parse(input.current);
    if (current.status === "accepted") {
      throw new DesignBriefDomainError("BRIEF_ALREADY_ACCEPTED");
    }
    if (!current.entries.some(({ status }) => status === "active")) {
      throw new DesignBriefDomainError("BRIEF_ACCEPTANCE_EMPTY");
    }
    const at = validatedTimestamp(input.at, current.updatedAt);
    return revision(
      designBriefSchema.parse({
        ...current,
        acceptedAt: at,
        acceptedBy: input.actor.userId,
        revision: current.revision + 1,
        status: "accepted",
        updatedAt: at,
        updatedBy: input.actor.userId,
      }),
      "accepted",
    );
  }
}

export function stableDesignBriefUuid(...parts: readonly string[]): string {
  if (parts.length === 0 || parts.some((part) => part.length === 0 || part.length > 500)) {
    throw new DesignBriefDomainError("BRIEF_INVALID_PATCH");
  }
  const bytes = createHash("sha256").update(JSON.stringify(parts), "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
