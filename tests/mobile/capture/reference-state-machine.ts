export type CaptureMode = "single-room" | "structure";

export type C7LocalState =
  | "abstained"
  | "cancelled"
  | "capability-checking"
  | "interrupted"
  | "manual-fallback"
  | "offline-upload"
  | "packaging"
  | "paused-upload"
  | "permission-denied"
  | "permission-not-determined"
  | "permission-restricted"
  | "processing"
  | "proposed"
  | "ready"
  | "relocalising"
  | "room-review"
  | "safe-failure"
  | "scanning"
  | "structure-review"
  | "unsupported"
  | "uploading";

export type C7ServerState =
  | "abstained"
  | "cancel-requested"
  | "cancelled"
  | "created"
  | "failed"
  | "processing"
  | "proposed"
  | "uploaded"
  | "uploading";

export interface ReconciledPart {
  readonly checksumSha256: string;
  readonly partNumber: number;
}

export interface CaptureAcceptanceState {
  readonly completedRoomIds: readonly string[];
  readonly liveSensorSession: boolean;
  readonly mode: CaptureMode;
  readonly reconciledParts: readonly ReconciledPart[];
  readonly retryable: boolean;
  readonly safeCode?: string | undefined;
  readonly state: C7LocalState;
  readonly worldSpaceGeneration: number;
}

export type CaptureAcceptanceEvent =
  | {
      readonly permission: "authorised" | "denied" | "not-determined" | "restricted";
      readonly type: "capability-supported";
    }
  | { readonly type: "capability-unsupported" }
  | { readonly type: "permission-authorised" }
  | { readonly type: "permission-denied" }
  | { readonly type: "permission-restricted" }
  | { readonly type: "choose-manual-fallback" }
  | { readonly type: "start-scan" }
  | { readonly type: "interrupt" }
  | { readonly type: "begin-relocalisation" }
  | { readonly type: "relocalisation-succeeded" }
  | { readonly retryable: boolean; readonly type: "relocalisation-failed" }
  | { readonly type: "safe-restart" }
  | { readonly roomId: string; readonly type: "finish-room" }
  | { readonly type: "accept-single-room" }
  | { readonly type: "capture-next-room" }
  | { readonly type: "review-structure" }
  | { readonly type: "accept-structure" }
  | { readonly type: "reject-incompatible-world-space" }
  | { readonly network: "offline" | "online"; readonly type: "package-created" }
  | { readonly type: "network-lost" }
  | { readonly serverParts: readonly ReconciledPart[]; readonly type: "network-restored" }
  | { readonly type: "pause-upload" }
  | {
      readonly network: "offline" | "online";
      readonly serverParts: readonly ReconciledPart[];
      readonly type: "resume-upload";
    }
  | { readonly type: "backgrounded" }
  | { readonly serverParts: readonly ReconciledPart[]; readonly type: "foregrounded" }
  | { readonly type: "upload-completed" }
  | { readonly type: "server-proposed" }
  | { readonly code: string; readonly retryable: boolean; readonly type: "server-abstained" }
  | {
      readonly code: "BRIEF_EXPIRED" | "FORBIDDEN";
      readonly retryable: boolean;
      readonly type: "server-failed";
    }
  | { readonly type: "cancel" }
  | { readonly type: "retry-processing" };

export const everyC7LocalState = Object.freeze([
  "capability-checking",
  "unsupported",
  "permission-not-determined",
  "permission-denied",
  "permission-restricted",
  "ready",
  "scanning",
  "interrupted",
  "relocalising",
  "room-review",
  "structure-review",
  "packaging",
  "offline-upload",
  "paused-upload",
  "uploading",
  "processing",
  "proposed",
  "abstained",
  "cancelled",
  "safe-failure",
  "manual-fallback",
] as const satisfies readonly C7LocalState[]);

export function initialCaptureAcceptanceState(mode: CaptureMode): CaptureAcceptanceState {
  return Object.freeze({
    completedRoomIds: [],
    liveSensorSession: false,
    mode,
    reconciledParts: [],
    retryable: false,
    state: "capability-checking",
    worldSpaceGeneration: 1,
  });
}

