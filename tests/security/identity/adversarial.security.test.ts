import { describe, expect, it } from "vitest";

import {
  authoriseProjectAction,
  projectActions,
  type ProjectAction,
  type ProjectResource,
} from "../../../packages/authz/src/index.js";
import type { Actor } from "../../../packages/contracts/src/index.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const owner: Actor = {
  displayName: "Synthetic owner",
  role: "owner",
  subject: "fixture|owner",
  tenantId,
  userId: "20000000-0000-4000-8000-000000000001",
};
const viewer: Actor = {
  displayName: "Synthetic viewer",
  role: "viewer",
  subject: "fixture|viewer",
  tenantId,
  userId: "20000000-0000-4000-8000-000000000002",
};

function decide(actor: unknown, action: unknown, resource: unknown) {
  return authoriseProjectAction(
    actor as Actor,
    action as ProjectAction,
    resource as ProjectResource,
  );
}

function generatedUnknownActions(): readonly string[] {
  const generated = Array.from(
    { length: 256 },
    (_, index) => `unregistered:${index.toString(36)}:${(index * 2_654_435_761).toString(16)}`,
  );
  return ["", "__proto__", "constructor", "project:delete", "intake:*", ...generated];
}

const throwingProxy = new Proxy(
  {},
  {
    get() {
      throw new Error("synthetic hostile accessor");
    },
    ownKeys() {
      throw new Error("synthetic hostile proxy");
    },
  },
);

const invalidActors: readonly unknown[] = [
  undefined,
  null,
  {},
  { ...owner, role: "administrator" },
  { ...owner, role: "Owner" },
  { ...owner, tenantId: "not-a-tenant" },
  { ...owner, userId: "not-a-user" },
  { ...owner, subject: "" },
  throwingProxy,
];

const invalidResources: readonly unknown[] = [
  undefined,
  null,
  {},
  { tenantId: "" },
  { tenantId: 1 },
  { tenantId: "10000000-0000-4000-8000-000000000099" },
  throwingProxy,
];

describe("C1 adversarial authorisation boundary", () => {
  it("denies every generated unknown action deterministically", () => {
    for (const action of generatedUnknownActions()) {
      expect(projectActions).not.toContain(action);
      const first = decide(owner, action, { tenantId });
      const second = decide(owner, action, { tenantId });
      expect(first).toEqual({ allowed: false, reason: "unknown-action" });
      expect(second).toEqual(first);
    }
  });

  it.each(invalidActors)("denies malformed or missing actor context %#", (actor) => {
    for (const action of projectActions) {
      expect(decide(actor, action, { tenantId })).toEqual({
        allowed: false,
        reason: "insufficient-role",
      });
    }
  });

  it.each(invalidResources)("denies malformed, missing, or foreign resources %#", (resource) => {
    for (const action of projectActions) {
      expect(decide(owner, action, resource)).toEqual({
        allowed: false,
        reason: "cross-tenant",
      });
    }
  });

  it("does not let request-supplied role or actor fields elevate a viewer", () => {
    const resourceWithForgedAuthority = {
      actor: { ...owner },
      role: "owner",
      tenantId,
      userId: owner.userId,
    };

    expect(decide(viewer, "project:create", resourceWithForgedAuthority)).toEqual({
      allowed: false,
      reason: "insufficient-role",
    });
    expect(decide(viewer, "intake:update", resourceWithForgedAuthority)).toEqual({
      allowed: false,
      reason: "insufficient-role",
    });
  });

  it("does not mutate trusted inputs and returns stable decisions", () => {
    const frozenActor = Object.freeze({ ...viewer });
    const frozenResource = Object.freeze({
      projectId: "30000000-0000-4000-8000-000000000001",
      tenantId,
    });

    const decisions = Array.from({ length: 32 }, () =>
      authoriseProjectAction(frozenActor, "intake:update", frozenResource),
    );
    expect(decisions).toEqual(
      Array.from({ length: 32 }, () => ({
        allowed: false,
        reason: "insufficient-role",
      })),
    );
    expect(frozenActor).toEqual(viewer);
    expect(frozenResource).toEqual({
      projectId: "30000000-0000-4000-8000-000000000001",
      tenantId,
    });
  });

  it("uses a documented validation precedence for wholly hostile input", () => {
    expect(decide(undefined, "project:delete", undefined)).toEqual({
      allowed: false,
      reason: "unknown-action",
    });
    expect(decide(undefined, "project:read", undefined)).toEqual({
      allowed: false,
      reason: "insufficient-role",
    });
    expect(decide(owner, "project:read", undefined)).toEqual({
      allowed: false,
      reason: "cross-tenant",
    });
  });
});
