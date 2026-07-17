import type { Actor } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { authoriseAssetAction } from "../../src/modules/assets/policy.js";

const owner: Actor = {
  displayName: "Synthetic owner",
  role: "owner",
  subject: "fixture|owner",
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
};
const viewer: Actor = { ...owner, role: "viewer", userId: "20000000-0000-4000-8000-000000000002" };

describe("C2 deny-by-default policy", () => {
  it("allows owner mutations only inside the C1 tenant boundary", () => {
    expect(authoriseAssetAction(owner, "asset:create-upload", owner.tenantId)).toBe(true);
    expect(
      authoriseAssetAction(owner, "asset:create-upload", "10000000-0000-4000-8000-000000000002"),
    ).toBe(false);
  });

  it("lets viewers inspect safe derivatives but denies every upload and original action", () => {
    expect(authoriseAssetAction(viewer, "asset:list", viewer.tenantId)).toBe(true);
    expect(authoriseAssetAction(viewer, "asset:read", viewer.tenantId)).toBe(true);
    expect(authoriseAssetAction(viewer, "asset:issue-derived-access", viewer.tenantId)).toBe(true);
    for (const action of [
      "asset:create-upload",
      "asset:sign-part",
      "asset:complete-upload",
      "asset:abort-upload",
      "asset:issue-original-access",
    ] as const) {
      expect(authoriseAssetAction(viewer, action, viewer.tenantId)).toBe(false);
    }
  });

  it("fails closed for malformed actors at the existing C1 policy boundary", () => {
    expect(
      authoriseAssetAction(
        { ...owner, role: "administrator" } as unknown as Actor,
        "asset:list",
        owner.tenantId,
      ),
    ).toBe(false);
  });
});
