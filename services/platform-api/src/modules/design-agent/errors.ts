import { ApiError } from "../../errors.js";

export function designAgentConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Design Consultation Conflict" });
}

export function designAgentInvalid(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 422, title: "Invalid Design Consultation" });
}

export function designAgentUnavailable(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 503, title: "Design Consultation Unavailable" });
}

export function designAgentInvalidModelOutput(): ApiError {
  return new ApiError({
    code: "DESIGN_AGENT_INVALID_MODEL_OUTPUT",
    detail: "The local model returned an invalid structured result.",
    statusCode: 502,
    title: "Invalid Local Model Result",
  });
}

export function designAgentTimeout(): ApiError {
  return new ApiError({
    code: "DESIGN_AGENT_TIMEOUT",
    detail: "The local consultation request exceeded its time limit.",
    statusCode: 504,
    title: "Design Consultation Timeout",
  });
}

export function designAgentCancelled(): ApiError {
  return new ApiError({
    code: "DESIGN_AGENT_CANCELLED",
    detail: "The local consultation request was cancelled.",
    statusCode: 409,
    title: "Design Consultation Cancelled",
  });
}
