const forbiddenKeys = new Set([
  "accessibility",
  "asset",
  "assets",
  "brief",
  "credential",
  "household",
  "leasetoken",
  "narrative",
  "operation",
  "operations",
  "payload",
  "prompt",
  "statement",
  "token",
]);

/** Fail closed before a C12 event reaches a structured logger or metrics backend. */
export function safeDesignOptionTelemetryFields(
  fields: Readonly<Record<string, string | number | boolean | undefined>>,
): Readonly<Record<string, string | number | boolean>> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (forbiddenKeys.has(key.replaceAll(/[-_]/gu, "").toLowerCase()) || value === undefined)
      continue;
    safe[key] = value;
  }
  return Object.freeze(safe);
}
