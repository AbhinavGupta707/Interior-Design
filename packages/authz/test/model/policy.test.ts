import { describe, expect, it } from "vitest";

import type { Actor, MemberRole } from "@interior-design/contracts";

import {
  authoriseModelAction,
  authoriseModelAuditVisibility,
  modelActions,
  publicModelOperationTypes,
  type AuthoriseModelActionInput,
  type CurrentModelMembership,
  type HumanModelActorContext,
  type MachineModelActorContext,
  type ModelAction,
  type ModelPreviewAuthority,
  type ModelResource,
  type SupportAuditGrant,
  type SupportModelActorContext,
} from "../../src/model/index.js";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const clock = () => NOW;
const tenantId = "10000000-0000-4000-8000-000000000001";
const foreignTenantId = "10000000-0000-4000-8000-000000000002";
const projectId = "30000000-0000-4000-8000-000000000001";
const foreignProjectId = "30000000-0000-4000-8000-000000000002";
const modelId = "40000000-0000-4000-8000-000000000001";
const foreignModelId = "40000000-0000-4000-8000-000000000002";
const branchId = "50000000-0000-4000-8000-000000000001";
const targetBranchId = "50000000-0000-4000-8000-000000000002";
const foreignBranchId = "50000000-0000-4000-8000-000000000003";
const previewId = "60000000-0000-4000-8000-000000000001";

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

const branchResource: ModelResource & { readonly branchId: string } = {
  branchId,
  modelId,
  profile: "existing",
  projectId,
  tenantId,
};
const targetResource: ModelResource = { ...branchResource, branchId: targetBranchId };

function membership(actor: Actor, status: "active" | "revoked" = "active"): CurrentModelMembership {
  return { role: actor.role, status, tenantId: actor.tenantId, userId: actor.userId };
}

function humanContext(actor: Actor): HumanModelActorContext {
  return {
    actor,
    authenticatedActor: actor,
    currentMembership: membership(actor),
    kind: "human",
  };
}

function withoutBranch(resource: ModelResource): ModelResource {
  return {
    modelId: resource.modelId,
    profile: resource.profile,
    projectId: resource.projectId,
    tenantId: resource.tenantId,
  };
}

function preview(
  actor: Actor = actors.owner,
  overrides: Partial<ModelPreviewAuthority> = {},
): ModelPreviewAuthority {
  return {
    confirmationActorUserId: actor.userId,
    expiresAt: "2026-07-17T12:10:00.000Z",
    id: previewId,
    operationTypes: ["wall.translate.v1"],
    proposedBy: { id: actor.userId, kind: "human", tenantId },
    resource: { ...branchResource, branchId },
    ...overrides,
  };
}

function inputFor(action: ModelAction, actor: Actor = actors.owner): AuthoriseModelActionInput {
  const resource =
    action === "model:branch:create" ? withoutBranch(branchResource) : branchResource;
  return {
    action,
    context: humanContext(actor),
    ...(action === "model:operation:preview"
      ? { operationTypes: ["wall.translate.v1"] as const }
      : {}),
    ...(action === "model:operation:commit"
      ? { preview: preview(actor), requestedPreviewId: previewId }
      : {}),
    requestedResource: resource,
    ...(action === "model:branch:compare"
      ? { requestedTargetResource: targetResource, storedTargetResource: targetResource }
      : {}),
    storedResource: resource,
  };
}

const expectedAccess: Readonly<Record<MemberRole, Readonly<Record<ModelAction, boolean>>>> = {
  editor: Object.fromEntries(modelActions.map((action) => [action, true])) as Record<
    ModelAction,
    boolean
  >,
  owner: Object.fromEntries(modelActions.map((action) => [action, true])) as Record<
    ModelAction,
    boolean
  >,
  viewer: {
    "model:audit:read": true,
    "model:branch:compare": true,
    "model:branch:create": false,
    "model:branch:read": true,
    "model:branch:restore": false,
    "model:operation:commit": false,
    "model:operation:history": true,
    "model:operation:preview": false,
  },
};

