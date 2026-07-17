import {
  projectPropertySchema,
  propertyDossierSchema,
  propertyResolutionResponseSchema,
  propertySourceRecordsResponseSchema,
  refreshPropertyDossierRequestSchema,
  resolvePropertyRequestSchema,
  selectProjectPropertyRequestSchema,
} from "@interior-design/contracts";
import type {
  ProjectProperty,
  PropertyDossier,
  PropertyResolutionResponse,
  PropertySourceRecord,
  ResolvePropertyRequest,
  SelectProjectPropertyRequest,
} from "@interior-design/contracts";
import type { ZodType } from "zod";

export type PropertyProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "resolution-expired"
  | "unavailable";

export class PropertyProblem extends Error {
  constructor(
    readonly kind: PropertyProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PropertyProblem";
  }
}

export type PropertyTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ProblemPayload {
  readonly code?: string;
  readonly detail?: string;
}

function parseProblemKind(status: number, code?: string): PropertyProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return code?.includes("EXPIRED") ? "resolution-expired" : "conflict";
  if (status === 410) return "resolution-expired";
  return "unavailable";
}

async function problemFromResponse(response: Response): Promise<PropertyProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  return new PropertyProblem(
    parseProblemKind(response.status, problem?.code),
    problem?.detail ?? "The property request could not be completed.",
    response.status,
    problem?.code,
  );
}

function mutationInit(body: unknown, method: "POST" | "PUT" = "POST"): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, application/problem+json",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    method,
  };
}

export function createPropertyClient(transport: PropertyTransport = fetch) {
  async function perform(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      const headers = new Headers(init?.headers);
      headers.set("accept", "application/json, application/problem+json");
      response = await transport(url, { ...init, cache: "no-store", headers });
    } catch {
      throw new PropertyProblem("offline", "You appear to be offline. Reconnect and try again.");
    }

    return response;
  }

  async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await perform(url, init);

    if (!response.ok) throw await problemFromResponse(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new PropertyProblem(
        "invalid-response",
        "The service response did not match c3-property-v1.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  async function getDossier(projectId: string): Promise<PropertyDossier | null> {
    const url = `/api/c3/projects/${encodeURIComponent(projectId)}/property/dossier`;
    try {
      const response = await perform(url);
      if (response.status === 204) return null;
      if (!response.ok) throw await problemFromResponse(response);
      const payload: unknown = await response.json().catch(() => undefined);
      const parsed = propertyDossierSchema.safeParse(payload);
      if (!parsed.success) {
        throw new PropertyProblem(
          "invalid-response",
          "The service response did not match c3-property-v1.",
          502,
          "INVALID_UPSTREAM_RESPONSE",
        );
      }
      return parsed.data;
    } catch (reason) {
      if (reason instanceof PropertyProblem && reason.kind === "not-found") return null;
      throw reason;
    }
  }

  return Object.freeze({
    getDossier,
    async listSourceRecords(projectId: string): Promise<PropertySourceRecord[]> {
      const response = await request(
        `/api/c3/projects/${encodeURIComponent(projectId)}/property/source-records`,
        propertySourceRecordsResponseSchema,
      );
      return response.sources;
    },
    refreshDossier(projectId: string, expectedVersion: number): Promise<PropertyDossier> {
      const body = refreshPropertyDossierRequestSchema.parse({ expectedVersion });
      return request(
        `/api/c3/projects/${encodeURIComponent(projectId)}/property/dossier/refresh`,
        propertyDossierSchema,
        mutationInit(body),
      );
    },
    resolveProperty(
      projectId: string,
      value: ResolvePropertyRequest,
    ): Promise<PropertyResolutionResponse> {
      const body = resolvePropertyRequestSchema.parse(value);
      return request(
        `/api/c3/projects/${encodeURIComponent(projectId)}/property/resolutions`,
        propertyResolutionResponseSchema,
        mutationInit(body),
      );
    },
    selectProperty(
      projectId: string,
      value: SelectProjectPropertyRequest,
    ): Promise<ProjectProperty> {
      const body = selectProjectPropertyRequestSchema.parse(value);
      return request(
        `/api/c3/projects/${encodeURIComponent(projectId)}/property`,
        projectPropertySchema,
        mutationInit(body, "PUT"),
      );
    },
  });
}

const propertyClient = createPropertyClient();

export const getPropertyDossier = propertyClient.getDossier;
export const listPropertySourceRecords = propertyClient.listSourceRecords;
export const refreshPropertyDossier = propertyClient.refreshDossier;
export const resolveProperty = propertyClient.resolveProperty;
export const selectProjectProperty = propertyClient.selectProperty;
