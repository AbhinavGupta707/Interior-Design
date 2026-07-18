import { ModelGatewayError, invalidOutput, invalidRequest, resourceLimit } from "./errors.js";
import { promptRegistryVersion, toolRegistryVersion } from "./registries.js";
import {
  consultationPromptId,
  consultationToolId,
  deterministicLocalAdapterId,
  externalDisabledAdapterId,
  modelGatewayLimits,
  modelGatewayRequestSchemaVersion,
  modelGatewayResultSchemaVersion,
  type GatewayBriefEntryCategory,
  type GatewayBriefEntryClassification,
  type GatewayProposedClassification,
  type ModelGatewayRequest,
  type ModelGatewayResult,
  type ProfessionalReviewReason,
} from "./types.js";

type SafeFailure = () => Error;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const entryCategories = new Set<GatewayBriefEntryCategory>([
  "household-change",
  "accessibility",
  "work-study",
  "cooking-dining",
  "entertaining",
  "storage",
  "privacy",
  "acoustics",
  "daylight-view",
  "garden-outdoor",
  "retained-item",
  "spatial-need",
  "adjacency",
  "minimum-dimension",
  "style-aesthetic",
  "material-colour",
  "reference",
  "budget-category",
  "disruption-timing",
  "sustainability",
  "decision-criterion",
  "professional-review",
  "other",
]);

const entryClassifications = new Set<GatewayBriefEntryClassification>([
  "observed-evidence",
  "household-assertion",
  "hard-constraint",
  "preference",
  "inferred-suggestion",
  "unresolved-conflict",
  "unknown",
]);

const proposedClassifications = new Set<GatewayProposedClassification>([
  "household-assertion",
  "hard-constraint",
  "preference",
  "unresolved-conflict",
  "unknown",
]);

const reviewReasons = new Set<ProfessionalReviewReason>([
  "structural",
  "regulatory",
  "accessibility-clinical",
  "cost-certainty",
  "product-availability",
  "professional-judgement",
  "insufficient-evidence",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, failure: SafeFailure): Record<string, unknown> {
  if (!isRecord(value)) throw failure();
  return value;
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  failure: SafeFailure,
): void {
  const keys = Object.keys(record).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw failure();
  }
}

function stringValue(
  value: unknown,
  minimum: number,
  maximum: number,
  failure: SafeFailure,
): string {
  if (typeof value !== "string") throw failure();
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) throw failure();
  return trimmed;
}

function uuidValue(value: unknown, failure: SafeFailure): string {
  const parsed = stringValue(value, 36, 36, failure);
  if (!uuidPattern.test(parsed)) throw failure();
  return parsed;
}

function isoDateTime(value: unknown, failure: SafeFailure): string {
  const parsed = stringValue(value, 20, 40, failure);
  if (!Number.isFinite(Date.parse(parsed)) || !parsed.includes("T")) throw failure();
  return parsed;
}

function serialisedLength(value: unknown, failure: SafeFailure): number {
  try {
    const serialised = JSON.stringify(value);
    return serialised.length;
  } catch (error) {
    if (error instanceof ModelGatewayError) throw error;
    throw failure();
  }
}

function requireArray(value: unknown, maximum: number, failure: SafeFailure): readonly unknown[] {
  if (!Array.isArray(value)) throw failure();
  if (value.length > maximum) throw failure();
  return value;
}

function parseContextEntry(value: unknown): void {
  const failure = invalidRequest;
  const entry = requireRecord(value, failure);
  exactKeys(entry, ["category", "classification", "id", "statement", "status"], failure);
  if (!entryCategories.has(entry.category as GatewayBriefEntryCategory)) throw failure();
  if (!entryClassifications.has(entry.classification as GatewayBriefEntryClassification)) {
    throw failure();
  }
  uuidValue(entry.id, failure);
  stringValue(entry.statement, 1, modelGatewayLimits.maximumStatementCharacters, failure);
  if (entry.status !== "active" && entry.status !== "resolved" && entry.status !== "withdrawn") {
    throw failure();
  }
}

function parseEvidenceExcerpt(value: unknown): void {
  const failure = invalidRequest;
  const excerpt = requireRecord(value, failure);
  exactKeys(excerpt, ["assetId", "id", "text"], failure);
  uuidValue(excerpt.assetId, failure);
  uuidValue(excerpt.id, failure);
  stringValue(excerpt.text, 1, modelGatewayLimits.maximumEvidenceExcerptCharacters, failure);
}

