import {
  briefPatchOperationSchema,
  c11BriefPolicy,
  professionalReviewRouteSchema,
} from "@interior-design/contracts";
import { z } from "zod";

import type { ValidatedDesignAgentModelOutput } from "./types.js";

const modelOutputSchema = z
  .object({
    manifest: z
      .object({
        adapter: z.literal("deterministic-local-v1"),
        externalNetworkUsed: z.literal(false),
        promptRegistryVersion: z.literal("c11-brief-consultation-prompts-v1"),
        toolRegistryVersion: z.literal("c11-brief-tools-v1"),
      })
      .strict(),
    output: z
      .object({
        clarifyingQuestions: z
          .array(z.string().trim().min(1).max(500))
          .max(Math.min(c11BriefPolicy.maximumClarifications, 5)),
        operations: z
          .array(briefPatchOperationSchema)
          .max(Math.min(c11BriefPolicy.maximumPatchOperations, 20))
          .refine((operations) => operations.every(({ kind }) => kind === "entry.add"), {
            message: "The C11 model tool may only propose entry additions.",
          }),
        professionalReview: z
          .array(professionalReviewRouteSchema)
          .max(Math.min(c11BriefPolicy.maximumProfessionalReviewItems, 10)),
        summary: z.string().trim().min(1).max(1_000),
      })
      .strict()
      .refine(
        (output) =>
          output.operations.length > 0 ||
          output.clarifyingQuestions.length > 0 ||
          output.professionalReview.length > 0,
        { message: "The model result must patch, clarify or route to review." },
      ),
    requestId: z.uuid(),
    schemaVersion: z.literal("model-gateway-result-v1"),
  })
  .strict();

export function parseDesignAgentModelOutput(value: unknown): ValidatedDesignAgentModelOutput {
  return modelOutputSchema.parse(value);
}
