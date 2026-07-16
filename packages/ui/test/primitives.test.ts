import { describe, expect, it } from "vitest";

import {
  getActionAttributes,
  getStateAnnouncementAttributes,
  loadingAnnouncementAttributes,
  uiClassNames,
} from "../src/index.js";

describe("UI primitive contracts", () => {
  it("keeps action class names and visual tone explicit", () => {
    expect(getActionAttributes({ className: "route-action", tone: "secondary" })).toEqual({
      className: `${uiClassNames.action} route-action`,
      "data-tone": "secondary",
    });
  });

  it("announces errors assertively without changing neutral panels", () => {
    expect(getStateAnnouncementAttributes("error")).toEqual({
      "aria-live": "assertive",
      role: "alert",
    });
    expect(getStateAnnouncementAttributes("neutral")).toEqual({});
  });

  it("exposes loading state to assistive technology", () => {
    expect(loadingAnnouncementAttributes).toEqual({
      "aria-busy": "true",
      "aria-live": "polite",
      role: "status",
    });
  });
});
