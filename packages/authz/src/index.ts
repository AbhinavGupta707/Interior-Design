import type { Actor, MemberRole } from "@interior-design/contracts";

export const projectActions = [
  "project:create",
  "project:read",
  "intake:read",
  "intake:update",
] as const;
export type ProjectAction = (typeof projectActions)[number];

export interface ProjectResource {
  readonly projectId?: string;
  readonly tenantId: string;
}

export interface AuthorisationDecision {
  readonly allowed: boolean;
  readonly reason: "allowed" | "cross-tenant" | "insufficient-role" | "unknown-action";
}

const permissions: Readonly<Record<MemberRole, ReadonlySet<ProjectAction>>> = Object.freeze({
  editor: new Set<ProjectAction>([
    "project:create",
    "project:read",
    "intake:read",
    "intake:update",
  ]),
  owner: new Set<ProjectAction>(["project:create", "project:read", "intake:read", "intake:update"]),
  viewer: new Set<ProjectAction>(["project:read", "intake:read"]),
});

export function authoriseProjectAction(
  actor: Actor,
  action: ProjectAction,
  resource: ProjectResource,
): AuthorisationDecision {
  if (actor.tenantId !== resource.tenantId) {
    return { allowed: false, reason: "cross-tenant" };
  }
  if (!projectActions.includes(action)) {
    return { allowed: false, reason: "unknown-action" };
  }
  if (!permissions[actor.role].has(action)) {
    return { allowed: false, reason: "insufficient-role" };
  }
  return { allowed: true, reason: "allowed" };
}
