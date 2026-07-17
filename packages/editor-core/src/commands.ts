import { modelOperationRequestSchema } from "@interior-design/contracts";
import type { KnownAttribution, ModelOperationRequest } from "@interior-design/contracts";

export interface OperationBuilderContext {
  readonly clientOperationId: string;
  readonly reason: string;
}

export interface UserAttributionContext {
  readonly actorUserId: string;
  readonly claimId: string;
  readonly methodName?: string;
  readonly methodVersion?: string;
}

type OperationOf<TType extends ModelOperationRequest["type"]> = Extract<
  ModelOperationRequest,
  { readonly type: TType }
>;
type OperationPayload<TType extends ModelOperationRequest["type"]> = Omit<
  OperationOf<TType>,
  "clientOperationId" | "reason" | "schemaVersion" | "type"
>;

export function createUserAttribution(context: UserAttributionContext): KnownAttribution {
  return {
    actorUserId: context.actorUserId,
    claimId: context.claimId,
    evidenceIds: [],
    method: {
      kind: "manual",
      name: context.methodName ?? "Home Design Studio 2D editor",
      version: context.methodVersion ?? "c5-editor-core-v1",
    },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

export function attributedUserValue<T>(value: T, attribution: KnownAttribution) {
  return {
    attribution,
    knowledge: "known" as const,
    value,
  };
}

function buildOperation<TType extends ModelOperationRequest["type"]>(
  type: TType,
  context: OperationBuilderContext,
  payload: OperationPayload<TType>,
): OperationOf<TType> {
  return modelOperationRequestSchema.parse({
    ...payload,
    clientOperationId: context.clientOperationId,
    reason: context.reason,
    schemaVersion: "c5-model-operation-v1",
    type,
  }) as OperationOf<TType>;
}

export const buildCreateLevelOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"level.create.v1">,
) => buildOperation("level.create.v1", context, payload);

export const buildCreateWallOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"wall.create.v1">,
) => buildOperation("wall.create.v1", context, payload);

export const buildTranslateWallOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"wall.translate.v1">,
) => buildOperation("wall.translate.v1", context, payload);

export const buildInsertOpeningOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"opening.insert.v1">,
) => buildOperation("opening.insert.v1", context, payload);

export const buildCreateSpaceOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"space.create.v1">,
) => buildOperation("space.create.v1", context, payload);

export const buildRenameSpaceOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"space.rename.v1">,
) => buildOperation("space.rename.v1", context, payload);

export const buildCorrectElementMetadataOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"element.metadata.correct.v1">,
) => buildOperation("element.metadata.correct.v1", context, payload);

export const buildCorrectElementProvenanceOperation = (
  context: OperationBuilderContext,
  payload: OperationPayload<"element.provenance.correct.v1">,
) => buildOperation("element.provenance.correct.v1", context, payload);
