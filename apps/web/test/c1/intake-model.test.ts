import { homeIntakeSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  createEmptyIntake,
  linesToList,
  listToLines,
  optionalCount,
} from "../../src/features/onboarding/intake-model";

describe("C1 intake model", () => {
  it("creates a contract-shaped empty draft without inventing optional home facts", () => {
    const draft = createEmptyIntake();

    expect(draft.addressSummary).toBeUndefined();
    expect(draft.bedrooms).toBeUndefined();
    expect(draft.goals).toEqual([]);
    expect(homeIntakeSchema.safeParse(draft).success).toBe(false);
  });

  it("normalises one-item-per-line fields without persisting blank items", () => {
    const values = linesToList("More daylight\n\n  Better storage  \n");

    expect(values).toEqual(["More daylight", "Better storage"]);
    expect(listToLines(values)).toBe("More daylight\nBetter storage");
  });

  it("keeps optional counts unknown until a value is entered", () => {
    expect(optionalCount("")).toBeUndefined();
    expect(optionalCount("0")).toBe(0);
    expect(optionalCount("3")).toBe(3);
  });
});
