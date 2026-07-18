import { metrics } from "@opentelemetry/api";

import type { DesignAgentTelemetry } from "./types.js";

const meter = metrics.getMeter("@interior-design/platform-api", "c11-design-agent-v1");
const transitions = meter.createCounter("interior_design.design_agent.transitions", {
  description:
    "Safe consultation lifecycle counts without messages, prompts, health data or locators.",
  unit: "{transition}",
});
const duration = meter.createHistogram("interior_design.design_agent.duration", {
  description: "Bounded local consultation duration without private content.",
  unit: "ms",
});
const proposedItems = meter.createHistogram("interior_design.design_agent.proposed_items", {
  description: "Counts of typed proposal items without their content.",
  unit: "{item}",
});

export const designAgentTelemetry: DesignAgentTelemetry = {
  record(event) {
    const attributes = {
      adapter: event.adapter,
      outcome: event.outcome,
      safeCode: event.safeCode ?? "none",
      stage: event.stage,
    };
    transitions.add(1, attributes);
    duration.record(event.durationMs, attributes);
    proposedItems.record(
      event.operationCount + event.clarificationCount + event.professionalReviewCount,
      attributes,
    );
  },
};
