import {
  commitModelOperationsRequestSchema,
  commitModelOperationsResponseSchema,
  createModelBranchRequestSchema,
  listModelBranchesResponseSchema,
  modelBranchComparisonSchema,
  modelBranchSchema,
  modelOperationHistoryResponseSchema,
  modelOperationsPreviewSchema,
  modelProfileSchema,
  modelSnapshotRecordSchema,
  previewModelOperationsRequestSchema,
  restoreModelBranchRequestSchema,
} from "@interior-design/contracts";
import type {
  ModelBranch,
  ModelCommit,
  ModelOperationRequest,
  ModelOperationsPreview,
  ModelProfile,
  ModelSnapshotRecord,
} from "@interior-design/contracts";
import type { z } from "zod";

import { editorBranchWorkspaceSchema } from "./contracts";
import type { EditorBranchComparison, EditorBranchWorkspace } from "./contracts";

export type EditorProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "unavailable";

interface EditorProblemPayload {
  readonly code?: unknown;
  readonly currentHeadSnapshotSha256?: unknown;
  readonly currentRevision?: unknown;
  readonly detail?: unknown;
}

export class EditorProblem extends Error {
  constructor(
    readonly kind: EditorProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
    readonly currentRevision?: number,
    readonly currentHeadSnapshotSha256?: string,
  ) {
    super(message);
    this.name = "EditorProblem";
  }
}

export type EditorTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function problemKind(status: number, code?: string): EditorProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409 || code === "BRANCH_REVISION_CONFLICT") return "conflict";
  return "unavailable";
}

async function editorProblemFrom(response: Response): Promise<EditorProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as EditorProblemPayload) : undefined;
  const code = typeof problem?.code === "string" ? problem.code : undefined;
  const revision =
    typeof problem?.currentRevision === "number" && Number.isInteger(problem.currentRevision)
      ? problem.currentRevision
      : undefined;
  const head =
    typeof problem?.currentHeadSnapshotSha256 === "string"
      ? problem.currentHeadSnapshotSha256
      : undefined;
  return new EditorProblem(
    problemKind(response.status, code),
    typeof problem?.detail === "string"
      ? problem.detail
      : "The editor request could not be completed.",
    response.status,
    code,
    revision,
    head,
  );
}

function idempotentMutation(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, application/problem+json",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    method: "POST",
  };
}

function editorBase(projectId: string, profile: ModelProfile): string {
  return `/api/c5/projects/${encodeURIComponent(projectId)}/models/${profile}`;
}

export function createEditorClient(transport: EditorTransport = fetch) {
  async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new EditorProblem("offline", "You appear to be offline. Reconnect and try again.");
    }
    if (!response.ok) throw await editorProblemFrom(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new EditorProblem(
        "invalid-response",
        "The service response did not match the frozen C4/C5 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    commit(
      projectId: string,
      profile: ModelProfile,
      branchId: string,
      value: {
        readonly commitMessage: string;
        readonly expectedHeadSnapshotSha256: string;
        readonly expectedRevision: number;
        readonly previewId: string;
      },
    ): Promise<{
      branch: ModelBranch;
      commit: ModelCommit;
      findings: ModelOperationsPreview["findings"];
    }> {
      const body = commitModelOperationsRequestSchema.parse(value);
      return request(
        `${editorBase(projectId, profile)}/branches/${encodeURIComponent(branchId)}/commits`,
        commitModelOperationsResponseSchema,
        idempotentMutation(body),
      );
    },
    compare(
      projectId: string,
      profile: ModelProfile,
      branchId: string,
      targetBranchId: string,
    ): Promise<EditorBranchComparison> {
      return request(
        `${editorBase(projectId, profile)}/branches/${encodeURIComponent(branchId)}/compare/${encodeURIComponent(targetBranchId)}`,
        modelBranchComparisonSchema,
      );
    },
    createBranch(
      projectId: string,
      profile: ModelProfile,
      value: {
        readonly name: string;
        readonly sourceSnapshotId: string;
        readonly sourceSnapshotSha256: string;
      },
    ): Promise<ModelBranch> {
      const body = createModelBranchRequestSchema.parse(value);
      return request(
        `${editorBase(projectId, profile)}/branches`,
        modelBranchSchema,
        idempotentMutation(body),
      );
    },
    getCurrentSnapshot(projectId: string, profile: ModelProfile): Promise<ModelSnapshotRecord> {
      modelProfileSchema.parse(profile);
      return request(`${editorBase(projectId, profile)}/source`, modelSnapshotRecordSchema);
    },
    listBranches(projectId: string, profile: ModelProfile): Promise<ModelBranch[]> {
      return request(
        `${editorBase(projectId, profile)}/branches`,
        listModelBranchesResponseSchema,
      ).then(({ branches }) => branches);
    },
    listHistory(projectId: string, profile: ModelProfile, branchId: string, cursor?: string) {
      const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return request(
        `${editorBase(projectId, profile)}/branches/${encodeURIComponent(branchId)}/operations${suffix}`,
        modelOperationHistoryResponseSchema,
      );
    },
    loadBranch(
      projectId: string,
      profile: ModelProfile,
      branchId: string,
    ): Promise<EditorBranchWorkspace> {
      return request(
        `${editorBase(projectId, profile)}/branches/${encodeURIComponent(branchId)}`,
        editorBranchWorkspaceSchema,
      );
    },
    preview(
      projectId: string,
      profile: ModelProfile,
      branchId: string,
      operations: readonly ModelOperationRequest[],
      expectedRevision: number,
      expectedHeadSnapshotSha256: string,
    ): Promise<ModelOperationsPreview> {
      const body = previewModelOperationsRequestSchema.parse({
        expectedHeadSnapshotSha256,
        expectedRevision,
        operations,
      });
      return request(
        `${editorBase(projectId, profile)}/branches/${encodeURIComponent(branchId)}/previews`,
        modelOperationsPreviewSchema,
        idempotentMutation(body),
      );
    },
    restore(
      projectId: string,
      profile: ModelProfile,
      branchId: string,
      value: {
        readonly expectedHeadSnapshotSha256: string;
        readonly expectedRevision: number;
        readonly reason: string;
        readonly sourceSnapshotId: string;
        readonly sourceSnapshotSha256: string;
      },
    ) {
      const body = restoreModelBranchRequestSchema.parse(value);
      return request(
        `${editorBase(projectId, profile)}/branches/${encodeURIComponent(branchId)}/restores`,
        commitModelOperationsResponseSchema,
        idempotentMutation(body),
      );
    },
  });
}

export const editorClient = createEditorClient();