describe("model operation policy", () => {
  it("retains exact immutable model action and public operation registries", () => {
    expect(modelActions).toEqual([
      "model:branch:create",
      "model:branch:read",
      "model:branch:compare",
      "model:operation:preview",
      "model:operation:commit",
      "model:branch:restore",
      "model:operation:history",
      "model:audit:read",
    ]);
    expect(publicModelOperationTypes).toEqual([
      "level.create.v1",
      "wall.create.v1",
      "wall.translate.v1",
      "opening.insert.v1",
      "space.create.v1",
      "space.rename.v1",
      "element.metadata.correct.v1",
      "element.provenance.correct.v1",
    ]);
    expect(Object.isFrozen(modelActions)).toBe(true);
    expect(Object.isFrozen(publicModelOperationTypes)).toBe(true);
  });

  describe.each(Object.keys(actors) as MemberRole[])("%s role", (role) => {
    it.each(modelActions)("decides %s explicitly", (action) => {
      const decision = authoriseModelAction(inputFor(action, actors[role]), { clock });
      expect(decision.allowed).toBe(expectedAccess[role][action]);
      expect(decision.reason).toBe(expectedAccess[role][action] ? "allowed" : "insufficient-role");
    });

    it.each(modelActions)("denies foreign-tenant %s", (action) => {
      const input = inputFor(action, actors[role]);
      const foreignResource = { ...input.requestedResource, tenantId: foreignTenantId };
      const decision = authoriseModelAction(
        {
          ...input,
          ...(input.requestedTargetResource === undefined
            ? {}
            : {
                requestedTargetResource: {
                  ...input.requestedTargetResource,
                  tenantId: foreignTenantId,
                },
                storedTargetResource: {
                  ...input.storedTargetResource,
                  tenantId: foreignTenantId,
                },
              }),
          requestedResource: foreignResource,
          storedResource: foreignResource,
        } as AuthoriseModelActionInput,
        { clock },
      );
      expect(decision).toEqual({ allowed: false, reason: "cross-tenant" });
    });
  });

  it("denies an unknown action at runtime", () => {
    const input = { ...inputFor("model:branch:read"), action: "model:branch:delete" };
    expect(authoriseModelAction(input as never, { clock })).toEqual({
      allowed: false,
      reason: "unknown-action",
    });
  });

  it.each([
    ["project", { ...branchResource, projectId: foreignProjectId }],
    ["model", { ...branchResource, modelId: foreignModelId }],
    ["profile", { ...branchResource, profile: "proposed" as const }],
    ["branch", { ...branchResource, branchId: foreignBranchId }],
  ])("denies a foreign %s loaded for the route", (_field, storedResource) => {
    expect(
      authoriseModelAction({ ...inputFor("model:branch:read"), storedResource }, { clock }),
    ).toEqual({ allowed: false, reason: "resource-mismatch" });
  });

  it("rejects missing branch identity except for branch creation", () => {
    const resourceWithoutBranch = withoutBranch(branchResource);
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:branch:read"),
          requestedResource: resourceWithoutBranch,
          storedResource: resourceWithoutBranch,
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "invalid-context" });
  });

  it("rejects a branch identity on branch creation", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:branch:create"),
          requestedResource: branchResource,
          storedResource: branchResource,
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "invalid-context" });
  });

  it("denies a compare target from a foreign project, model, profile, or tenant", () => {
    for (const target of [
      { ...targetResource, tenantId: foreignTenantId },
      { ...targetResource, projectId: foreignProjectId },
      { ...targetResource, modelId: foreignModelId },
      { ...targetResource, profile: "proposed" as const },
    ]) {
      expect(
        authoriseModelAction(
          {
            ...inputFor("model:branch:compare"),
            requestedTargetResource: target,
            storedTargetResource: target,
          },
          { clock },
        ),
      ).toEqual({ allowed: false, reason: "resource-mismatch" });
    }
  });

  it("denies a forged target branch when the persisted target differs", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:branch:compare"),
          storedTargetResource: { ...targetResource, branchId: foreignBranchId },
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "resource-mismatch" });
  });

  it("denies a forged operation actor", () => {
    const forged = { ...actors.owner, userId: actors.editor.userId };
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:preview"),
          context: { ...humanContext(actors.owner), actor: forged },
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "identity-mismatch" });
  });

  it("denies a stale or forged membership role", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:preview"),
          context: {
            ...humanContext(actors.owner),
            currentMembership: { ...membership(actors.owner), role: "viewer" },
          },
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "identity-mismatch" });
  });

  it.each(modelActions)("denies %s after membership revocation", (action) => {
    const input = inputFor(action);
    expect(
      authoriseModelAction(
        {
          ...input,
          context: {
            ...humanContext(actors.owner),
            currentMembership: membership(actors.owner, "revoked"),
          },
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "membership-revoked" });
  });

  it("fails closed for malformed resources and unexpected target resources", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:branch:read"),
          requestedResource: { ...branchResource, unsafePath: "__proto__.role" } as never,
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "invalid-context" });
    expect(
      authoriseModelAction(
        { ...inputFor("model:branch:read"), requestedTargetResource: targetResource },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "invalid-context" });
  });

  it("fails closed instead of throwing for hostile runtime accessors", () => {
    const hostileInput = new Proxy(inputFor("model:branch:read"), {
      get() {
        throw new Error("hostile getter");
      },
    });
    expect(() => authoriseModelAction(hostileInput, { clock })).not.toThrow();
    expect(authoriseModelAction(hostileInput, { clock })).toEqual({
      allowed: false,
      reason: "invalid-context",
    });
    expect(
      authoriseModelAction(inputFor("model:branch:read"), {
        clock: () => {
          throw new Error("hostile clock");
        },
      }),
    ).toEqual({ allowed: false, reason: "invalid-context" });
  });
});

