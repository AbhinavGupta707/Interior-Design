import { describe, expect, it } from "vitest";

import { runtimeEnvironmentSchema } from "../src/index.js";

describe("runtimeEnvironmentSchema", () => {
  it("rejects undeclared environments", () => {
    expect(runtimeEnvironmentSchema.safeParse("fixture-production").success).toBe(false);
  });
});
