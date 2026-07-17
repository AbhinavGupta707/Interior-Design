import { actorSchema, tenantIdSchema } from "@interior-design/contracts";
import type { Actor, MemberRole } from "@interior-design/contracts";

export const projectActions = Object.freeze([
  "project:create",
  "project:read",
  "reconstruction:job:create",
  "reconstruction:job:read",
  "reconstruction:job:cancel",
  "reconstruction:job:retry",
  "reconstruction:result:read",
  "capture:session:create",
  "capture:session:read",
  "capture:session:cancel",
  "capture:artifact:upload",
  "capture:package:finalize",
  "capture:proposal:read",
  "capture:proposal:retry",
  "intake:read",
  "intake:update",
  "fusion:job:create",
  "fusion:job:read",
  "fusion:job:cancel",
  "fusion:job:retry",
  "fusion:proposal:read",
  "fusion:proposal:review",
  "fusion:proposal:draft",
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
    "capture:artifact:upload": true,
    "capture:package:finalize": true,
    "capture:proposal:read": true,
    "capture:proposal:retry": true,
    "capture:session:cancel": true,
    "capture:session:create": true,
    "capture:session:read": true,
    "intake:read": true,
    "intake:update": true,
    "fusion:job:cancel": true,
    "fusion:job:create": true,
    "fusion:job:read": true,
    "fusion:job:retry": true,
    "fusion:proposal:draft": true,
    "fusion:proposal:read": true,
    "fusion:proposal:review": true,
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
  }),
  owner: Object.freeze({
    "capture:artifact:upload": true,
    "capture:package:finalize": true,
    "capture:proposal:read": true,
    "capture:proposal:retry": true,
    "capture:session:cancel": true,
    "capture:session:create": true,
    "capture:session:read": true,
    "intake:read": true,
    "intake:update": true,
    "fusion:job:cancel": true,
    "fusion:job:create": true,
    "fusion:job:read": true,
    "fusion:job:retry": true,
    "fusion:proposal:draft": true,
    "fusion:proposal:read": true,
    "fusion:proposal:review": true,
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
  }),
  viewer: Object.freeze({
    "capture:artifact:upload": false,
    "capture:package:finalize": false,
    "capture:proposal:read": true,
    "capture:proposal:retry": false,
    "capture:session:cancel": false,
    "capture:session:create": false,
    "capture:session:read": true,
    "intake:read": true,
    "intake:update": false,
    "fusion:job:cancel": false,
    "fusion:job:create": false,
    "fusion:job:read": true,
    "fusion:job:retry": false,
    "fusion:proposal:draft": false,
    "fusion:proposal:read": true,
    "fusion:proposal:review": false,
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

// C5's resource-bound policy is part of the public authorisation package so
// later inference and automation lanes cannot bypass its human-confirmation
// and machine-preview boundaries.
export * from "./model/index.js";