describe("preview and machine confirmation policy", () => {
  const machineContext: MachineModelActorContext = {
    actor: {
      delegatedByUserId: actors.owner.userId,
      serviceId: "design-proposal-worker.v1",
      tenantId,
    },
    authenticatedMachine: {
      allowedActions: ["model:operation:preview"],
      delegatedByUserId: actors.owner.userId,
      expiresAt: "2026-07-17T12:05:00.000Z",
      serviceId: "design-proposal-worker.v1",
      tenantId,
    },
    currentMembership: membership(actors.owner),
    delegatedActor: actors.owner,
    kind: "machine",
  };

  it("allows an authenticated machine to propose public operations for an active editor", () => {
    expect(
      authoriseModelAction(
        { ...inputFor("model:operation:preview"), context: machineContext },
        { clock },
      ),
    ).toEqual({
      actor: { id: "design-proposal-worker.v1", kind: "machine" },
      allowed: true,
      confirmationActorUserId: actors.owner.userId,
      reason: "allowed",
    });
  });

  it.each(modelActions.filter((action) => action !== "model:operation:preview"))(
    "never allows a machine to perform %s",
    (action) => {
      expect(
        authoriseModelAction({ ...inputFor(action), context: machineContext }, { clock }),
      ).toEqual({ allowed: false, reason: "machine-action-denied" });
    },
  );

  it("denies a machine delegated by a viewer", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:preview"),
          context: {
            ...machineContext,
            actor: { ...machineContext.actor, delegatedByUserId: actors.viewer.userId },
            authenticatedMachine: {
              ...machineContext.authenticatedMachine,
              delegatedByUserId: actors.viewer.userId,
            },
            currentMembership: membership(actors.viewer),
            delegatedActor: actors.viewer,
          },
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "insufficient-role" });
  });

  it("denies a machine proposal after delegated membership revocation", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:preview"),
          context: {
            ...machineContext,
            currentMembership: membership(actors.owner, "revoked"),
          },
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "membership-revoked" });
  });

  it("denies expired, mismatched, unscoped, and foreign machine credentials", () => {
    const invalidContexts: Array<[MachineModelActorContext, string]> = [
      [
        {
          ...machineContext,
          authenticatedMachine: {
            ...machineContext.authenticatedMachine,
            expiresAt: "2026-07-17T12:00:00.000Z",
          },
        },
        "machine-authentication-expired",
      ],
      [
        {
          ...machineContext,
          authenticatedMachine: {
            ...machineContext.authenticatedMachine,
            serviceId: "other-worker.v1",
          },
        },
        "identity-mismatch",
      ],
      [
        {
          ...machineContext,
          authenticatedMachine: { ...machineContext.authenticatedMachine, allowedActions: [] },
        },
        "machine-action-denied",
      ],
      [
        {
          ...machineContext,
          actor: { ...machineContext.actor, tenantId: foreignTenantId },
          authenticatedMachine: {
            ...machineContext.authenticatedMachine,
            tenantId: foreignTenantId,
          },
        },
        "identity-mismatch",
      ],
    ];
    for (const [context, reason] of invalidContexts) {
      expect(
        authoriseModelAction({ ...inputFor("model:operation:preview"), context }, { clock }),
      ).toEqual({ allowed: false, reason });
    }
  });

  it("rejects internal and unknown operation types at the public proposal boundary", () => {
    for (const operationType of ["snapshot.restore.v1", "wall.delete.v1"]) {
      expect(
        authoriseModelAction(
          {
            ...inputFor("model:operation:preview"),
            operationTypes: [operationType] as never,
          },
          { clock },
        ),
      ).toEqual({ allowed: false, reason: "invalid-context" });
    }
  });

  it("allows only the human named by a machine proposal to confirm it", () => {
    const machinePreview = preview(actors.owner, {
      proposedBy: { id: "design-proposal-worker.v1", kind: "machine", tenantId },
    });
    expect(
      authoriseModelAction(
        { ...inputFor("model:operation:commit"), preview: machinePreview },
        { clock },
      ).allowed,
    ).toBe(true);
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:commit", actors.editor),
          preview: machinePreview,
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "preview-actor-mismatch" });
  });

  it("denies human preview theft and forged human confirmation linkage", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:commit", actors.editor),
          preview: preview(actors.owner),
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "preview-actor-mismatch" });
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:commit", actors.editor),
          preview: preview(actors.editor, {
            proposedBy: { id: actors.owner.userId, kind: "human", tenantId },
          }),
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "preview-actor-mismatch" });
  });

  it.each([
    ["preview id", { requestedPreviewId: "60000000-0000-4000-8000-000000000099" }],
    [
      "branch",
      {
        preview: preview(actors.owner, {
          resource: { ...branchResource, branchId: foreignBranchId },
        }),
      },
    ],
    [
      "project",
      {
        preview: preview(actors.owner, {
          resource: { ...branchResource, projectId: foreignProjectId },
        }),
      },
    ],
    [
      "model",
      {
        preview: preview(actors.owner, {
          resource: { ...branchResource, modelId: foreignModelId },
        }),
      },
    ],
    [
      "profile",
      { preview: preview(actors.owner, { resource: { ...branchResource, profile: "proposed" } }) },
    ],
  ])("denies a mismatched %s on commit", (_name, override) => {
    expect(
      authoriseModelAction({ ...inputFor("model:operation:commit"), ...override }, { clock }),
    ).toEqual({ allowed: false, reason: "preview-resource-mismatch" });
  });

  it("denies expired and consumed previews", () => {
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:commit"),
          preview: preview(actors.owner, { expiresAt: NOW.toISOString() }),
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "preview-expired" });
    expect(
      authoriseModelAction(
        {
          ...inputFor("model:operation:commit"),
          preview: preview(actors.owner, { consumedAt: "2026-07-17T11:59:00.000Z" }),
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "preview-consumed" });
  });
});

