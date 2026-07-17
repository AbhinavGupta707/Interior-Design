import {
  IsolatedPlanParserAdapter,
  PlanParserAdapterError,
  type PlanParserProcessConfiguration,
} from "@interior-design/provider-adapters/plan-parser";
import { readFile, lstat } from "node:fs/promises";

import type { PlanParserInput, PlanParserPort } from "./types.js";
import { PlanNormalizationError } from "./types.js";

const maximumNormalizedInputBytes = 32 * 1_024 * 1_024;

function mappedError(error: unknown): PlanNormalizationError {
  if (!(error instanceof PlanParserAdapterError)) {
    return new PlanNormalizationError("parser-unavailable", true, { cause: error });
  }
  switch (error.code) {
    case "PARSER_ABORTED":
    case "PARSER_TIMEOUT":
      return new PlanNormalizationError("parser-timeout", true, { cause: error });
    case "PARSER_EXITED":
    case "PARSER_UNAVAILABLE":
      return new PlanNormalizationError("parser-unavailable", true, { cause: error });
    case "NORMALIZED_INPUT_HASH_MISMATCH":
    case "PARSER_SOURCE_MISMATCH":
      return new PlanNormalizationError("source-mismatch", false, { cause: error });
    case "INVALID_NORMALIZED_INPUT":
    case "PARSER_OUTPUT_TOO_LARGE":
    case "PARSER_STDERR_TOO_LARGE":
      return new PlanNormalizationError("resource-limit", false, { cause: error });
    case "INVALID_REQUEST":
    case "PARSER_OUTPUT_INVALID":
    case "PARSER_OUTPUT_MALFORMED":
      return new PlanNormalizationError("invalid-parser-output", false, { cause: error });
  }
}

/**
 * Production PlanParserPort backed by the shell-free, bounded Python subprocess adapter.
 * The normalized artifact is an internal JSON file and is never included in workflow records.
 */
export class IsolatedPlanParserPort implements PlanParserPort {
  readonly #adapter: IsolatedPlanParserAdapter;

  constructor(configuration: PlanParserProcessConfiguration) {
    this.#adapter = new IsolatedPlanParserAdapter(configuration);
  }

  async parse(input: PlanParserInput, signal?: AbortSignal) {
    try {
      const metadata = await lstat(input.filePath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size < 2 ||
        metadata.size > maximumNormalizedInputBytes
      ) {
        throw new PlanNormalizationError("resource-limit");
      }
      const bytes = await readFile(input.filePath);
      if (bytes.byteLength !== metadata.size) throw new PlanNormalizationError("source-mismatch");
      let normalizedInput: unknown;
      try {
        normalizedInput = JSON.parse(bytes.toString("utf8")) as unknown;
      } catch (error) {
        throw new PlanNormalizationError("invalid-parser-output", false, { cause: error });
      }
      return await this.#adapter.parse(input.request, normalizedInput, {
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (error instanceof PlanNormalizationError) throw error;
      throw mappedError(error);
    }
  }
}
