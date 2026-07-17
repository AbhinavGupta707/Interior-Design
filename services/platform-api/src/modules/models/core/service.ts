import {
  modelProfilesResponseSchema,
  type ModelProfile,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import type { GeometryFinding } from "@interior-design/geometry-kernel";

import { ApiError } from "../../../errors.js";
import type {
  CanonicalGeometryValidator,
  CanonicalModelRepository,
  CanonicalSnapshotCodec,
  CreateCanonicalSnapshotCommand,
  CreateCanonicalSnapshotResult,
  RetainedGeometryFinding,
} from "./types.js";
import { canonicalModelProfiles } from "./types.js";

const maximumRetainedFindingCount = 10_000;
export const maximumCanonicalSnapshotByteLength = 10_485_760;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findingKey(finding: GeometryFinding): string {
  const location = finding.location;
  return [
    finding.severity,
    finding.code,
    [...finding.affectedElementIds].sort(compareStrings).join(","),
    location?.levelId ?? "",
    location === undefined ? "" : String(location.xMm),
    location === undefined ? "" : String(location.yMm),
    finding.message,
  ].join("\u0000");
}

function normalizedFindings(findings: readonly GeometryFinding[]): readonly GeometryFinding[] {
  if (findings.length > maximumRetainedFindingCount) {
    throw new Error("Geometry validation exceeded the bounded C4 finding limit.");
  }
  return findings
    .map((finding) => ({
      ...finding,
      affectedElementIds: [...finding.affectedElementIds].sort(compareStrings),
      ...(finding.location === undefined ? {} : { location: { ...finding.location } }),
    }))
    .sort((left, right) => compareStrings(findingKey(left), findingKey(right)));
}

export class CanonicalGeometryValidationError extends Error {
  readonly findings: readonly GeometryFinding[];

  constructor(findings: readonly GeometryFinding[]) {
    super("Canonical geometry contains blocking validation findings.");
    this.name = "CanonicalGeometryValidationError";
    this.findings = findings;
  }
}

export class CanonicalModelService {
  readonly #codec: CanonicalSnapshotCodec;
  readonly #geometry: CanonicalGeometryValidator;
  readonly #repository: CanonicalModelRepository;

  constructor(
    repository: CanonicalModelRepository,
    codec: CanonicalSnapshotCodec,
    geometry: CanonicalGeometryValidator,
  ) {
    this.#repository = repository;
    this.#codec = codec;
    this.#geometry = geometry;
  }

  async createSnapshot(
    command: CreateCanonicalSnapshotCommand,
  ): Promise<CreateCanonicalSnapshotResult> {
    const canonical = this.#codec.encode(command.snapshot);
    if (canonical.canonicalByteLength > maximumCanonicalSnapshotByteLength) {
      throw new ApiError({
        code: "CANONICAL_SNAPSHOT_TOO_LARGE",
        detail: "The canonical snapshot exceeds the 10 MiB record limit.",
        statusCode: 413,
        title: "Canonical Snapshot Too Large",
      });
    }
    const findings = normalizedFindings(this.#geometry(canonical.snapshot));
    const errors = findings.filter((finding) => finding.severity === "error");
    if (errors.length > 0) {
      throw new CanonicalGeometryValidationError(errors);
    }
    const retainedGeometryFindings = findings.filter(
      (finding): finding is RetainedGeometryFinding => finding.severity !== "error",
    );
    return this.#repository.createSnapshot({
      ...command,
      canonical,
      retainedGeometryFindings,
      snapshot: canonical.snapshot,
    });
  }

  getCurrentSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
  ): Promise<ModelSnapshotRecord | undefined> {
    return this.#repository.getCurrentSnapshot(tenantId, projectId, profile);
  }

  getSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    snapshotId: string,
  ): Promise<ModelSnapshotRecord | undefined> {
    return this.#repository.getSnapshot(tenantId, projectId, profile, snapshotId);
  }

  async listProfiles(tenantId: string, projectId: string) {
    const available = await this.#repository.listAvailableProfiles(tenantId, projectId);
    const byProfile = new Map(available.map((summary) => [summary.profile, summary]));
    return modelProfilesResponseSchema.parse({
      profiles: canonicalModelProfiles.map(
        (profile) => byProfile.get(profile) ?? { profile, status: "empty" },
      ),
      projectId,
    });
  }
}
