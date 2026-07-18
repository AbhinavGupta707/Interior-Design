import { createHash } from "node:crypto";

import { promptRegistryVersion, toolRegistryVersion } from "./registries.js";
import {
  deterministicLocalAdapterId,
  modelGatewayResultSchemaVersion,
  type GatewayBriefContextEntry,
  type GatewayBriefEntryCategory,
  type GatewayEntryAddOperation,
  type GatewayProfessionalReview,
  type GatewayProposedClassification,
  type ModelGatewayRequest,
  type ModelGatewayResult,
  type ProfessionalReviewReason,
} from "./types.js";

const suspiciousInstructionPattern =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior)?\s*(?:system|developer|prompt|policy|tool)\s*(?:message|instructions?|prompt|policy)?|(?:system|developer)\s+(?:prompt|message|instructions?)|tool\s*(?:call|policy)|call\s+(?:https?|fetch|curl)|read\s+(?:the\s+)?(?:system\s+)?file|write\s+(?:to\s+)?(?:sql|database)|object\s+storage|exfiltrat)/iu;

const reviewPatterns: readonly {
  readonly pattern: RegExp;
  readonly question: string;
  readonly reason: ProfessionalReviewReason;
}[] = [
  {
    pattern:
      /(?:load[- ]?bearing|structural|foundation|supporting wall|remove (?:a |the )?wall|beam size)/iu,
    question:
      "The structural implications require review by an appropriately qualified professional.",
    reason: "structural",
  },
  {
    pattern:
      /(?:planning permission|building regulations?|building control|fire regulations?|code compliant|lawful development)/iu,
    question: "The regulatory question requires jurisdiction-specific professional review.",
    reason: "regulatory",
  },
  {
    pattern:
      /(?:clinical(?:ly)?|medical(?:ly)?|occupational therapist|safe for (?:a |my )?(?:disab|condition)|parkinson|dementia|wheelchair.*(?:compliant|safe))/iu,
    question: "The clinical accessibility requirement needs an accountable specialist review.",
    reason: "accessibility-clinical",
  },
  {
    pattern:
      /(?:exact (?:price|cost)|fixed (?:price|cost)|guaranteed (?:price|cost|budget)|how much (?:will|would|does).*(?:cost|price)|cost exactly)/iu,
    question: "A fixed or exact cost needs verified scope and accountable cost review.",
    reason: "cost-certainty",
  },
  {
    pattern:
      /(?:in stock|available (?:now|today)|live availability|current stock|delivery date|supplier inventory)/iu,
    question: "Live product availability must be checked against a current supplier source.",
    reason: "product-availability",
  },
  {
    pattern:
      /(?:(?:architect|engineer|designer).*(?:approve|sign(?:\s+\w+){0,3}\s+off|certify)|professionally approved|professional judgement)/iu,
    question: "The requested professional judgement requires an accountable human reviewer.",
    reason: "professional-judgement",
  },
  {
    pattern: /(?:hidden (?:damp|defect|services)|asbestos|what is behind (?:the |this )?wall)/iu,
    question: "The hidden condition cannot be established from the available evidence.",
    reason: "insufficient-evidence",
  },
];

const stopWords = new Set([
  "about",
  "actually",
  "after",
  "again",
  "also",
  "before",
  "could",
  "from",
  "have",
  "instead",
  "like",
  "longer",
  "must",
  "need",
  "should",
  "that",
  "their",
  "there",
  "these",
  "this",
  "want",
  "with",
  "would",
]);

const entryIdNamespace = "interior-design:c11:brief-entry:rfc9562-v8:sha256:v1";

function updateNameFrame(hash: ReturnType<typeof createHash>, value: string): void {
  const encoded = new TextEncoder().encode(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, encoded.byteLength, false);
  hash.update(length);
  hash.update(encoded);
}

/**
 * RFC 9562 UUIDv8 derived from the first 128 SHA-256 bits over five ordered,
 * u32-be-length-prefixed UTF-8 frames: the fixed namespace, source message ID,
 * classification, category, and exact bounded statement.
 */
