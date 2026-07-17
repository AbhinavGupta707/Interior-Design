import { describe, expect, it } from "vitest";

import tenantFixtures from "../../fixtures/c1/tenants.json" with { type: "json" };
import {
  authoriseProjectAction,
  projectActions,
  type ProjectAction,
} from "../../../packages/authz/src/index.js";
import { actorSchema } from "../../../packages/contracts/src/index.js";
import type { Actor, MemberRole } from "../../../packages/contracts/src/index.js";

const roles = ["owner", "editor", "viewer"] as const satisfies readonly MemberRole[];
const fixtureActors = tenantFixtures.tenants.flatMap((tenant) =>
  tenant.members.map((member) =>
    actorSchema.parse({
      displayName: member.displayName,
      role: member.role,
      subject: member.subject,
      tenantId: tenant.id,
      userId: member.userId,
    }),
  ),
);

const editor = actorSchema.parse({
  displayName: "Synthetic Alpha editor",
  role: "editor",
  subject: "fixture|editor-alpha",
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000004",
});

function fixtureActorFor(role: MemberRole): Actor {
  if (role === "editor") {
    return editor;
  }

  const actor = fixtureActors.find((candidate) => candidate.role === role);
  if (actor === undefined) {
    throw new Error(`Synthetic C1 fixture is missing the ${role} role`);
  }
  return actor;
}

const expectedSameTenantAccess: Readonly<
  Record<MemberRole, Readonly<Record<ProjectAction, boolean>>>
> = {
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
    "reconstruction:job:cancel": true,
    "reconstruction:job:create": true,
    "reconstruction:job:read": true,
    "reconstruction:job:retry": true,
    "reconstruction:result:read": true,
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
    "reconstruction:job:cancel": true,
    "reconstruction:job:create": true,
    "reconstruction:job:read": true,
    "reconstruction:job:retry": true,
    "reconstruction:result:read": true,
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
    "reconstruction:job:cancel": false,
    "reconstruction:job:create": false,
    "reconstruction:job:read": true,
    "reconstruction:job:retry": false,
    "reconstruction:result:read": true,
  },
};

const foreignResourceVariants = [
  { tenantId: "10000000-0000-4000-8000-000000000002" },
  {
    projectId: "30000000-0000-4000-8000-000000000001",
    tenantId: "10000000-0000-4000-8000-000000000002",
  },
  {
    projectId: "30000000-0000-4000-8000-000000000099",
    tenantId: "10000000-0000-4000-8000-000000000002",
  },
] as const;

describe("C1 project role/action matrix", () => {
  it("uses only visibly synthetic two-tenant fixture identities", () => {
    expect(tenantFixtures.tenants).toHaveLength(2);
    expect(fixtureActors).not.toHaveLength(0);
    for (const actor of fixtureActors) {
      expect(actor.subject).toMatch(/^fixture\|/);
      expect(actor.tenantId).toMatch(/^10000000-0000-4000-8000-/);
      expect(actor.userId).toMatch(/^20000000-0000-4000-8000-/);
    }
  });

  describe.each(roles)("%s", (role) => {
    const actor = fixtureActorFor(role);

    it.each(projectActions)(
      "applies the explicit same-tenant rule for %s",
      (action: ProjectAction) => {
        const allowed = expectedSameTenantAccess[role][action];
        expect(
          authoriseProjectAction(actor, action, {
            projectId: "30000000-0000-4000-8000-000000000001",
            tenantId: actor.tenantId,
          }),
        ).toEqual({
          allowed,
          reason: allowed ? "allowed" : "insufficient-role",
        });
      },
    );

    describe.each(foreignResourceVariants)("foreign resource %#", (resource) => {
      it.each(projectActions)(
        "denies %s without a resource-existence distinction",
        (action: ProjectAction) => {
          expect(authoriseProjectAction(actor, action, resource)).toEqual({
            allowed: false,
            reason: "cross-tenant",
          });
        },
      );
    });
  });
});
