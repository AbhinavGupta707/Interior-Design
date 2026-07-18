import { metrics } from "@opentelemetry/api";

import type { SpecificationTelemetry } from "./types.js";

const meter = metrics.getMeter("@interior-design/platform-api", "c13-specifications-v1");
const transitions = meter.createCounter("interior_design.specifications.transitions", {
  description: "Privacy-minimised C13 transitions without lines, notes, operations, or locators.",
  unit: "{transition}",
});

const privateKeyFragments = [
  "artifact",
  "attributioncontact",
  "credential",
  "licencetext",
  "locator",
  "manifest",
  "note",
  "operation",
  "path",
  "payload",
  "schedule",
  "signedurl",
  "sourcereceipt",
  "token",
] as const;

export function safeSpecificationLogFields(
  fields: Readonly<Record<string, boolean | number | string | undefined>>,
): Readonly<Record<string, boolean | number | string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(fields).filter(
        (entry): entry is [string, boolean | number | string] =>
          !privateKeyFragments.some((fragment) =>
            entry[0].replaceAll(/[-_]/gu, "").toLowerCase().includes(fragment),
          ) && entry[1] !== undefined,
      ),
    ),
  );
}

export const specificationTelemetry: SpecificationTelemetry = {
  record(event) {
    transitions.add(event.count ?? 1, { outcome: event.outcome, stage: event.stage });
  },
};
