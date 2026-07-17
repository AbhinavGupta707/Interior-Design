import type {
  Actor,
  ProjectProperty,
  PropertyDossier,
  PropertyResolutionResponse,
  PropertySourceRecord,
  ResolvePropertyRequest,
  SelectProjectPropertyRequest,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";

interface PropertyCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface ResolvePropertyCommand extends PropertyCommand {
  readonly request: ResolvePropertyRequest;
}

export interface SelectPropertyCommand extends PropertyCommand {
  readonly request: SelectProjectPropertyRequest;
}

export interface RefreshPropertyDossierCommand extends PropertyCommand {
  readonly request: { readonly expectedVersion: number };
}

export interface PropertyBackend {
  getDossier(tenantId: string, projectId: string): Promise<PropertyDossier | undefined>;
  listSourceRecords(
    tenantId: string,
    projectId: string,
  ): Promise<readonly PropertySourceRecord[] | undefined>;
  refreshDossier(command: RefreshPropertyDossierCommand): Promise<PropertyDossier>;
  resolve(command: ResolvePropertyCommand): Promise<PropertyResolutionResponse>;
  select(command: SelectPropertyCommand): Promise<ProjectProperty>;
}
