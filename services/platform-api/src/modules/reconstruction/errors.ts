import { ApiError } from "../../errors.js";

export function reconstructionConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Reconstruction Conflict" });
}

export function reconstructionUnavailable(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 503, title: "Reconstruction Unavailable" });
}