export function reduceCaptureAcceptance(
  current: CaptureAcceptanceState,
  event: CaptureAcceptanceEvent,
): CaptureAcceptanceState {
  const transition = (
    next: Partial<CaptureAcceptanceState> & Pick<CaptureAcceptanceState, "state">,
  ) => Object.freeze({ ...current, ...next });

  if (
    event.type === "cancel" &&
    !["cancelled", "manual-fallback", "proposed"].includes(current.state)
  ) {
    return transition({ liveSensorSession: false, retryable: false, state: "cancelled" });
  }

  switch (current.state) {
    case "capability-checking":
      if (event.type === "capability-unsupported") return transition({ state: "unsupported" });
      if (event.type === "capability-supported") {
        const stateByPermission = {
          authorised: "ready",
          denied: "permission-denied",
          "not-determined": "permission-not-determined",
          restricted: "permission-restricted",
        } as const;
        return transition({ state: stateByPermission[event.permission] });
      }
      break;
    case "unsupported":
    case "permission-denied":
    case "permission-restricted":
      if (event.type === "choose-manual-fallback") return transition({ state: "manual-fallback" });
      break;
    case "permission-not-determined":
      if (event.type === "permission-authorised") return transition({ state: "ready" });
      if (event.type === "permission-denied") return transition({ state: "permission-denied" });
      if (event.type === "permission-restricted")
        return transition({ state: "permission-restricted" });
      break;
    case "ready":
      if (event.type === "start-scan")
        return transition({ liveSensorSession: true, state: "scanning" });
      break;
    case "scanning":
      if (event.type === "interrupt")
        return transition({ liveSensorSession: false, state: "interrupted" });
      if (event.type === "finish-room") {
        assertSafeIdentifier(event.roomId, "room ID");
        if (current.completedRoomIds.includes(event.roomId)) throw new Error("DUPLICATE_ROOM_ID");
        return transition({
          completedRoomIds: [...current.completedRoomIds, event.roomId],
          liveSensorSession: current.mode === "structure",
          state: "room-review",
        });
      }
      break;
    case "interrupted":
      if (event.type === "begin-relocalisation") return transition({ state: "relocalising" });
      if (event.type === "safe-restart") {
        return transition({
          completedRoomIds: [],
          liveSensorSession: false,
          state: "ready",
          worldSpaceGeneration: current.worldSpaceGeneration + 1,
        });
      }
      break;
    case "relocalising":
      if (event.type === "relocalisation-succeeded") {
        return transition({ liveSensorSession: true, state: "scanning" });
      }
      if (event.type === "relocalisation-failed") {
        return transition({
          liveSensorSession: false,
          retryable: event.retryable,
          safeCode: "RELOCALISATION_FAILED",
          state: "safe-failure",
        });
      }
      break;
    case "room-review":
      if (event.type === "accept-single-room" && current.mode === "single-room") {
        return transition({ liveSensorSession: false, state: "packaging" });
      }
      if (event.type === "capture-next-room" && current.mode === "structure") {
        return transition({ liveSensorSession: true, state: "scanning" });
      }
      if (
        event.type === "review-structure" &&
        current.mode === "structure" &&
        current.completedRoomIds.length >= 2
      ) {
        return transition({ liveSensorSession: false, state: "structure-review" });
      }
      break;
    case "structure-review":
      if (event.type === "accept-structure") return transition({ state: "packaging" });
      if (event.type === "reject-incompatible-world-space") {
        return transition({
          retryable: true,
          safeCode: "INCOMPATIBLE_WORLD_SPACE",
          state: "abstained",
        });
      }
      break;
    case "packaging":
      if (event.type === "package-created") {
        return transition({ state: event.network === "online" ? "uploading" : "offline-upload" });
      }
      break;
    case "offline-upload":
      if (event.type === "network-restored") {
        return transition({
          reconciledParts: reconcileParts(event.serverParts),
          state: "uploading",
        });
      }
      if (event.type === "pause-upload" || event.type === "backgrounded") {
        return transition({ state: "paused-upload" });
      }
      break;
    case "paused-upload":
      if (event.type === "resume-upload") {
        return transition({
          reconciledParts: reconcileParts(event.serverParts),
          state: event.network === "online" ? "uploading" : "offline-upload",
        });
      }
      if (event.type === "foregrounded") {
        return transition({
          reconciledParts: reconcileParts(event.serverParts),
          state: "uploading",
        });
      }
      break;
    case "uploading":
      if (event.type === "network-lost") return transition({ state: "offline-upload" });
      if (event.type === "pause-upload" || event.type === "backgrounded") {
        return transition({ state: "paused-upload" });
      }
      if (event.type === "upload-completed") return transition({ state: "processing" });
      if (event.type === "server-failed") {
        return transition({
          retryable: event.retryable,
          safeCode: event.code,
          state: "safe-failure",
        });
      }
      break;
    case "processing":
      if (event.type === "server-proposed")
        return transition({ retryable: false, state: "proposed" });
      if (event.type === "server-abstained") {
        return transition({ retryable: event.retryable, safeCode: event.code, state: "abstained" });
      }
      if (event.type === "server-failed") {
        return transition({
          retryable: event.retryable,
          safeCode: event.code,
          state: "safe-failure",
        });
      }
      break;
    case "abstained":
    case "safe-failure":
      if (event.type === "retry-processing" && current.retryable) {
        return transition({ retryable: false, safeCode: undefined, state: "processing" });
      }
      break;
    case "cancelled":
    case "manual-fallback":
    case "proposed":
      break;
  }
  throw new Error(`ILLEGAL_TRANSITION:${current.state}:${event.type}`);
}

export function localStateForServerState(serverState: C7ServerState): C7LocalState {
  const map: Readonly<Record<C7ServerState, C7LocalState>> = {
    abstained: "abstained",
    "cancel-requested": "cancelled",
    cancelled: "cancelled",
    created: "ready",
    failed: "safe-failure",
    processing: "processing",
    proposed: "proposed",
    uploaded: "processing",
    uploading: "uploading",
  };
  return map[serverState];
}

function reconcileParts(parts: readonly ReconciledPart[]): readonly ReconciledPart[] {
  const sorted = [...parts].sort((left, right) => left.partNumber - right.partNumber);
  const seen = new Set<number>();
  for (const part of sorted) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > 10_000) {
      throw new Error("INVALID_PART_NUMBER");
    }
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(part.checksumSha256)) {
      throw new Error("INVALID_PART_CHECKSUM");
    }
    if (seen.has(part.partNumber)) throw new Error("DUPLICATE_RECONCILED_PART");
    seen.add(part.partNumber);
  }
  return Object.freeze(sorted);
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(value)) {
    throw new Error(`INVALID_${label.toUpperCase().replaceAll(" ", "_")}`);
  }
}
