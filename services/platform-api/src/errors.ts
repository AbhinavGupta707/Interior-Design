import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getRequestCorrelation } from "./correlation.js";

export interface ProblemDetails {
  readonly code: string;
  readonly detail: string;
  readonly instance: string;
  readonly requestId: string;
  readonly status: number;
  readonly title: string;
  readonly traceId: string;
  readonly type: string;
}

export interface ApiErrorOptions {
  readonly code: string;
  readonly detail: string;
  readonly statusCode: number;
  readonly title: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly detail: string;
  readonly statusCode: number;
  readonly title: string;

  constructor(options: ApiErrorOptions, errorOptions?: ErrorOptions) {
    super(options.detail, errorOptions);
    this.name = "ApiError";
    this.code = options.code;
    this.detail = options.detail;
    this.statusCode = options.statusCode;
    this.title = options.title;
  }
}

interface NormalizedProblem {
  readonly code: string;
  readonly detail: string;
  readonly status: number;
  readonly title: string;
}

const BAD_REQUEST_PROBLEM: NormalizedProblem = {
  code: "BAD_REQUEST",
  detail: "The request could not be processed.",
  status: 400,
  title: "Bad Request",
};

const NOT_FOUND_PROBLEM: NormalizedProblem = {
  code: "NOT_FOUND",
  detail: "The requested resource was not found.",
  status: 404,
  title: "Not Found",
};

const INTERNAL_PROBLEM: NormalizedProblem = {
  code: "INTERNAL_ERROR",
  detail: "An unexpected error occurred.",
  status: 500,
  title: "Internal Server Error",
};

const GENERIC_PROBLEMS: Readonly<Record<number, NormalizedProblem>> = {
  400: BAD_REQUEST_PROBLEM,
  401: {
    code: "UNAUTHENTICATED",
    detail: "Authentication is required.",
    status: 401,
    title: "Unauthenticated",
  },
  403: {
    code: "FORBIDDEN",
    detail: "The requested operation is not permitted.",
    status: 403,
    title: "Forbidden",
  },
  404: NOT_FOUND_PROBLEM,
  429: {
    code: "RATE_LIMITED",
    detail: "Too many requests were received.",
    status: 429,
    title: "Too Many Requests",
  },
  500: INTERNAL_PROBLEM,
};

function requestPath(request: FastifyRequest): string {
  const path = request.url.split("?", 1)[0];
  return path === undefined || path.length === 0 ? "/" : path;
}

function normalizeProblem(error: unknown): NormalizedProblem {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      detail: error.detail,
      status: error.statusCode,
      title: error.title,
    };
  }

  const statusCode = error instanceof Error && "statusCode" in error ? error.statusCode : undefined;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return GENERIC_PROBLEMS[statusCode] ?? BAD_REQUEST_PROBLEM;
  }

  return INTERNAL_PROBLEM;
}

function problemType(code: string): string {
  return `urn:interior-design:error:${code.toLowerCase().replaceAll("_", "-")}`;
}

function createProblemDetails(request: FastifyRequest, problem: NormalizedProblem): ProblemDetails {
  const correlation = getRequestCorrelation(request);
  return {
    code: problem.code,
    detail: problem.detail,
    instance: requestPath(request),
    requestId: correlation.requestId,
    status: problem.status,
    title: problem.title,
    traceId: correlation.traceId,
    type: problemType(problem.code),
  };
}

function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: NormalizedProblem,
): FastifyReply {
  return reply
    .status(problem.status)
    .type("application/problem+json")
    .send(createProblemDetails(request, problem));
}

export function registerErrorHandling(server: FastifyInstance): void {
  server.setNotFoundHandler((request, reply) => sendProblem(request, reply, NOT_FOUND_PROBLEM));

  server.setErrorHandler((error, request, reply) => {
    const problem = normalizeProblem(error);
    const correlation = getRequestCorrelation(request);
    const logContext = {
      errorCode: problem.code,
      requestId: correlation.requestId,
      statusCode: problem.status,
      traceId: correlation.traceId,
    };

    if (problem.status >= 500) {
      request.log.error(
        {
          ...logContext,
          errorType: error instanceof ApiError ? "ApiError" : "Error",
        },
        "request failed",
      );
    } else {
      request.log.warn(logContext, "request rejected");
    }

    return sendProblem(request, reply, problem);
  });
}
