import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  isSpanContextValid,
  trace,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const REQUEST_ID_HEADER = "x-request-id";
export const TRACE_ID_HEADER = "x-trace-id";
export const TRACE_PARENT_HEADER = "traceparent";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TRACE_PARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const tracer = trace.getTracer("@interior-design/platform-api");

export interface RequestCorrelation {
  readonly requestId: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly traceParent: string;
}

interface RequestTelemetryState {
  readonly correlation: RequestCorrelation;
  readonly span: Span;
}

const requestTelemetry = new WeakMap<FastifyRequest, RequestTelemetryState>();

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function randomHexId(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function parseTraceParent(value: string | undefined): SpanContext | undefined {
  if (value === undefined) {
    return undefined;
  }

  const match = TRACE_PARENT_PATTERN.exec(value.trim().toLowerCase());
  if (match === null) {
    return undefined;
  }

  const traceId = match[1];
  const spanId = match[2];
  const flagText = match[3];
  if (traceId === undefined || spanId === undefined || flagText === undefined) {
    return undefined;
  }

  const spanContext: SpanContext = {
    isRemote: true,
    spanId,
    traceFlags: Number.parseInt(flagText, 16) & TraceFlags.SAMPLED,
    traceId,
  };

  return isSpanContextValid(spanContext) ? spanContext : undefined;
}

function formatTraceParent(traceId: string, spanId: string, traceFlags: number): string {
  const flags = (traceFlags & 0xff).toString(16).padStart(2, "0");
  return `00-${traceId}-${spanId}-${flags}`;
}

export function generateRequestId(request: IncomingMessage): string {
  const incomingRequestId = firstHeader(request.headers[REQUEST_ID_HEADER]);
  return incomingRequestId !== undefined && REQUEST_ID_PATTERN.test(incomingRequestId)
    ? incomingRequestId
    : randomUUID();
}

export function getRequestCorrelation(request: FastifyRequest): RequestCorrelation {
  const state = requestTelemetry.get(request);
  if (state !== undefined) {
    return state.correlation;
  }

  const traceId = randomHexId(16);
  const spanId = randomHexId(8);
  return {
    requestId: request.id,
    spanId,
    traceId,
    traceParent: formatTraceParent(traceId, spanId, TraceFlags.NONE),
  };
}

export function registerRequestCorrelation(server: FastifyInstance): void {
  server.addHook("onRequest", (request, reply, done) => {
    const remoteParent = parseTraceParent(firstHeader(request.headers[TRACE_PARENT_HEADER]));
    const parentContext =
      remoteParent === undefined ? ROOT_CONTEXT : trace.setSpanContext(ROOT_CONTEXT, remoteParent);
    const span = tracer.startSpan(
      `${request.method} request`,
      {
        attributes: { "http.request.method": request.method },
        kind: SpanKind.SERVER,
      },
      parentContext,
    );
    const recordedContext = span.spanContext();
    const hasLocalSpan =
      isSpanContextValid(recordedContext) && recordedContext.spanId !== remoteParent?.spanId;
    const traceId = hasLocalSpan
      ? recordedContext.traceId
      : (remoteParent?.traceId ?? randomHexId(16));
    const spanId = hasLocalSpan ? recordedContext.spanId : randomHexId(8);
    const traceFlags = hasLocalSpan
      ? recordedContext.traceFlags
      : (remoteParent?.traceFlags ?? TraceFlags.NONE);
    const correlation: RequestCorrelation = {
      requestId: request.id,
      spanId,
      traceId,
      traceParent: formatTraceParent(traceId, spanId, traceFlags),
    };

    requestTelemetry.set(request, { correlation, span });
    void reply.header(REQUEST_ID_HEADER, correlation.requestId);
    void reply.header(TRACE_ID_HEADER, correlation.traceId);
    void reply.header(TRACE_PARENT_HEADER, correlation.traceParent);
    done();
  });

  server.addHook("onError", (request, _reply, error, done) => {
    const state = requestTelemetry.get(request);
    state?.span.recordException(error);
    done();
  });

  server.addHook("onResponse", (request, reply, done) => {
    const state = requestTelemetry.get(request);
    if (state !== undefined) {
      const route = request.routeOptions.url ?? "unmatched";
      state.span.updateName(`${request.method} ${route}`);
      state.span.setAttribute("http.response.status_code", reply.statusCode);
      if (reply.statusCode >= 500) {
        state.span.setStatus({ code: SpanStatusCode.ERROR });
      }
      state.span.end();
    }
    done();
  });
}
