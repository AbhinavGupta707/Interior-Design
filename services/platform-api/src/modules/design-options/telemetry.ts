import { metrics } from "@opentelemetry/api";

import type { DesignOptionTelemetry } from "./types.js";

const meter = metrics.getMeter("@interior-design/platform-api", "c12-design-options-v1");
const transitions = meter.createCounter("interior_design.design_options.transitions", {
  description:
    "Privacy-minimised C12 state transitions without brief, asset, operation, or lease payloads.",
  unit: "{transition}",
});

const privateLogKeys = new Set([
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

export function safeDesignOptionLogFields(
  fields: Readonly<Record<string, boolean | number | string | undefined>>,
): Readonly<Record<string, boolean | number | string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(fields).filter(
        (entry): entry is [string, boolean | number | string] =>
          !privateLogKeys.has(entry[0].replaceAll(/[-_]/gu, "").toLowerCase()) &&
          entry[1] !== undefined,
      ),
    ),
  );
}

export const designOptionTelemetry: DesignOptionTelemetry = {
  record(event) {
    transitions.add(event.count ?? 1, { outcome: event.outcome, stage: event.stage });
  },
};
