import { describe, expect, it } from "vitest";

import {
  everyC7LocalState,
  initialCaptureAcceptanceState,
  localStateForServerState,
  reduceCaptureAcceptance,
  type CaptureAcceptanceEvent,
  type CaptureAcceptanceState,
  type C7ServerState,
  type ReconciledPart,
} from "./reference-state-machine.js";

const checksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("C7 independent mobile acceptance state machine", () => {
  it("freezes every local state as an independently addressable UI scenario", () => {
    expect(everyC7LocalState).toHaveLength(21);
    expect(new Set(everyC7LocalState).size).toBe(everyC7LocalState.length);
    expect(everyC7LocalState).toContain("manual-fallback");
    expect(everyC7LocalState).toContain("safe-failure");
  });

  it("completes the single-room review, offline resume and proposal journey", () => {
    const parts: readonly ReconciledPart[] = [{ checksumSha256: checksum, partNumber: 1 }];
    const state = run("single-room", [
      { permission: "not-determined", type: "capability-supported" },
      { type: "permission-authorised" },
      { type: "start-scan" },
      { roomId: "synthetic-room-1", type: "finish-room" },
      { type: "accept-single-room" },
      { network: "offline", type: "package-created" },
      { serverParts: parts, type: "network-restored" },
      { type: "backgrounded" },
      { serverParts: parts, type: "foregrounded" },
      { type: "upload-completed" },
      { type: "server-proposed" },
    ]);
    expect(state).toMatchObject({
      completedRoomIds: ["synthetic-room-1"],
      liveSensorSession: false,
      reconciledParts: parts,
      state: "proposed",
    });
  });

  it("keeps two reviewed rooms in one continuous world space before structure packaging", () => {
    const state = run("structure", [
      { permission: "authorised", type: "capability-supported" },
      { type: "start-scan" },
      { roomId: "synthetic-room-a", type: "finish-room" },
      { type: "capture-next-room" },
      { roomId: "synthetic-room-b", type: "finish-room" },
      { type: "review-structure" },
      { type: "accept-structure" },
      { network: "online", type: "package-created" },
    ]);
    expect(state).toMatchObject({
      completedRoomIds: ["synthetic-room-a", "synthetic-room-b"],
      state: "uploading",
      worldSpaceGeneration: 1,
    });
  });

  it("models bounded interruption recovery and clears rooms on an explicit safe restart", () => {
    const recovered = run("structure", [
      { permission: "authorised", type: "capability-supported" },
      { type: "start-scan" },
      { type: "interrupt" },
      { type: "begin-relocalisation" },
      { type: "relocalisation-succeeded" },
    ]);
    expect(recovered).toMatchObject({ liveSensorSession: true, state: "scanning" });

    const restarted = run("structure", [
      { permission: "authorised", type: "capability-supported" },
      { type: "start-scan" },
      { roomId: "synthetic-before-interruption", type: "finish-room" },
      { type: "capture-next-room" },
      { type: "interrupt" },
      { type: "safe-restart" },
    ]);
    expect(restarted).toMatchObject({
      completedRoomIds: [],
      state: "ready",
      worldSpaceGeneration: 2,
    });
  });

  it("abstains instead of merging incompatible structure coordinates", () => {
    const state = run("structure", [
      { permission: "authorised", type: "capability-supported" },
      { type: "start-scan" },
      { roomId: "synthetic-room-a", type: "finish-room" },
      { type: "capture-next-room" },
      { roomId: "synthetic-room-b", type: "finish-room" },
      { type: "review-structure" },
      { type: "reject-incompatible-world-space" },
    ]);
    expect(state).toMatchObject({
      retryable: true,
      safeCode: "INCOMPATIBLE_WORLD_SPACE",
      state: "abstained",
    });
  });

  it("covers denial, restriction, unsupported capability and manual fallback", () => {
    for (const events of [
      [{ permission: "denied", type: "capability-supported" }, { type: "choose-manual-fallback" }],
      [
        { permission: "restricted", type: "capability-supported" },
        { type: "choose-manual-fallback" },
      ],
      [{ type: "capability-unsupported" }, { type: "choose-manual-fallback" }],
    ] satisfies readonly (readonly CaptureAcceptanceEvent[])[]) {
      expect(run("single-room", events).state).toBe("manual-fallback");
    }
  });

  it("exposes expiry, forbidden, cancel and retry without leaking raw server detail", () => {
    const uploadPrefix: readonly CaptureAcceptanceEvent[] = [
      { permission: "authorised", type: "capability-supported" },
      { type: "start-scan" },
      { roomId: "synthetic-room", type: "finish-room" },
      { type: "accept-single-room" },
      { network: "online", type: "package-created" },
    ];
    for (const code of ["BRIEF_EXPIRED", "FORBIDDEN"] as const) {
      const failed = run("single-room", [
        ...uploadPrefix,
        { code, retryable: code === "BRIEF_EXPIRED", type: "server-failed" },
      ]);
      expect(failed).toMatchObject({ safeCode: code, state: "safe-failure" });
      if (failed.retryable) {
        expect(reduceCaptureAcceptance(failed, { type: "retry-processing" }).state).toBe(
          "processing",
        );
      }
    }
    expect(run("single-room", [...uploadPrefix, { type: "cancel" }]).state).toBe("cancelled");
  });

  it("rejects illegal transitions and dishonest duplicate/out-of-range reconciliation", () => {
    expect(() =>
      reduceCaptureAcceptance(initialCaptureAcceptanceState("single-room"), {
        type: "start-scan",
      }),
    ).toThrow("ILLEGAL_TRANSITION");

    const paused = run("single-room", [
      { permission: "authorised", type: "capability-supported" },
      { type: "start-scan" },
      { roomId: "synthetic-room", type: "finish-room" },
      { type: "accept-single-room" },
      { network: "online", type: "package-created" },
      { type: "pause-upload" },
    ]);
    expect(() =>
      reduceCaptureAcceptance(paused, {
        network: "online",
        serverParts: [
          { checksumSha256: checksum, partNumber: 1 },
          { checksumSha256: checksum, partNumber: 1 },
        ],
        type: "resume-upload",
      }),
    ).toThrow("DUPLICATE_RECONCILED_PART");
  });

  it("maps every frozen server state to a visible local state", () => {
    const serverStates: readonly C7ServerState[] = [
      "created",
      "uploading",
      "uploaded",
      "processing",
      "proposed",
      "abstained",
      "cancel-requested",
      "cancelled",
      "failed",
    ];
    expect(serverStates.map(localStateForServerState)).toEqual([
      "ready",
      "uploading",
      "processing",
      "processing",
      "proposed",
      "abstained",
      "cancelled",
      "cancelled",
      "safe-failure",
    ]);
  });
});

function run(
  mode: "single-room" | "structure",
  events: readonly CaptureAcceptanceEvent[],
): CaptureAcceptanceState {
  return events.reduce(reduceCaptureAcceptance, initialCaptureAcceptanceState(mode));
}
