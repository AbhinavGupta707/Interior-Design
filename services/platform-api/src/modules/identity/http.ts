import type { ZodType } from "zod";

import { ApiError } from "../../errors.js";

export function invalidRequest(): ApiError {
  return new ApiError({
    code: "INVALID_REQUEST",
    detail: "The request body is invalid.",
    statusCode: 400,
    title: "Invalid Request",
  });
}

export function parseRequest<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidRequest();
  }
  return result.data;
}

export function unauthenticated(): ApiError {
  return new ApiError({
    code: "UNAUTHENTICATED",
    detail: "A valid bearer session is required.",
    statusCode: 401,
    title: "Unauthenticated",
  });
}

export function parseBearerToken(header: string | readonly string[] | undefined): string {
  if (typeof header !== "string") {
    throw unauthenticated();
  }
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (match?.[1] === undefined) {
    throw unauthenticated();
  }
  return match[1];
}

export function forbidden(): ApiError {
  return new ApiError({
    code: "FORBIDDEN",
    detail: "The requested operation is not permitted.",
    statusCode: 403,
    title: "Forbidden",
  });
}

export function notFound(): ApiError {
  return new ApiError({
    code: "NOT_FOUND",
    detail: "The requested resource was not found.",
    statusCode: 404,
    title: "Not Found",
  });
}
