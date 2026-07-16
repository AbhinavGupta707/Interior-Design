import { describe, expect, it } from "vitest";

import type { Actor } from "@interior-design/contracts";

import { authoriseProjectAction } from "../src/index.js";

const owner: Actor = {
  displayName: "Fixture owner",
  role: "owner",
  subject: "fixture|owner",
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
};

describe("authoriseProjectAction", () => {
  it("allows an owner to update intake inside their tenant", () => {
    expect(authoriseProjectAction(owner, "intake:update", { tenantId: owner.tenantId })).toEqual({
      allowed: true,
      reason: "allowed",
    });
  });

  it("denies the same action across tenants", () => {
    expect(
      authoriseProjectAction(owner, "intake:update", {
        tenantId: "10000000-0000-4000-8000-000000000002",
      }),
    ).toEqual({ allowed: false, reason: "cross-tenant" });
  });
});
