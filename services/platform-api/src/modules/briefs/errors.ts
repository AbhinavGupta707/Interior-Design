import { ApiError } from "../../errors.js";

export function briefConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Design Brief Conflict" });
}

export function briefInvalid(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 422, title: "Invalid Design Brief" });
}

export function translateBriefDomainFailure(error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  if (code === "BRIEF_ALREADY_ACCEPTED") {
    throw briefConflict(code, "The current brief is already accepted; edit it to reopen a draft.");
  }
  if (code !== undefined && /^BRIEF_[A-Z_]{3,80}$/u.test(code)) {
    throw briefInvalid(code, "The proposed brief revision failed deterministic validation.");
  }
  throw error;
}

export function briefRevisionConflict(currentRevision: number): ApiError {
  return briefConflict(
    "BRIEF_REVISION_CONFLICT",
    `The brief changed and is now revision ${String(currentRevision)}. Reload before retrying.`,
  );
}
