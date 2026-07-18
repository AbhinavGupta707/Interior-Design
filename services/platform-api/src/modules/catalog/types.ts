import type {
  Actor,
  CatalogArtifact,
  CatalogAssetVersion,
  CatalogRelease,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";

export interface CatalogArtifactAccess {
  readonly artifactId: string;
  readonly byteLength: number;
  readonly expiresAt: string;
  readonly mediaType: CatalogArtifact["mediaType"];
  readonly sha256: string;
  readonly url: string;
}

export interface CatalogAssetListQuery {
  readonly cursor?: string | undefined;
  readonly kind?: "finish" | "furnishing" | "light" | undefined;
  readonly limit: number;
  readonly query?: string | undefined;
  readonly rights?: "approved" | "expired" | "withdrawn" | undefined;
  readonly source?: "creator-owned-synthetic" | "licensed-local" | undefined;
}

export interface CatalogAssetPage {
  readonly assets: readonly CatalogAssetVersion[];
  readonly nextCursor?: string;
  readonly releaseId: string;
  readonly total: number;
}

export interface CatalogAccessAuditCommand {
  readonly actor: Actor;
  readonly artifact: CatalogArtifact;
  readonly correlation: RequestCorrelation;
  readonly projectId: string;
}

export interface CatalogRepository {
  findArtifact(
    tenantId: string,
    projectId: string,
    artifactId: string,
  ): Promise<CatalogArtifact | undefined>;
  findAsset(
    tenantId: string,
    projectId: string,
    releaseId: string,
    assetVersionId: string,
  ): Promise<CatalogAssetVersion | undefined>;
  findRelease(
    tenantId: string,
    projectId: string,
    releaseId: string,
  ): Promise<CatalogRelease | undefined>;
  listAssets(
    tenantId: string,
    projectId: string,
    releaseId: string,
  ): Promise<readonly CatalogAssetVersion[]>;
  listReleases(tenantId: string, projectId: string): Promise<readonly CatalogRelease[]>;
  recordAccess(command: CatalogAccessAuditCommand): Promise<void>;
}

export interface CatalogArtifactStorage {
  available(artifact: CatalogArtifact): Promise<boolean>;
  signAccess(input: {
    readonly artifact: CatalogArtifact;
    readonly expiresAt: Date;
  }): Promise<{ readonly expiresAt: string; readonly url: string }>;
}

export interface CatalogClock {
  now(): Date;
}

export interface CatalogTelemetry {
  record(event: {
    readonly count?: number;
    readonly outcome: "accepted" | "denied" | "missing";
    readonly stage: "artifact-access" | "asset-read" | "release-read" | "selection-check";
  }): void;
}
