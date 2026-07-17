import { z } from "zod";

type LogLevel = "debug" | "error" | "info" | "warn";
type LogFields = Readonly<Record<string, unknown>>;

const sensitiveField =
  /^(authorization|bearer|credential|fileName|licenceUrl|objectKey|password|secret|signedUrl|sourceKey|storageKey|token|uploadId|url)$/iu;
const sensitiveText =
  /(bearer\s+[A-Za-z0-9._~+/=-]+|https?:\/\/\S+|X-Amz-(?:Algorithm|Credential|Signature)=|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const eventSchema = z.string().regex(/^[a-z][a-z0-9_.-]{1,99}$/u);

function sanitize(value: unknown, fieldName?: string, depth = 0): unknown {
  if (fieldName !== undefined && sensitiveField.test(fieldName)) {
    return "[REDACTED]";
  }
  if (depth > 4) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return sensitiveText.test(value) || value.length > 500 ? "[REDACTED]" : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitize(item, undefined, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry, key, depth + 1)]),
    );
  }
  return typeof value;
}

export interface SafeLogger {
  debug(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
}

export function serializeLog(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: () => Date = () => new Date(),
): string {
  const sanitizedFields = sanitize(fields);
  return JSON.stringify({
    ...(typeof sanitizedFields === "object" && sanitizedFields !== null ? sanitizedFields : {}),
    event: eventSchema.parse(event),
    level,
    service: "spatial-worker",
    timestamp: now().toISOString(),
  });
}

export function createJsonLogger(
  output: Pick<NodeJS.WritableStream, "write"> = process.stdout,
): SafeLogger {
  const write = (level: LogLevel, event: string, fields?: LogFields): void => {
    output.write(`${serializeLog(level, event, fields)}\n`);
  };
  return {
    debug: (event, fields) => {
      write("debug", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
  };
}
