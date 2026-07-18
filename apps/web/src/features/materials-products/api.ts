import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  confirmSubstitutionRequestSchema,
  createSpecificationRequestSchema,
  createSubstitutionPreviewRequestSchema,
  specificationSchema,
  substitutionPreviewSchema,
  updateSelectionBoardRequestSchema,
} from "@interior-design/contracts";
import type { Specification, SubstitutionPreview } from "@interior-design/contracts";
import { z } from "zod";

import {
  catalogAssetPageSchema,
  catalogReleaseListSchema,
  sceneJobRequestSchema,
  sceneJobRequestResponseSchema,
  specificationListSchema,
  specificationRevisionListSchema,
  specificationScheduleLinesSchema,
  substitutionConfirmationResultSchema,
} from "./contracts";
import type {
  CatalogAssetPage,
  CatalogFilters,
  SceneJobRequestResponse,
  SpecificationScheduleLines,
  SubstitutionConfirmationResult,
} from "./contracts";

export type MaterialsProductsProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "interrupted"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "preview-expired"
  | "rejected"
  | "throttled"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly detail?: unknown;
}

export class MaterialsProductsProblem extends Error {
  constructor(
    readonly kind: MaterialsProductsProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MaterialsProductsProblem";
  }
}

export type MaterialsProductsTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function problemKind(status: number): MaterialsProductsProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410) return "preview-expired";
  if (status === 422) return "rejected";
  if (status === 429) return "throttled";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<MaterialsProductsProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  const detail =
    typeof problem?.detail === "string" && problem.detail.length <= 500
      ? problem.detail
      : "The materials and products request could not be completed.";
  const code =
    typeof problem?.code === "string" && /^[A-Z0-9_]{3,80}$/u.test(problem.code)
      ? problem.code
      : undefined;
  return new MaterialsProductsProblem(problemKind(response.status), detail, response.status, code);
}

function base(projectId: string): string {
  return `/api/c13/projects/${encodeURIComponent(projectId)}`;
}

function idempotentMutation(
  createId: () => string,
  body: unknown,
  signal?: AbortSignal,
): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: new Headers({
      accept: "application/json, application/problem+json",
      "content-type": "application/json",
      "idempotency-key": createId(),
    }),
    method: "POST",
    ...(signal ? { signal } : {}),
  };
}

export function createMaterialsProductsClient(
  transport: MaterialsProductsTransport = fetch,
  createId: () => string = () => crypto.randomUUID(),
) {
  async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        throw new MaterialsProductsProblem(
          "interrupted",
          "Preview preparation was interrupted. No preview or canonical state was changed.",
        );
      }
      throw new MaterialsProductsProblem(
        "offline",
        "You appear to be offline. Reconnect and retry; no selection or canonical state was changed.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new MaterialsProductsProblem(
        "invalid-response",
        "The service response did not match the frozen C13 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    confirmSubstitution(
      projectId: string,
      specification: Specification,
      preview: SubstitutionPreview,
    ): Promise<SubstitutionConfirmationResult> {
      const body = confirmSubstitutionRequestSchema.parse({
        expectedCandidateSnapshotSha256: preview.candidateSnapshotSha256,
        expectedSpecificationRevision: specification.currentRevision.revision,
        previewId: preview.previewId,
      });
      return request(
        `${base(projectId)}/specifications/${specification.specificationId}/substitutions/${preview.previewId}/confirm`,
        substitutionConfirmationResultSchema,
        idempotentMutation(createId, body),
      );
    },
    createSpecification(
      projectId: string,
      input: z.input<typeof createSpecificationRequestSchema>,
    ): Promise<Specification> {
      const body = createSpecificationRequestSchema.parse(input);
      return request(
        `${base(projectId)}/specifications/from-c12-confirmation`,
        specificationSchema,
        idempotentMutation(createId, body),
      );
    },
    createSubstitutionPreview(
      projectId: string,
      specification: Specification,
      replacementAssetVersionId: string,
      elementId: string,
      signal?: AbortSignal,
    ): Promise<SubstitutionPreview> {
      const body = createSubstitutionPreviewRequestSchema.parse({
        elementId,
        expectedBranchRevision: specification.currentRevision.branchRevision,
        expectedSpecificationRevision: specification.currentRevision.revision,
        replacementAssetVersionId,
      });
      return request(
        `${base(projectId)}/specifications/${specification.specificationId}/substitutions`,
        substitutionPreviewSchema,
        idempotentMutation(createId, body, signal),
      );
    },
    getCatalogAsset(projectId: string, releaseId: string, assetVersionId: string) {
      return request(
        `${base(projectId)}/catalog/releases/${releaseId}/assets/${assetVersionId}`,
        catalogAssetVersionSchema,
      );
    },
    getCatalogRelease(projectId: string, releaseId: string) {
      return request(`${base(projectId)}/catalog/releases/${releaseId}`, catalogReleaseSchema);
    },
    getSpecification(projectId: string, specificationId: string) {
      return request(`${base(projectId)}/specifications/${specificationId}`, specificationSchema);
    },
    listCatalogAssets(
      projectId: string,
      releaseId: string,
      input: CatalogFilters,
    ): Promise<CatalogAssetPage> {
      const query = new URLSearchParams({
        kind: input.kind,
        limit: String(input.pageSize),
        query: input.query,
        rights: input.rights,
        source: input.source,
      });
      if (input.cursor) query.set("cursor", input.cursor);
      return request(
        `${base(projectId)}/catalog/releases/${releaseId}/assets?${query.toString()}`,
        catalogAssetPageSchema,
      );
    },
    listCatalogReleases(projectId: string) {
      return request(`${base(projectId)}/catalog/releases`, catalogReleaseListSchema);
    },
    listSpecificationRevisions(projectId: string, specificationId: string) {
      return request(
        `${base(projectId)}/specifications/${specificationId}/revisions`,
        specificationRevisionListSchema,
      );
    },
    listSpecifications(projectId: string) {
      return request(`${base(projectId)}/specifications`, specificationListSchema);
    },
    readSchedule(projectId: string, specificationId: string): Promise<SpecificationScheduleLines> {
      return request(
        `${base(projectId)}/specifications/${specificationId}/schedule-lines`,
        specificationScheduleLinesSchema,
      );
    },
    requestExactScene(
      projectId: string,
      specificationId: string,
      revision: number,
      sceneJobId: string,
    ): Promise<SceneJobRequestResponse> {
      const exactRevision = z.int().positive().max(999_999_999).parse(revision);
      const body = sceneJobRequestSchema.parse({ sceneJobId });
      const exactSceneResponseSchema = sceneJobRequestResponseSchema.refine(
        (response) => response.sceneJobId === body.sceneJobId,
        { message: "The scene response must identify the exact requested job." },
      );
      return request(
        `${base(projectId)}/specifications/${specificationId}/revisions/${String(exactRevision)}/scene-jobs`,
        exactSceneResponseSchema,
        idempotentMutation(createId, body),
      );
    },
    updateSelectionBoard(
      projectId: string,
      specification: Specification,
      entries: Specification["selectionBoard"]["entries"],
    ): Promise<Specification> {
      const body = updateSelectionBoardRequestSchema.parse({
        entries,
        expectedRevision: specification.currentRevision.revision,
      });
      return request(
        `${base(projectId)}/specifications/${specification.specificationId}/selection-board`,
        specificationSchema,
        idempotentMutation(createId, body),
      );
    },
  });
}

export const materialsProductsClient = createMaterialsProductsClient();
