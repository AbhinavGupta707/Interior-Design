import { ApiError } from "../../errors.js";

export function captureConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Capture Conflict" });
}

export function captureUnprocessable(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 422, title: "Capture Package Invalid" });
}

export function captureStorageUnavailable(): ApiError {
  return new ApiError({
    code: "CAPTURE_STORAGE_UNAVAILABLE",
    detail: "Capture storage is temporarily unavailable.",
    statusCode: 503,
    title: "Capture Storage Unavailable",
  });
}
