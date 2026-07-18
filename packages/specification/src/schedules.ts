import type { SpecificationLine } from "@interior-design/contracts";

import { compareIdentifiers } from "./canonical.js";
import { assertOneLinePerElement } from "./lines.js";

export type SpecificationScheduleKind = "element" | "finish" | "product-light" | "room";

export interface SpecificationScheduleGroup {
  readonly key: string;
  readonly lines: readonly SpecificationLine[];
  readonly schedule: SpecificationScheduleKind;
}

function group(
  lines: readonly SpecificationLine[],
  schedule: SpecificationScheduleKind,
  key: (line: SpecificationLine) => string | undefined,
): readonly SpecificationScheduleGroup[] {
  const groups = new Map<string, SpecificationLine[]>();
  for (const line of lines) {
    const groupKey = key(line);
    if (groupKey === undefined) continue;
    const retained = groups.get(groupKey) ?? [];
    retained.push(line);
    groups.set(groupKey, retained);
  }
  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) => compareIdentifiers(left, right))
      .map(([groupKey, retained]) => ({
        key: groupKey,
        lines: Object.freeze(
          retained.toSorted((left, right) => compareIdentifiers(left.elementId, right.elementId)),
        ),
        schedule,
      })),
  );
}

export function projectSpecificationSchedules(
  linesInput: readonly SpecificationLine[],
): Readonly<Record<SpecificationScheduleKind, readonly SpecificationScheduleGroup[]>> {
  const lines = assertOneLinePerElement(linesInput);
  return Object.freeze({
    element: group(lines, "element", ({ elementId }) => elementId),
    finish: group(lines, "finish", (line) =>
      line.kind === "finish" ? line.assetVersionId : undefined,
    ),
    "product-light": group(lines, "product-light", (line) =>
      line.kind === "furnishing" || line.kind === "light" ? line.assetVersionId : undefined,
    ),
    room: group(lines, "room", ({ roomAssignment }) =>
      roomAssignment.status === "assigned" ? roomAssignment.spaceId : "review-required",
    ),
  });
}
