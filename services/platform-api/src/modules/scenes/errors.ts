import { ApiError } from "../../errors.js";

export function sceneConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Scene Conflict" });
}

export function sceneInvalid(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 422, title: "Invalid Scene" });
}

export function sceneUnavailable(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 503, title: "Scene Service Unavailable" });
}
