import { describe, expect, it } from "vitest";

import {
  createProjectRequestSchema,
  homeIntakeSchema,
  localSessionRequestSchema,
} from "../src/index.js";

describe("C1 contracts", () => {
  it("accepts a structured minimum home intake", () => {
    expect(
      homeIntakeSchema.parse({
        accessibilityNeeds: [],
        dwellingType: "terraced-house",
        evidenceAvailable: {
          photographs: true,
          plans: false,
          roomCapture: false,
          video: false,
        },
        goals: ["Create a coherent whole-home direction"],
        household: { adults: 2, children: 0, pets: 0 },
        mustChange: [],
        mustKeep: [],
        styleWords: ["warm", "calm"],
      }),
    ).toBeDefined();
  });

  it("rejects unknown project and session fields", () => {
    expect(() => createProjectRequestSchema.parse({ name: "Home", tenantId: "forged" })).toThrow();
    expect(() =>
      localSessionRequestSchema.parse({ persona: "homeowner-alpha", admin: true }),
    ).toThrow();
  });
});
