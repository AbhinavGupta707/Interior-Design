import { describe, expect, it } from "vitest";

import type { Actor, MemberRole } from "@interior-design/contracts";

import { authoriseProjectAction, projectActions } from "../src/index.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const foreignTenantId = "10000000-0000-4000-8000-000000000002";
const roles = ["owner", "editor", "viewer"] as const satisfies readonly MemberRole[];

const actors: Readonly<Record<MemberRole, Actor>> = {
  editor: {
    displayName: "Synthetic editor",
    role: "editor",
    subject: "fixture|editor",
    tenantId,
    userId: "20000000-0000-4000-8000-000000000002",
  },
  owner: {
    displayName: "Synthetic owner",
    role: "owner",
    subject: "fixture|owner",
    tenantId,
    userId: "20000000-0000-4000-8000-000000000001",
  },
  viewer: {
    displayName: "Synthetic viewer",
    role: "viewer",
    subject: "fixture|viewer",
    tenantId,
    userId: "20000000-0000-4000-8000-000000000003",
  },
};

const expectedSameTenantAccess = {
  editor: {
    "capture:artifact:upload": true,
    "capture:package:finalize": true,
    "capture:proposal:read": true,
    "capture:proposal:retry": true,
    "capture:session:cancel": true,
    "capture:session:create": true,
    "capture:session:read": true,
    "intake:read": true,
    "intake:update": true,
    "model:read": true,
    "model:snapshot:create": true,
    "model:branch:create": true,
    "model:branch:read": true,
    "model:branch:compare": true,
    "model:operation:preview": true,
    "model:operation:commit": true,
    "model:branch:restore": true,
    "model:operation:history": true,
    "model:audit:read": true,
    "plan:job:create": true,
    "plan:job:read": true,
    "plan:job:cancel": true,
    "plan:job:retry": true,
    "plan:proposal:read": true,
    "plan:proposal:calibrate": true,
    "plan:proposal:draft": true,
    "property:read": true,
    "property:refresh": true,
    "property:resolve": true,
    "property:update": true,
    "project:create": true,
    "project:read": true,
  },
  owner: {
    "capture:artifact:upload": true,
    "capture:package:finalize": true,
    "capture:proposal:read": true,
    "capture:proposal:retry": true,
    "capture:session:cancel": true,
    "capture:session:create": true,
    "capture:session:read": true,
    "intake:read": true,
    "intake:update": true,
    "model:read": true,
    "model:snapshot:create": true,
    "model:branch:create": true,
    "model:branch:read": true,
    "model:branch:compare": true,
    "model:operation:preview": true,
    "model:operation:commit": true,
    "model:branch:restore": true,
    "model:operation:history": true,
    "model:audit:read": true,
    "plan:job:create": true,
    "plan:job:read": true,
    "plan:job:cancel": true,
    "plan:job:retry": true,
    "plan:proposal:read": true,
    "plan:proposal:calibrate": true,
    "plan:proposal:draft": true,
    "property:read": true,
    "property:refresh": true,
    "property:resolve": true,
    "property:update": true,
    "project:create": true,
    "project:read": true,
  },
  viewer: {
    "capture:artifact:upload": false,
    "capture:package:finalize": false,
    "capture:proposal:read": true,
    "capture:proposal:retry": false,
    "capture:session:cancel": false,
    "capture:session:create": false,
    "capture:session:read": true,
    "intake:read": true,
    "intake:update": false,
    "model:read": true,
    "model:snapshot:create": false,
    "model:branch:create": false,
    "model:branch:read": true,
    "model:branch:compare": true,
    "model:operation:preview": false,
    "model:operation:commit": false,
    "model:branch:restore": false,
    "model:operation:history": true,
    "model:audit:read": true,
    "plan:job:create": false,
    "plan:job:read": true,
    "plan:job:cancel": false,
    "plan:job:retry": false,
    "plan:proposal:read": true,
    "plan:proposal:calibrate": false,
    "plan:proposal:draft": false,
    "property:read": true,
    "property:refresh": false,
    "property:resolve": false,
    "property:update": false,
    "project:create": false,
    "project:read": true,
  },
} as const;

const malformedActor = {
  displayName: "Synthetic intruder",
  role: "administrator",
  subject: "fixture|intruder",
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000099",
};

describe("authoriseProjectAction", () => {
  it("keeps the frozen action registry exact and immutable", () => {
    expect(projectActions).toEqual([
      "project:create",
      "project:read",
      "capture:session:create",
      "capture:session:read",
      "capture:session:cancel",
      "capture:artifact:upload",
      "capture:package:finalize",
      "capture:proposal:read",
      "capture:proposal:retry",
      "intake:read",
      "intake:update",
      "model:read",
      "model:snapshot:create",
      "model:branch:create",
      "model:branch:read",
      "model:branch:compare",
      "model:operation:preview",
      "model:operation:commit",
      "model:branch:restore",
      "model:operation:history",
      "model:audit:read",
      "plan:job:create",
      "plan:job:read",
      "plan:job:cancel",
      "plan:job:retry",
      "plan:proposal:read",
      "plan:proposal:calibrate",
      "plan:proposal:draft",
      "property:read",
      "property:refresh",
      "property:resolve",
      "property:update",
    ]);
    expect(Object.isFrozen(projectActions)).toBe(true);
  });

  describe.each(roles)("%s matrix", (role) => {
    it.each(projectActions)("decides %s explicitly inside the actor tenant", (action) => {
      const allowed = expectedSameTenantAccess[role][action];
      expect(authoriseProjectAction(actors[role], action, { tenantId })).toEqual({
        allowed,
        reason: allowed ? "allowed" : "insufficient-role",
      });
    });

    it.each(projectActions)("denies foreign %s before applying role permissions", (action) => {
      expect(authoriseProjectAction(actors[role], action, { tenantId: foreignTenantId })).toEqual({
        allowed: false,
        reason: "cross-tenant",
      });
    });
  });

  it("denies unknown actions at the runtime boundary", () => {
    expect(authoriseProjectAction(actors.owner, "project:delete" as never, { tenantId })).toEqual({
      allowed: false,
      reason: "unknown-action",
    });
  });

  it("denies an invalid actor role without indexing or throwing", () => {
    expect(authoriseProjectAction(malformedActor as never, "project:read", { tenantId })).toEqual({
      allowed: false,
      reason: "insufficient-role",
    });
  });
});
