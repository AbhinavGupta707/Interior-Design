import type { SpecificationLine } from "@interior-design/contracts";

import { roomLabel } from "./presentation";

export type ScheduleKind = "element" | "finish" | "product-light" | "room";

export function projectScheduleLines(
  kind: ScheduleKind,
  lines: readonly SpecificationLine[],
): SpecificationLine[] {
  const selected =
    kind === "finish"
      ? lines.filter((line) => line.kind === "finish")
      : kind === "product-light"
        ? lines.filter((line) => line.kind !== "finish")
        : [...lines];
  if (kind === "room") {
    return selected.sort((left, right) => roomLabel(left).localeCompare(roomLabel(right)));
  }
  return selected.sort((left, right) => left.elementId.localeCompare(right.elementId));
}
