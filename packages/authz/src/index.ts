import { actorSchema, tenantIdSchema } from "@interior-design/contracts";
import type { Actor, MemberRole } from "@interior-design/contracts";

export const projectActions = Object.freeze([
  "project:create",
  "project:read",
  "intake:read",
  "intake:update",
  "property:read",
  "property:refresh",
  "property:resolve",
  "property:update",
] as const);
export type ProjectAction = (typeof projectActions)[number];

export interface ProjectResource {
  readonly projectId?: string;
  readonly tenantId: string;
}

export interface AuthorisationDecision {
  readonly allowed: boolean;
  readonly reason: "allowed" | "cross-tenant" | "insufficient-role" | "unknown-action";
}

type RoleActionMatrix = Readonly<Record<MemberRole, Readonly<Record<ProjectAction, boolean>>>>;

const permissions: RoleActionMatrix = Object.freeze({
  editor: Object.freeze({
    "intake:read": true,
    "intake:update": true,
    "property:read": true,
    "property:refresh": true,
    "property:resolve": true,
    "property:update": true,
    "project:create": true,
    "project:read": true,
  }),
  owner: Object.freeze({
    "intake:read": true,
    "intake:update": true,
    "property:read": true,
    "property:refresh": true,
    "property:resolve": true,
    "property:update": true,
    "project:create": true,
    "project:read": true,
  }),
  viewer: Object.freeze({
    "intake:read": true,
    "intake:update": false,
    "property:read": true,
    "property:refresh": false,
    "property:resolve": false,
    "property:update": false,
    "project:create": false,
    "project:read": true,
  }),
});

function isProjectAction(action: unknown): action is ProjectAction {
  return typeof action === "string" && (projectActions as readonly string[]).includes(action);
}

function parseActor(actor: unknown): Actor | undefined {
  try {
    const result = actorSchema.safeParse(actor);
    return result.success ? result.data : undefined;
  } catch {
    // Proxies and accessors are untrusted at the runtime boundary too.
    return undefined;
  }
}

function parseResourceTenantId(resource: unknown): string | undefined {
  try {
    if (typeof resource !== "object" || resource === null) {
      return undefined;
    }

    const result = tenantIdSchema.safeParse(Reflect.get(resource, "tenantId"));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function authoriseProjectAction(
  actor: Actor,
  action: ProjectAction,
  resource: ProjectResource,
): AuthorisationDecision {
  if (!isProjectAction(action)) {
    return { allowed: false, reason: "unknown-action" };
  }

  const validatedActor = parseActor(actor);
  if (validatedActor === undefined) {
    return { allowed: false, reason: "insufficient-role" };
  }

  const resourceTenantId = parseResourceTenantId(resource);
  if (resourceTenantId === undefined || validatedActor.tenantId !== resourceTenantId) {
    return { allowed: false, reason: "cross-tenant" };
  }

  if (!permissions[validatedActor.role][action]) {
    return { allowed: false, reason: "insufficient-role" };
  }

  return { allowed: true, reason: "allowed" };
}
