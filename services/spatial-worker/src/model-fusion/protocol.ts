import {
  c9FusionPolicy,
  fusionRegistrationResultSchema,
  type FusionRegistrationResult,
} from "@interior-design/contracts";

import type {
  FusionRegistrationProducerPort,
  FusionSemanticOutput,
  FusionSemanticProducerPort,
  FusionSourcePayload,
} from "./types.js";
import { FusionWorkerError } from "./types.js";

export const c9ProducerLimits = Object.freeze({
  maximumDiscrepancies: c9FusionPolicy.maximumDiscrepancies,
  maximumOutputBytes: 16 * 1_024 * 1_024,
  maximumSources: c9FusionPolicy.maximumSources,
  timeoutMilliseconds: c9FusionPolicy.workerTimeoutMilliseconds,
} as const);

function boundedOutput<T>(value: T): T {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > c9ProducerLimits.maximumOutputBytes) {
    throw new FusionWorkerError("FUSION_PRODUCER_OUTPUT_LIMIT");
  }
  return value;
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  outerSignal?: AbortSignal,
): Promise<T> {
  const deadline = new AbortController();
  const signal =
    outerSignal === undefined ? deadline.signal : AbortSignal.any([outerSignal, deadline.signal]);
  const timer = setTimeout(() => {
    deadline.abort(new FusionWorkerError("FUSION_PRODUCER_TIMEOUT", { retryable: true }));
  }, c9ProducerLimits.timeoutMilliseconds);
  timer.unref();
  try {
    return await operation(signal);
  } catch (error) {
    if (outerSignal?.aborted === true) throw new FusionWorkerError("FUSION_CANCELLED");
    if (deadline.signal.aborted) {
      throw new FusionWorkerError("FUSION_PRODUCER_TIMEOUT", { cause: error, retryable: true });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class BoundedFusionProducerProtocol {
  readonly #registration: FusionRegistrationProducerPort;
  readonly #semantic: FusionSemanticProducerPort;

  constructor(options: {
    readonly registration: FusionRegistrationProducerPort;
    readonly semantic: FusionSemanticProducerPort;
  }) {
    this.#registration = options.registration;
    this.#semantic = options.semantic;
  }

  async register(
    sources: readonly FusionSourcePayload[],
    anchorGroups: Parameters<FusionRegistrationProducerPort["register"]>[0]["anchorGroups"],
    signal?: AbortSignal,
  ): Promise<readonly FusionRegistrationResult[]> {
    const output = await withDeadline(
      (boundedSignal) =>
        this.#registration.register(
          { anchorGroups, limits: c9ProducerLimits, sources },
          boundedSignal,
        ),
      signal,
    );
    const registrations = boundedOutput(output).map((entry) =>
      fusionRegistrationResultSchema.parse(entry),
    );
    const expected = sources.map(({ descriptor }) => descriptor.id).sort();
    const actual = registrations.map(({ sourceId }) => sourceId).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new FusionWorkerError("FUSION_REGISTRATION_SCOPE_MISMATCH");
    }
    return registrations;
  }

  async fit(
    input: Omit<Parameters<FusionSemanticProducerPort["fit"]>[0], "limits">,
    signal?: AbortSignal,
  ): Promise<FusionSemanticOutput> {
    const output = await withDeadline(
      (boundedSignal) => this.#semantic.fit({ ...input, limits: c9ProducerLimits }, boundedSignal),
      signal,
    );
    return boundedOutput(output);
  }
}

export class UnavailableRegistrationProducer implements FusionRegistrationProducerPort {
  register(
    input: Parameters<FusionRegistrationProducerPort["register"]>[0],
  ): Promise<readonly FusionRegistrationResult[]> {
    return Promise.resolve(
      input.sources.map(({ descriptor }) =>
        fusionRegistrationResultSchema.parse({
          findings: [
            {
              code: "FUSION_REGISTRATION_PRODUCER_UNAVAILABLE",
              detail: "No registration producer is composed in this provider-free runtime.",
              severity: "error",
            },
          ],
          schemaVersion: "c9-registration-result-v1",
          sourceId: descriptor.id,
          status: "unregistered",
        }),
      ),
    );
  }
}

export class UnavailableSemanticProducer implements FusionSemanticProducerPort {
  fit(input: Parameters<FusionSemanticProducerPort["fit"]>[0]): Promise<FusionSemanticOutput> {
    return Promise.resolve({
      coverage: {
        inputSourceCount: input.sources.length,
        levelsCovered: 0,
        registeredSourceCount: 0,
        unknownRegionCount: 1,
      },
      discrepancies: [],
      findings: [
        {
          code: "FUSION_SEMANTIC_PRODUCER_UNAVAILABLE",
          detail:
            "No semantic fitting producer is composed; the workflow abstained without geometry.",
          severity: "error",
        },
      ],
      safeCode: "FUSION_PRODUCER_UNAVAILABLE",
      status: "abstained",
    });
  }
}