function deterministicEntryUuid(input: {
  readonly category: GatewayBriefEntryCategory;
  readonly classification: GatewayProposedClassification;
  readonly sourceMessageId: string;
  readonly statement: string;
}): string {
  const hash = createHash("sha256");
  for (const frame of [
    entryIdNamespace,
    input.sourceMessageId,
    input.classification,
    input.category,
    input.statement,
  ]) {
    updateNameFrame(hash, frame);
  }
  const bytes = new Uint8Array(hash.digest().subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Deterministic UUID allocation failed.");
  }
  bytes[6] = (versionByte & 0x0f) | 0x80;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function reviewRoutes(message: string): readonly GatewayProfessionalReview[] {
  const routes: GatewayProfessionalReview[] = [];
  for (const route of reviewPatterns) {
    if (route.pattern.test(message)) {
      routes.push({ question: route.question, reason: route.reason, status: "review-required" });
    }
  }
  return routes;
}

function categoryFor(message: string): GatewayBriefEntryCategory {
  if (/(?:wheelchair|step[- ]?free|mobility|accessible|accessibility)/iu.test(message)) {
    return "accessibility";
  }
  if (/(?:keep|retain|existing (?:table|chair|sofa|bed|cabinet|furniture))/iu.test(message)) {
    return "retained-item";
  }
  if (/(?:storage|cupboard|wardrobe|shelv)/iu.test(message)) return "storage";
  if (/(?:desk|work from home|study|office)/iu.test(message)) return "work-study";
  if (/(?:cook|kitchen|dining|breakfast)/iu.test(message)) return "cooking-dining";
  if (/(?:guest|entertain|hosting)/iu.test(message)) return "entertaining";
  if (/(?:quiet|noise|acoustic|soundproof)/iu.test(message)) return "acoustics";
  if (/(?:privacy|private)/iu.test(message)) return "privacy";
  if (/(?:daylight|sunlight|view|window)/iu.test(message)) return "daylight-view";
  if (/(?:garden|outside|outdoor|patio)/iu.test(message)) return "garden-outdoor";
  if (/(?:material|oak|timber|stone|tile|colour|color|paint|fabric)/iu.test(message)) {
    return "material-colour";
  }
  if (/(?:style|aesthetic|modern|traditional|minimal|industrial)/iu.test(message)) {
    return "style-aesthetic";
  }
  if (/(?:budget|spend|affordable|premium)/iu.test(message)) return "budget-category";
  if (/(?:sustainable|recycled|low carbon|energy)/iu.test(message)) return "sustainability";
  if (/(?:adjacent|next to|near the)/iu.test(message)) return "adjacency";
  if (/(?:minimum|at least|millimet|centimet|metre|meter)/iu.test(message)) {
    return "minimum-dimension";
  }
  return "other";
}

function significantTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .match(/[a-z]{4,}/gu)
      ?.filter((token) => !stopWords.has(token)) ?? [],
  );
}

function conflictingEntry(
  message: string,
  entries: readonly GatewayBriefContextEntry[],
): GatewayBriefContextEntry | undefined {
  if (
    !/(?:actually|instead|no longer|changed my mind|do not|don't|dislike|ignore (?:the )?(?:previous|prior))/iu.test(
      message,
    )
  ) {
    return undefined;
  }
  const messageTokens = significantTokens(message);
  return entries.find((entry) => {
    if (entry.status !== "active") return false;
    const overlap = [...significantTokens(entry.statement)].filter((token) =>
      messageTokens.has(token),
    );
    return overlap.length > 0;
  });
}

function boundedPreference(message: string): string | undefined {
  const match =
    /(?:\bI|\bwe)\s+(?:really\s+)?(?:prefer|like|love|want)\s+(.{1,440}?)(?:[.!?\n]|$)/iu.exec(
      message,
    );
  const captured = match?.[1]?.trim();
  return captured === undefined || captured.length === 0
    ? undefined
    : `Household preference: ${captured}`.slice(0, 500);
}

function boundedAssertion(message: string): string | undefined {
  const match =
    /(?:\bI|\bwe|\bthe household)\s+(?:need|use|have)\s+(.{1,430}?)(?:[.!?\n]|$)/iu.exec(message);
  const captured = match?.[1]?.trim();
  return captured === undefined || captured.length === 0
    ? undefined
    : `Household requirement: ${captured}`.slice(0, 500);
}

function proposedEntry(input: {
  readonly category: GatewayBriefEntryCategory;
  readonly classification: GatewayProposedClassification;
  readonly generatedAt: string;
  readonly priority: number;
  readonly sourceMessageId: string;
  readonly statement: string;
}): GatewayEntryAddOperation {
  return {
    entry: {
      category: input.category,
      classification: input.classification,
      id: deterministicEntryUuid(input),
      priority: input.priority,
      provenance: {
        capturedAt: input.generatedAt,
        method: "assistant-extracted",
        sourceMessageId: input.sourceMessageId,
      },
      roomOrLevelElementIds: [],
      statement: input.statement,
      status: "active",
    },
    kind: "entry.add",
  };
}