describe("safe audit visibility", () => {
  const supportContext: SupportModelActorContext = {
    actor: { supportAgentId: "support.agent-1" },
    authenticatedSupport: {
      expiresAt: "2026-07-17T12:05:00.000Z",
      supportAgentId: "support.agent-1",
    },
    kind: "support",
  };
  const grant: SupportAuditGrant = {
    approvedByUserId: actors.owner.userId,
    expiresAt: "2026-07-17T12:05:00.000Z",
    grantId: "70000000-0000-4000-8000-000000000001",
    purpose: "customer-request",
    resource: { ...branchResource, branchId },
    supportAgentId: "support.agent-1",
  };

  it.each(Object.keys(actors) as MemberRole[])(
    "allows a current %s member to inspect audit",
    (role) => {
      const decision = authoriseModelAuditVisibility(
        {
          context: humanContext(actors[role]),
          requestedResource: branchResource,
          storedResource: branchResource,
        },
        { clock },
      );
      expect(decision).toMatchObject({
        access: { subjectId: actors[role].userId, visibility: "member" },
        allowed: true,
      });
    },
  );

  it("allows only an exact, owner-approved, expiring branch support grant", () => {
    expect(
      authoriseModelAuditVisibility(
        {
          approverMembership: membership(actors.owner),
          context: supportContext,
          requestedResource: branchResource,
          storedResource: branchResource,
          supportGrant: grant,
        },
        { clock },
      ),
    ).toEqual({
      access: {
        expiresAt: grant.expiresAt,
        scope: branchResource,
        subjectId: "support.agent-1",
        visibility: "support-redacted",
      },
      allowed: true,
      reason: "allowed",
    });
  });

  it.each([
    ["missing grant", undefined, membership(actors.owner)],
    ["non-owner approval", grant, membership(actors.editor)],
    ["revoked approval", grant, membership(actors.owner, "revoked")],
    [
      "wrong support agent",
      { ...grant, supportAgentId: "support.agent-2" },
      membership(actors.owner),
    ],
    [
      "foreign branch",
      { ...grant, resource: { ...grant.resource, branchId: foreignBranchId } },
      membership(actors.owner),
    ],
    [
      "revoked grant",
      { ...grant, revokedAt: "2026-07-17T11:59:00.000Z" },
      membership(actors.owner),
    ],
  ])("denies support visibility for %s", (_name, supportGrant, approverMembership) => {
    const decision = authoriseModelAuditVisibility(
      {
        approverMembership,
        context: supportContext,
        requestedResource: branchResource,
        storedResource: branchResource,
        ...(supportGrant === undefined ? {} : { supportGrant }),
      },
      { clock },
    );
    expect(decision.allowed).toBe(false);
  });

  it("rejects broad model-level support grants", () => {
    const broadResource = withoutBranch(branchResource);
    expect(
      authoriseModelAuditVisibility(
        {
          approverMembership: membership(actors.owner),
          context: supportContext,
          requestedResource: branchResource,
          storedResource: branchResource,
          supportGrant: { ...grant, resource: broadResource } as never,
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "invalid-context" });
  });

  it("fails closed for hostile support accessors", () => {
    const context = new Proxy(supportContext, {
      get() {
        throw new Error("hostile getter");
      },
    });
    expect(
      authoriseModelAuditVisibility(
        {
          approverMembership: membership(actors.owner),
          context,
          requestedResource: branchResource,
          storedResource: branchResource,
          supportGrant: grant,
        },
        { clock },
      ),
    ).toEqual({ allowed: false, reason: "invalid-context" });
  });
});
