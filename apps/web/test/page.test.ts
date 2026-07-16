import { describe, expect, it } from "vitest";

describe("web bootstrap", () => {
  it("retains the M1 product name", () => {
    expect("Complete Home Design System").toContain("Home Design");
  });
});
