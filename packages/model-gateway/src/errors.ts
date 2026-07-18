export type ModelGatewaySafeCode =
  | "MODEL_ADAPTER_DISABLED"
  | "MODEL_CANCELLED"
  | "MODEL_INTERNAL_ERROR"
  | "MODEL_INVALID_OUTPUT"
  | "MODEL_INVALID_REQUEST"
  | "MODEL_RESOURCE_LIMIT"
  | "MODEL_TIMEOUT";

const safeMessages: Readonly<Record<ModelGatewaySafeCode, string>> = Object.freeze({
  MODEL_ADAPTER_DISABLED: "The selected model capability is disabled.",
  MODEL_CANCELLED: "The model request was cancelled.",
  MODEL_INTERNAL_ERROR: "The local model request could not be completed.",
  MODEL_INVALID_OUTPUT: "The model returned an invalid structured result.",
  MODEL_INVALID_REQUEST: "The model request did not match the safe schema.",
  MODEL_RESOURCE_LIMIT: "The model request exceeded a safe resource limit.",
  MODEL_TIMEOUT: "The model request exceeded its time limit.",
});

export class ModelGatewayError extends Error {
  readonly retryable: boolean;
  readonly safeCode: ModelGatewaySafeCode;

  constructor(safeCode: ModelGatewaySafeCode, retryable = false) {
    super(safeMessages[safeCode]);
    this.name = "ModelGatewayError";
    this.safeCode = safeCode;
    this.retryable = retryable;
  }

  toJSON(): { readonly message: string; readonly retryable: boolean; readonly safeCode: string } {
    return { message: this.message, retryable: this.retryable, safeCode: this.safeCode };
  }
}

export function invalidRequest(): ModelGatewayError {
  return new ModelGatewayError("MODEL_INVALID_REQUEST");
}

export function invalidOutput(): ModelGatewayError {
  return new ModelGatewayError("MODEL_INVALID_OUTPUT");
}

export function resourceLimit(): ModelGatewayError {
  return new ModelGatewayError("MODEL_RESOURCE_LIMIT");
}
