import { ModelGatewayError } from "./errors.js";
import { extractDeterministicConsultation } from "./deterministic-extractor.js";
import type { ModelGatewayRequest, ModelGatewayResult } from "./types.js";

export interface ModelAdapter {
  execute(request: ModelGatewayRequest, signal: AbortSignal): Promise<unknown>;
}

function waitForDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ModelGatewayError("MODEL_CANCELLED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class DeterministicLocalAdapter implements ModelAdapter {
  readonly #executionDelayMs: number;

  constructor(options: { readonly executionDelayMs?: number } = {}) {
    this.#executionDelayMs = Math.max(0, Math.min(options.executionDelayMs ?? 0, 30_000));
  }

  async execute(request: ModelGatewayRequest, signal: AbortSignal): Promise<ModelGatewayResult> {
    if (signal.aborted) throw new ModelGatewayError("MODEL_CANCELLED");
    await waitForDelay(this.#executionDelayMs, signal);
    return extractDeterministicConsultation(request);
  }
}

export class ExternalDisabledAdapter implements ModelAdapter {
  execute(): Promise<never> {
    return Promise.reject(new ModelGatewayError("MODEL_ADAPTER_DISABLED"));
  }
}
