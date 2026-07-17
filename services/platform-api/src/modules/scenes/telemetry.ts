import { metrics } from "@opentelemetry/api";

import type { SceneTelemetry } from "./types.js";

const meter = metrics.getMeter("@interior-design/platform-api", "c10-scene-job-v1");
const transitions = meter.createCounter("interior_design.scene.transitions", {
  description: "Safe C10 lifecycle transitions without snapshots, GLB bytes, locators, or URLs.",
  unit: "{transition}",
});

export const sceneTelemetry: SceneTelemetry = {
  record(event) {
    transitions.add(1, { outcome: event.outcome, stage: event.stage });
  },
};
