export interface ViewerMetricsSnapshot {
  readonly firstFrameAt?: number;
  readonly frameCount: number;
  readonly frameTimestamps: readonly number[];
  readonly maximumRendererCalls: number;
  readonly readyAt?: number;
}

export interface ViewerMetricsApi {
  readonly resetInteractionSample: () => void;
  readonly snapshot: () => ViewerMetricsSnapshot;
}

export interface ViewerMetricsRecorder {
  readonly api: ViewerMetricsApi;
  readonly markReady: (at: number) => void;
  readonly recordFrame: (at: number, rendererCalls: number) => void;
}

declare global {
  interface Window {
    __C10_VIEWER_METRICS__?: ViewerMetricsApi;
  }
}

export function createViewerMetricsRecorder(): ViewerMetricsRecorder {
  let firstFrameAt: number | undefined;
  let frameCount = 0;
  let frameTimestamps: number[] = [];
  let maximumRendererCalls = 0;
  let readyAt: number | undefined;

  const snapshot = (): ViewerMetricsSnapshot =>
    Object.freeze({
      ...(firstFrameAt === undefined ? {} : { firstFrameAt }),
      frameCount,
      frameTimestamps: Object.freeze([...frameTimestamps]),
      maximumRendererCalls,
      ...(readyAt === undefined ? {} : { readyAt }),
    });

  const api: ViewerMetricsApi = Object.freeze({
    resetInteractionSample() {
      firstFrameAt = undefined;
      frameCount = 0;
      frameTimestamps = [];
      maximumRendererCalls = 0;
    },
    snapshot,
  });

  return Object.freeze({
    api,
    markReady(at: number) {
      readyAt ??= at;
    },
    recordFrame(at: number, rendererCalls: number) {
      firstFrameAt ??= at;
      frameCount += 1;
      maximumRendererCalls = Math.max(maximumRendererCalls, rendererCalls);
      frameTimestamps.push(at);
      if (frameTimestamps.length > 360) frameTimestamps = frameTimestamps.slice(-360);
    },
  });
}
