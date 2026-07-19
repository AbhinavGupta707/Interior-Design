import { authoriseProjectAction } from "../../../packages/authz/src/index.js";
import type { Actor } from "../../../packages/contracts/src/index.js";
import { describe, expect, it } from "vitest";

const tenant = "14000000-0000-4000-8000-000000000001";
const foreign = "14000000-0000-4000-8000-000000000002";
const actor = (role: Actor["role"]): Actor => ({
  displayName: `Fixture ${role}`,
  role,
  subject: `fixture|${role}`,
  tenantId: tenant,
  userId: `14000000-0000-4000-8000-00000000000${role === "owner" ? "3" : role === "editor" ? "4" : "5"}`,
});

describe("C14 frozen role and tenant policy", () => {
  it("allows owner/editor mutation and viewer read only", () => {
    for (const role of ["owner", "editor"] as const) {
      expect(
        authoriseProjectAction(actor(role), "render:job:create", { tenantId: tenant }).allowed,
      ).toBe(true);
      expect(
        authoriseProjectAction(actor(role), "render:job:cancel", { tenantId: tenant }).allowed,
      ).toBe(true);
      expect(
        authoriseProjectAction(actor(role), "render:artifact:read", { tenantId: tenant }).allowed,
      ).toBe(true);
    }
    expect(
      authoriseProjectAction(actor("viewer"), "render:job:read", { tenantId: tenant }).allowed,
    ).toBe(true);
    expect(
      authoriseProjectAction(actor("viewer"), "render:artifact:read", { tenantId: tenant }).allowed,
    ).toBe(true);
    expect(
      authoriseProjectAction(actor("viewer"), "render:job:create", { tenantId: tenant }).allowed,
    ).toBe(false);
    expect(
      authoriseProjectAction(actor("viewer"), "render:job:retry", { tenantId: tenant }).allowed,
    ).toBe(false);
  });

  it("denies every C14 action before foreign-tenant disclosure", () => {
    for (const action of [
      "render:job:create",
      "render:job:read",
      "render:job:cancel",
      "render:job:retry",
      "render:artifact:read",
    ] as const) {
      expect(authoriseProjectAction(actor("owner"), action, { tenantId: foreign }).allowed).toBe(
        false,
      );
    }
  });
});
