import { metrics } from "@opentelemetry/api";

import type { ReconstructionTelemetry } from "./types.js";

const meter = metrics.getMeter("@interior-design/platform-api", "c8-reconstruction-job-v1");
const transitions = meter.createCounter("interior_design.reconstruction.transitions", {
  description: "Safe C8 lifecycle transitions without media, locators, hashes, or user content.",
  unit: "{transition}",
});

export const reconstructionTelemetry: ReconstructionTelemetry = {
  record(event) {
    transitions.add(1, { outcome: event.outcome, stage: event.stage });
  },
};
