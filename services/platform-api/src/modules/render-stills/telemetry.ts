import type { RenderTelemetry } from "./types.js";

export const renderTelemetry: RenderTelemetry = {
  // Central composition may inject an OpenTelemetry implementation. The owned module deliberately
  // emits only bounded outcome/stage enums and never payloads, locators, hashes or lease data.
  record: () => undefined,
};
