import { describe, expect, it } from "vitest";

import { authorizeScene } from "./reference-boundary.js";

const resource = {
  attempt: 1,
  projectId: "a1000000-0000-4000-8000-000000000001",
  state: "compiling" as const,
  tenantId: "a1000000-0000-4000-8000-000000000002",
};
const owner = {
  projectId: resource.projectId,
  role: "owner" as const,
  tenantId: resource.tenantId,
};

describe("C10 independent role and IDOR boundary", () => {
  it("denies foreign tenant/project before action-specific disclosure", () => {
    for (const actor of [
      { ...owner, tenantId: "a1000000-0000-4000-8000-000000000099" },
      { ...owner, projectId: "a1000000-0000-4000-8000-000000000098" },
    ]) {
      for (const action of ["access", "cancel", "create", "read", "retry"] as const) {
        expect(() => authorizeScene(actor, resource, action)).toThrow("SCENE_NOT_FOUND");
      }
    }
  });

  it("keeps viewers strictly read-only while allowing short-lived inspection access", () => {
    const viewer = { ...owner, role: "viewer" as const };
    expect(() => authorizeScene(viewer, resource, "read")).not.toThrow();
    expect(() =>
      authorizeScene(viewer, { ...resource, state: "succeeded" }, "access"),
    ).not.toThrow();
    for (const action of ["cancel", "create", "retry"] as const) {
      expect(() => authorizeScene(viewer, resource, action)).toThrow("SCENE_FORBIDDEN");
    }
  });

  it("enforces terminal cancellation, retry state and the three-attempt ceiling", () => {
    expect(() => authorizeScene(owner, resource, "cancel")).not.toThrow();
    expect(() => authorizeScene(owner, { ...resource, state: "succeeded" }, "cancel")).toThrow(
      "SCENE_CANCEL_TERMINAL",
    );
    expect(() => authorizeScene(owner, { ...resource, state: "failed" }, "retry")).not.toThrow();
    expect(() =>
      authorizeScene(owner, { ...resource, attempt: 3, state: "failed" }, "retry"),
    ).toThrow("SCENE_ATTEMPT_LIMIT");
  });
});
