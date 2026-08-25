import { describe, expect, it } from "vitest";

import {
  renderLaunchContextSchema,
  renderStillsLaunchHref,
} from "../../src/features/render-stills/launch-context";
import { ids } from "./fixtures";

describe("C14 exact source handoff", () => {
  it("round-trips an exact C10/C13 launch without accepting partial specification pins", () => {
    const href = renderStillsLaunchHref(ids.project, {
      sourceSceneJobId: ids.sceneJob,
      specificationId: ids.specification,
      specificationRevision: 5,
    });
    const url = new URL(href, "https://example.invalid");
    expect(renderLaunchContextSchema.parse(Object.fromEntries(url.searchParams))).toEqual({
      sourceSceneJobId: ids.sceneJob,
      specificationId: ids.specification,
      specificationRevision: 5,
    });
    expect(
      renderLaunchContextSchema.safeParse({
        sourceSceneJobId: ids.sceneJob,
        specificationId: ids.specification,
      }).success,
    ).toBe(false);
  });

  it("allows the viewer to hand off only the exact scene for server eligibility resolution", () => {
    expect(renderLaunchContextSchema.parse({ sourceSceneJobId: ids.sceneJob })).toEqual({
      sourceSceneJobId: ids.sceneJob,
    });
  });
});
