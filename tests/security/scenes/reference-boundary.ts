export type SceneRole = "editor" | "owner" | "viewer";
export type SceneAction = "access" | "cancel" | "create" | "read" | "retry";

export interface SceneActor {
  readonly projectId: string;
  readonly role: SceneRole;
  readonly tenantId: string;
}

export interface SceneResource {
  readonly attempt: number;
  readonly projectId: string;
  readonly state:
    | "cancel-requested"
    | "cancelled"
    | "compiling"
    | "failed"
    | "leased"
    | "publishing"
    | "queued"
    | "succeeded";
  readonly tenantId: string;
}

const mutatingRoles = new Set<SceneRole>(["editor", "owner"]);
const publicLocatorKey =
  /(?:authorization|credential|file|lease|object.?key|path|secret|signed|token|uri|url)/iu;

export function authorizeScene(
  actor: SceneActor,
  resource: SceneResource,
  action: SceneAction,
): void {
  if (actor.tenantId !== resource.tenantId || actor.projectId !== resource.projectId) {
    throw new Error("SCENE_NOT_FOUND");
  }
  if (action === "read" || action === "access") return;
  if (!mutatingRoles.has(actor.role)) throw new Error("SCENE_FORBIDDEN");
  if (
    action === "cancel" &&
    !["queued", "leased", "compiling", "publishing"].includes(resource.state)
  ) {
    throw new Error("SCENE_CANCEL_TERMINAL");
  }
  if (action === "retry" && !["failed", "cancelled"].includes(resource.state)) {
    throw new Error("SCENE_RETRY_NOT_TERMINAL");
  }
  if (action === "retry" && resource.attempt >= 3) throw new Error("SCENE_ATTEMPT_LIMIT");
}

export function assertNoPublicLocator(value: unknown): void {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const next = queue.pop();
    if (Array.isArray(next)) {
      for (const entry of next as unknown[]) queue.push(entry);
      continue;
    }
    if (typeof next !== "object" || next === null) continue;
    for (const [key, entry] of Object.entries(next)) {
      if (publicLocatorKey.test(key)) throw new Error("SCENE_PUBLIC_LOCATOR");
      queue.push(entry);
    }
  }
}
