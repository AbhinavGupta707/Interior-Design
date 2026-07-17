import { metrics } from "@opentelemetry/api";

import type { FusionTelemetry } from "./types.js";

const meter = metrics.getMeter("@interior-design/platform-api", "c9-fusion-job-v1");
const transitions = meter.createCounter("interior_design.fusion.transitions", {
  description: "Safe C9 lifecycle transitions without source payloads, credentials, or operations.",
  unit: "{transition}",
});

export const fusionTelemetry: FusionTelemetry = {
  record(event) {
    transitions.add(1, { outcome: event.outcome, stage: event.stage });
  },
};
