import {
  createModelSnapshotRequestSchema,
  type KnownAttribution,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import type { z } from "zod";

type CreateModelSnapshotRequest = z.infer<typeof createModelSnapshotRequestSchema>;

interface HomeWorkspaceScope {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly propertyId: string;
}

const method = Object.freeze({
  kind: "manual" as const,
  name: "Homeowner unmeasured workspace acknowledgement",
  version: "c14.2-v1",
});

function deterministicUuid(scope: HomeWorkspaceScope, purpose: string): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(
        JSON.stringify([
          "c14.2-existing-home-workspace-v1",
          scope.actorUserId,
          scope.projectId,
          scope.idempotencyKey,
          purpose,
        ]),
        "utf8",
      )
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function userAssertion(scope: HomeWorkspaceScope, purpose: string): KnownAttribution {
  return {
    actorUserId: scope.actorUserId,
    claimId: deterministicUuid(scope, purpose),
    evidenceIds: [],
    method,
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

function unknown(scope: HomeWorkspaceScope, purpose: string) {
  return {
    attribution: {
      claimId: deterministicUuid(scope, purpose),
      evidenceIds: [],
      method,
      reason: "not-provided" as const,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

export function buildUnmeasuredHomeWorkspaceRequest(
  scope: HomeWorkspaceScope,
): CreateModelSnapshotRequest {
  return createModelSnapshotRequestSchema.parse({
    expectedCurrentSnapshotSha256: null,
    snapshot: {
      coordinateSystem: {
        axes: { x: "east", y: "north", z: "up" },
        globalAnchor: { status: "not-established" },
        handedness: "right",
        kind: "local-cartesian",
        lengthUnit: "mm",
        originConvention: "project-local-model-origin",
      },
      elements: {
        cameras: [],
        finishes: [],
        fixedObjects: [],
        furnishings: [],
        levels: [
          {
            elementType: "level",
            elevationMm: unknown(scope, "level-elevation-claim"),
            id: deterministicUuid(scope, "placeholder-level"),
            name: unknown(scope, "level-name-claim"),
            origin: userAssertion(scope, "level-origin-claim"),
            storeyHeightMm: unknown(scope, "level-storey-height-claim"),
          },
        ],
        lights: [],
        openings: [],
        spaces: [],
        stairs: [],
        surfaces: [],
        walls: [],
      },
      knownLimitations: [
        {
          code: "PLACEHOLDER_LEVEL_UNMEASURED",
          detail:
            "The single placeholder level is unmeasured and not reviewed; its name, elevation and storey height remain unknown.",
        },
        {
          code: "PROPERTY_CONTEXT_PROVES_NO_INTERIOR",
          detail:
            "The selected property links this project only; its address and provider context establish no interior geometry or dimensions.",
        },
      ],
      modelId: deterministicUuid(scope, "existing-model"),
      profile: "existing",
      projectId: scope.projectId,
      propertyId: scope.propertyId,
      schemaVersion: "c4-canonical-home-v1",
    },
  });
}
