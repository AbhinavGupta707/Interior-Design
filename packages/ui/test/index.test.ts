import { describe, expect, it } from "vitest";

import { evidenceStatusValues } from "../src/index.js";

describe("evidence status vocabulary", () => {
  it("keeps unknown as an explicit state", () => {
    expect(evidenceStatusValues).toContain("unknown");
  });
});