function outputFor(request: ModelGatewayRequest): ModelGatewayResult["output"] {
  const message = request.input.sourceMessage.text.trim();
  if (suspiciousInstructionPattern.test(message)) {
    return {
      clarifyingQuestions: [
        "Please restate the household need, constraint or preference without system or tool instructions.",
      ],
      operations: [],
      professionalReview: [],
      summary:
        "The untrusted instruction-like content was treated as data and no patch was proposed.",
    };
  }

  const professionalReview = reviewRoutes(message);
  if (professionalReview.length > 0) {
    return {
      clarifyingQuestions: [],
      operations: [],
      professionalReview,
      summary: `${String(professionalReview.length)} question(s) require accountable professional review.`,
    };
  }

  if (/(?:wheelchair|step[- ]?free|mobility access)/iu.test(message)) {
    return {
      clarifyingQuestions: [],
      operations: [
        proposedEntry({
          category: "accessibility",
          classification: "hard-constraint",
          generatedAt: request.input.generatedAt,
          priority: 5,
          sourceMessageId: request.input.sourceMessage.id,
          statement:
            "Step-free circulation and sufficient manoeuvring space are required for the household.",
        }),
      ],
      professionalReview: [],
      summary: "One minimised accessibility constraint was extracted for explicit confirmation.",
    };
  }

  const conflict = conflictingEntry(message, request.input.currentBriefEntries);
  if (conflict !== undefined) {
    return {
      clarifyingQuestions: [
        "Should the earlier brief entry be withdrawn, or should both positions remain for discussion?",
      ],
      operations: [
        proposedEntry({
          category: conflict.category,
          classification: "unresolved-conflict",
          generatedAt: request.input.generatedAt,
          priority: 4,
          sourceMessageId: request.input.sourceMessage.id,
          statement: `The latest statement conflicts with active brief entry ${conflict.id}.`,
        }),
      ],
      professionalReview: [],
      summary: "A possible conflict with the current brief was preserved for household resolution.",
    };
  }

  if (/(?:not sure|do not know|don't know|undecided|unknown)/iu.test(message)) {
    return {
      clarifyingQuestions: ["What information would help the household make this decision?"],
      operations: [
        proposedEntry({
          category: categoryFor(message),
          classification: "unknown",
          generatedAt: request.input.generatedAt,
          priority: 2,
          sourceMessageId: request.input.sourceMessage.id,
          statement: "The household has not yet resolved this part of the brief.",
        }),
      ],
      professionalReview: [],
      summary: "An explicit unknown was retained instead of inventing a preference.",
    };
  }

  const category = categoryFor(message);
  const hardConstraint =
    /(?:\bmust\b|\brequired\b|non-negotiable|\bessential\b|\bkeep\b|\bretain\b)/iu.test(message);
  const statement = hardConstraint
    ? `Household constraint: ${message}`.slice(0, 500)
    : boundedPreference(message);
  if (statement !== undefined) {
    return {
      clarifyingQuestions: [],
      operations: [
        proposedEntry({
          category,
          classification: hardConstraint ? "hard-constraint" : "preference",
          generatedAt: request.input.generatedAt,
          priority: hardConstraint ? 5 : 3,
          sourceMessageId: request.input.sourceMessage.id,
          statement,
        }),
      ],
      professionalReview: [],
      summary: `One ${hardConstraint ? "constraint" : "preference"} was extracted for explicit confirmation.`,
    };
  }

  const assertion = boundedAssertion(message);
  if (assertion !== undefined) {
    return {
      clarifyingQuestions: [],
      operations: [
        proposedEntry({
          category,
          classification: "household-assertion",
          generatedAt: request.input.generatedAt,
          priority: 3,
          sourceMessageId: request.input.sourceMessage.id,
          statement: assertion,
        }),
      ],
      professionalReview: [],
      summary: "One household assertion was extracted for explicit confirmation.",
    };
  }

  return {
    clarifyingQuestions: [
      "Is this a household need, a non-negotiable constraint, a preference or an unresolved question?",
    ],
    operations: [],
    professionalReview: [],
    summary: "The statement was ambiguous, so no brief change was inferred.",
  };
}

export function extractDeterministicConsultation(request: ModelGatewayRequest): ModelGatewayResult {
  return {
    manifest: {
      adapter: deterministicLocalAdapterId,
      externalNetworkUsed: false,
      promptRegistryVersion,
      toolRegistryVersion,
    },
    output: outputFor(request),
    requestId: request.requestId,
    schemaVersion: modelGatewayResultSchemaVersion,
  };
}
