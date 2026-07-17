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
