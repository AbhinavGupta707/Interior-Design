import { ApiError } from "../../errors.js";

export function planConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Plan Processing Conflict" });
}

export function invalidPlanDraft(detail: string): ApiError {
  return new ApiError({
    code: "PLAN_OPERATION_DRAFT_INVALID",
    detail,
    statusCode: 422,
    title: "Plan Operation Draft Invalid",
  });
}
