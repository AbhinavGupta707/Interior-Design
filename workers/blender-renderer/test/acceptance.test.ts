import { describe, expect, it } from "vitest";

import { requireExactByteReplay } from "../src/acceptance.js";

const roles = ["geometry-safe-png", "depth-exr"] as const;

describe("C14 exact-byte host replay", () => {
  it("returns both durable hash sets only when every required artifact is exact", () => {
    const bytes = new Map([
      ["geometry-safe-png", Buffer.from("png")],
      ["depth-exr", Buffer.from("exr")],
    ] as const);

    expect(requireExactByteReplay(roles, bytes, bytes)).toMatchObject({
      artifactByteHashesEqual: {
        "depth-exr": true,
        "geometry-safe-png": true,
      },
    });
  });

  it("fails the acceptance boundary when any replay artifact differs", () => {
    const primary = new Map([
      ["geometry-safe-png", Buffer.from("same")],
      ["depth-exr", Buffer.from("primary")],
    ] as const);
    const replay = new Map([
      ["geometry-safe-png", Buffer.from("same")],
      ["depth-exr", Buffer.from("replay")],
    ] as const);

    expect(() => requireExactByteReplay(roles, primary, replay)).toThrow(
      expect.objectContaining({ safeCode: "RENDER_REPLAY_BYTE_MISMATCH" }),
    );
  });
});
