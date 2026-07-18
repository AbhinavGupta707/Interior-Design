import {
  DeterministicLocalAdapter,
  ExternalDisabledAdapter,
  type ModelAdapter,
} from "./adapters.js";
import { ModelGatewayError } from "./errors.js";
import { modelCapabilityManifests } from "./registries.js";
import {
  deterministicLocalAdapterId,
  externalDisabledAdapterId,
  type ModelAdapterId,
  type ModelCapabilityManifest,
  type ModelGatewayInvocationOptions,
  type ModelGatewayResult,
} from "./types.js";
import { parseModelGatewayRequest, parseModelGatewayResult } from "./validation.js";

function safeAdapterError(error: unknown): ModelGatewayError {
  return error instanceof ModelGatewayError
    ? error
    : new ModelGatewayError("MODEL_INTERNAL_ERROR", true);
}

export class BoundedModelGateway {
  readonly #adapters: Readonly<Record<ModelAdapterId, ModelAdapter>>;

  constructor(options: { readonly localExecutionDelayMs?: number } = {}) {
    this.#adapters = Object.freeze({
      [deterministicLocalAdapterId]: new DeterministicLocalAdapter({
        ...(options.localExecutionDelayMs === undefined
          ? {}
          : { executionDelayMs: options.localExecutionDelayMs }),
      }),
      [externalDisabledAdapterId]: new ExternalDisabledAdapter(),
    });
  }

  capability(adapterId: ModelAdapterId): ModelCapabilityManifest {
    return modelCapabilityManifests[adapterId];
  }

  capabilities(): readonly ModelCapabilityManifest[] {
    return [
      modelCapabilityManifests[deterministicLocalAdapterId],
      modelCapabilityManifests[externalDisabledAdapterId],
    ];
  }

  async invoke(
    value: unknown,
    options: ModelGatewayInvocationOptions = {},
  ): Promise<ModelGatewayResult> {
    const request = parseModelGatewayRequest(value);
    const adapter = this.#adapters[request.adapterId];
    const controller = new AbortController();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onCallerAbort);
        callback();
      };
      const onCallerAbort = () => {
        controller.abort();
        finish(() => {
          reject(new ModelGatewayError("MODEL_CANCELLED"));
        });
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish(() => {
          reject(new ModelGatewayError("MODEL_TIMEOUT", true));
        });
      }, request.limits.timeoutMs);

      if (options.signal?.aborted === true) {
        onCallerAbort();
        return;
      }
      options.signal?.addEventListener("abort", onCallerAbort, { once: true });
      void adapter.execute(request, controller.signal).then(
        (candidate) => {
          try {
            const result = parseModelGatewayResult(candidate);
            if (result.requestId !== request.requestId) {
              throw new ModelGatewayError("MODEL_INVALID_OUTPUT");
            }
            finish(() => {
              resolve(result);
            });
          } catch (error) {
            finish(() => {
              reject(safeAdapterError(error));
            });
          }
        },
        (error: unknown) => {
          finish(() => {
            reject(safeAdapterError(error));
          });
        },
      );
    });
  }
}
