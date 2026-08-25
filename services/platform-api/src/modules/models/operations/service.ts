import type { ModelProfile } from "@interior-design/contracts";
import {
  ModelOperationError,
  validateAndCanonicalizeSnapshot,
} from "@interior-design/model-operations";

import { ApiError } from "../../../errors.js";
import { ModelOperationValidationError } from "./errors.js";
import type {
  CommitOperationsCommand,
  CreateBranchCommand,
  InitializeModelCommand,
  ModelOperationRepository,
  PreviewOperationsCommand,
  RestoreBranchCommand,
} from "./types.js";

const MAX_ATTRIBUTION_TRAVERSAL_DEPTH = 32;
const MAX_ATTRIBUTION_TRAVERSAL_NODES = 1_000_000;

function invalidOperation(error: unknown): ApiError {
  return new ApiError(
    {
      code: "MODEL_OPERATION_INVALID",
      detail: "The typed model operation could not be applied to this snapshot.",
      statusCode: 422,
      title: "Model Operation Invalid",
    },
    { cause: error },
  );
}

function invalidAttributionActor(): ApiError {
  return new ApiError({
    code: "MODEL_ATTRIBUTION_ACTOR_MISMATCH",
    detail: "User-asserted model attribution must match the authenticated actor.",
    statusCode: 422,
    title: "Model Attribution Actor Mismatch",
  });
}

function assertUserAttributionActor(value: unknown, actorUserId: string): void {
  const pending: { readonly depth: number; readonly value: unknown }[] = [{ depth: 0, value }];
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.depth > MAX_ATTRIBUTION_TRAVERSAL_DEPTH) throw invalidAttributionActor();

    visitedNodes += 1;
    if (visitedNodes > MAX_ATTRIBUTION_TRAVERSAL_NODES) throw invalidAttributionActor();

    if (
      !Array.isArray(current.value) &&
      "state" in current.value &&
      current.value.state === "user-asserted" &&
      (!("actorUserId" in current.value) || current.value.actorUserId !== actorUserId)
    ) {
      throw invalidAttributionActor();
    }

    const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ depth: current.depth + 1, value: children[index] });
    }
  }
}

export class ModelOperationService {
  readonly #repository: ModelOperationRepository;

  constructor(repository: ModelOperationRepository) {
    this.#repository = repository;
  }

  async initialize(command: InitializeModelCommand) {
    if (
      command.snapshot.projectId !== command.projectId ||
      command.snapshot.profile !== command.profile
    ) {
      throw new ApiError({
        code: "INVALID_MODEL_BOUNDARY",
        detail: "The canonical snapshot does not match the authorised project and profile.",
        statusCode: 400,
        title: "Invalid Model Boundary",
      });
    }
    let prepared: ReturnType<typeof validateAndCanonicalizeSnapshot>;
    try {
      prepared = validateAndCanonicalizeSnapshot(command.snapshot);
    } catch (error: unknown) {
      throw invalidOperation(error);
    }
    const blocking = prepared.findings.filter(({ severity }) => severity === "error");
    if (blocking.length > 0) {
      throw new ModelOperationValidationError(
        "The initialization snapshot contains blocking geometry findings.",
        blocking,
      );
    }
    assertUserAttributionActor(prepared.snapshot, command.actor.userId);
    return this.#repository.initialize({ ...command, snapshot: prepared.snapshot });
  }

  createBranch(command: CreateBranchCommand) {
    return this.#repository.createBranch(command);
  }

  listBranches(tenantId: string, projectId: string, profile: ModelProfile) {
    return this.#repository.listBranches(tenantId, projectId, profile);
  }

  getBranch(tenantId: string, projectId: string, profile: ModelProfile, branchId: string) {
    return this.#repository.getBranch(tenantId, projectId, profile, branchId);
  }

  async preview(command: PreviewOperationsCommand) {
    assertUserAttributionActor(command.operations, command.actor.userId);
    try {
      return await this.#repository.preview(command);
    } catch (error: unknown) {
      if (error instanceof ModelOperationError) throw invalidOperation(error);
      throw error;
    }
  }

  async commit(command: CommitOperationsCommand) {
    try {
      return await this.#repository.commit(command);
    } catch (error: unknown) {
      if (error instanceof ModelOperationError) throw invalidOperation(error);
      throw error;
    }
  }

  async restore(command: RestoreBranchCommand) {
    try {
      return await this.#repository.restore(command);
    } catch (error: unknown) {
      if (error instanceof ModelOperationError) throw invalidOperation(error);
      throw error;
    }
  }

  listOperations(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
    cursor: string | undefined,
    limit: number,
  ) {
    return this.#repository.listOperations(tenantId, projectId, profile, branchId, cursor, limit);
  }

  compareBranches(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
    targetBranchId: string,
  ) {
    return this.#repository.compareBranches(tenantId, projectId, profile, branchId, targetBranchId);
  }

  verifyReplay(tenantId: string, projectId: string, profile: ModelProfile, branchId: string) {
    return this.#repository.verifyReplay(tenantId, projectId, profile, branchId);
  }
}
