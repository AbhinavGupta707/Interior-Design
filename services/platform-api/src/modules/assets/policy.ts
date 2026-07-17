import { authoriseProjectAction } from "@interior-design/authz";
import type { Actor, MemberRole } from "@interior-design/contracts";

export const assetActions = Object.freeze([
  "asset:abort-upload",
  "asset:complete-upload",
  "asset:create-upload",
  "asset:issue-derived-access",
  "asset:issue-original-access",
  "asset:list",
  "asset:read",
  "asset:sign-part",
] as const);
export type AssetAction = (typeof assetActions)[number];

const permissions: Readonly<Record<MemberRole, Readonly<Record<AssetAction, boolean>>>> =
  Object.freeze({
    editor: Object.freeze({
      "asset:abort-upload": true,
      "asset:complete-upload": true,
      "asset:create-upload": true,
      "asset:issue-derived-access": true,
      "asset:issue-original-access": true,
      "asset:list": true,
      "asset:read": true,
      "asset:sign-part": true,
    }),
    owner: Object.freeze({
      "asset:abort-upload": true,
      "asset:complete-upload": true,
      "asset:create-upload": true,
      "asset:issue-derived-access": true,
      "asset:issue-original-access": true,
      "asset:list": true,
      "asset:read": true,
      "asset:sign-part": true,
    }),
    viewer: Object.freeze({
      "asset:abort-upload": false,
      "asset:complete-upload": false,
      "asset:create-upload": false,
      "asset:issue-derived-access": true,
      "asset:issue-original-access": false,
      "asset:list": true,
      "asset:read": true,
      "asset:sign-part": false,
    }),
  });

function isAssetAction(action: unknown): action is AssetAction {
  return typeof action === "string" && (assetActions as readonly string[]).includes(action);
}

export function authoriseAssetAction(actor: Actor, action: AssetAction, tenantId: string): boolean {
  if (!isAssetAction(action)) {
    return false;
  }
  const projectBoundary = authoriseProjectAction(actor, "project:read", { tenantId });
  if (!projectBoundary.allowed) {
    return false;
  }
  return permissions[actor.role][action];
}
