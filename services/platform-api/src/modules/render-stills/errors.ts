import { ApiError } from "../../errors.js";

export function renderConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Render Conflict" });
}

export function renderInvalid(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 422, title: "Invalid Render Request" });
}

export function renderUnavailable(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 503, title: "Render Service Unavailable" });
}
