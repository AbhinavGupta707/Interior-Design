import { ApiError } from "../../errors.js";

export function fusionConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Model Fusion Conflict" });
}

export function fusionInvalid(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 422, title: "Invalid Fusion Proposal" });
}