export function parseModelGatewayRequest(value: unknown): ModelGatewayRequest {
  if (serialisedLength(value, invalidRequest) > modelGatewayLimits.maximumRequestCharacters) {
    throw resourceLimit();
  }
  const request = requireRecord(value, invalidRequest);
  exactKeys(
    request,
    ["adapterId", "input", "limits", "promptId", "requestId", "schemaVersion", "toolId"],
    invalidRequest,
  );
  if (request.schemaVersion !== modelGatewayRequestSchemaVersion) throw invalidRequest();
  if (
    request.adapterId !== deterministicLocalAdapterId &&
    request.adapterId !== externalDisabledAdapterId
  ) {
    throw invalidRequest();
  }
  if (request.promptId !== consultationPromptId || request.toolId !== consultationToolId) {
    throw invalidRequest();
  }
  uuidValue(request.requestId, invalidRequest);

  const limits = requireRecord(request.limits, invalidRequest);
  exactKeys(limits, ["timeoutMs"], invalidRequest);
  if (
    !Number.isInteger(limits.timeoutMs) ||
    (limits.timeoutMs as number) < 1 ||
    (limits.timeoutMs as number) > modelGatewayLimits.maximumTimeoutMs
  ) {
    throw resourceLimit();
  }

  const input = requireRecord(request.input, invalidRequest);
  exactKeys(
    input,
    ["currentBriefEntries", "evidenceExcerpts", "generatedAt", "sourceMessage"],
    invalidRequest,
  );
  isoDateTime(input.generatedAt, invalidRequest);
  const message = requireRecord(input.sourceMessage, invalidRequest);
  exactKeys(message, ["id", "text"], invalidRequest);
  uuidValue(message.id, invalidRequest);
  stringValue(message.text, 1, modelGatewayLimits.maximumUserMessageCharacters, invalidRequest);
  requireArray(
    input.currentBriefEntries,
    modelGatewayLimits.maximumBriefEntries,
    resourceLimit,
  ).forEach(parseContextEntry);
  requireArray(
    input.evidenceExcerpts,
    modelGatewayLimits.maximumEvidenceExcerpts,
    resourceLimit,
  ).forEach(parseEvidenceExcerpt);
  return value as ModelGatewayRequest;
}

function parseProposedEntry(value: unknown): string {
  const failure = invalidOutput;
  const entry = requireRecord(value, failure);
  exactKeys(
    entry,
    [
      "category",
      "classification",
      "id",
      "priority",
      "provenance",
      "roomOrLevelElementIds",
      "statement",
      "status",
    ],
    failure,
  );
  if (!entryCategories.has(entry.category as GatewayBriefEntryCategory)) throw failure();
  if (!proposedClassifications.has(entry.classification as GatewayProposedClassification)) {
    throw failure();
  }
  const id = uuidValue(entry.id, failure);
  if (
    !Number.isInteger(entry.priority) ||
    (entry.priority as number) < 1 ||
    (entry.priority as number) > 5
  ) {
    throw failure();
  }
  const provenance = requireRecord(entry.provenance, failure);
  exactKeys(provenance, ["capturedAt", "method", "sourceMessageId"], failure);
  isoDateTime(provenance.capturedAt, failure);
  if (provenance.method !== "assistant-extracted") throw failure();
  uuidValue(provenance.sourceMessageId, failure);
  requireArray(entry.roomOrLevelElementIds, 50, failure).forEach((item) => {
    uuidValue(item, failure);
  });
  stringValue(entry.statement, 1, modelGatewayLimits.maximumStatementCharacters, failure);
  if (entry.status !== "active") throw failure();
  return id;
}

function parseOperation(value: unknown): string {
  const operation = requireRecord(value, invalidOutput);
  exactKeys(operation, ["entry", "kind"], invalidOutput);
  if (operation.kind !== "entry.add") throw invalidOutput();
  return parseProposedEntry(operation.entry);
}

function parseReview(value: unknown): void {
  const review = requireRecord(value, invalidOutput);
  exactKeys(review, ["question", "reason", "status"], invalidOutput);
  stringValue(review.question, 1, modelGatewayLimits.maximumStatementCharacters, invalidOutput);
  if (!reviewReasons.has(review.reason as ProfessionalReviewReason)) throw invalidOutput();
  if (review.status !== "review-required") throw invalidOutput();
}

export function parseModelGatewayResult(value: unknown): ModelGatewayResult {
  if (serialisedLength(value, invalidOutput) > modelGatewayLimits.maximumResultCharacters) {
    throw invalidOutput();
  }
  const result = requireRecord(value, invalidOutput);
  exactKeys(result, ["manifest", "output", "requestId", "schemaVersion"], invalidOutput);
  if (result.schemaVersion !== modelGatewayResultSchemaVersion) throw invalidOutput();
  uuidValue(result.requestId, invalidOutput);

  const manifest = requireRecord(result.manifest, invalidOutput);
  exactKeys(
    manifest,
    ["adapter", "externalNetworkUsed", "promptRegistryVersion", "toolRegistryVersion"],
    invalidOutput,
  );
  if (
    manifest.adapter !== deterministicLocalAdapterId ||
    manifest.externalNetworkUsed !== false ||
    manifest.promptRegistryVersion !== promptRegistryVersion ||
    manifest.toolRegistryVersion !== toolRegistryVersion
  ) {
    throw invalidOutput();
  }

  const output = requireRecord(result.output, invalidOutput);
  exactKeys(
    output,
    ["clarifyingQuestions", "operations", "professionalReview", "summary"],
    invalidOutput,
  );
  const operations = requireArray(
    output.operations,
    modelGatewayLimits.maximumOperations,
    invalidOutput,
  );
  const entryIds = operations.map(parseOperation);
  if (new Set(entryIds).size !== entryIds.length) throw invalidOutput();
  const clarifications = requireArray(
    output.clarifyingQuestions,
    modelGatewayLimits.maximumClarifications,
    invalidOutput,
  );
  clarifications.forEach((item) => {
    stringValue(item, 1, modelGatewayLimits.maximumStatementCharacters, invalidOutput);
  });
  const reviews = requireArray(
    output.professionalReview,
    modelGatewayLimits.maximumProfessionalReviewItems,
    invalidOutput,
  );
  reviews.forEach(parseReview);
  stringValue(output.summary, 1, modelGatewayLimits.maximumSummaryCharacters, invalidOutput);
  if (operations.length === 0 && clarifications.length === 0 && reviews.length === 0) {
    throw invalidOutput();
  }
  return value as ModelGatewayResult;
}
