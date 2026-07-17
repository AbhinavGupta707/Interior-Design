import type { HomeIntake } from "@interior-design/contracts";

export type TextListField =
  "accessibilityNeeds" | "goals" | "mustChange" | "mustKeep" | "styleWords";

export function createEmptyIntake(): HomeIntake {
  return {
    accessibilityNeeds: [],
    dwellingType: "flat",
    evidenceAvailable: {
      photographs: false,
      plans: false,
      roomCapture: false,
      video: false,
    },
    goals: [],
    household: {
      adults: 1,
      children: 0,
      pets: 0,
    },
    mustChange: [],
    mustKeep: [],
    styleWords: [],
  };
}

export function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function listToLines(values: readonly string[]): string {
  return values.join("\n");
}

export function optionalCount(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}
