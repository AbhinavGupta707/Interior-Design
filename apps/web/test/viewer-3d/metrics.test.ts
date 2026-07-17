import { describe, expect, it } from "vitest";

import { createViewerMetricsRecorder } from "../../src/features/viewer-3d/metrics";

describe("C10 frozen performance instrumentation", () => {
  it("exposes immutable snapshots and bounded frame history", () => {
    const recorder = createViewerMetricsRecorder();
    expect(Object.isFrozen(recorder.api)).toBe(true);
    for (let index = 0; index < 400; index += 1) recorder.recordFrame(index * 16.67, index % 7);
    recorder.markReady(7_000);
    const snapshot = recorder.api.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.frameTimestamps)).toBe(true);
    expect(snapshot.frameCount).toBe(400);
    expect(snapshot.frameTimestamps).toHaveLength(360);
    expect(snapshot.maximumRendererCalls).toBe(6);
    recorder.api.resetInteractionSample();
    expect(recorder.api.snapshot()).toMatchObject({ frameCount: 0, maximumRendererCalls: 0 });
  });
});
