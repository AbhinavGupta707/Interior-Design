import {
  c13CatalogArtifactSchemaVersion,
  c13CatalogAssetVersionSchemaVersion,
  c13CatalogReleaseSchemaVersion,
  c13CatalogRightsSchemaVersion,
  c13MaterialDefinitionSchemaVersion,
  c13PlacementProjectionSchemaVersion,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  optionJobSchema,
  type Actor,
  type CatalogAssetVersion,
  type C12ConfirmationSource,
  type InteriorAssetRef,
} from "@interior-design/contracts";
import { reduceModelOperations } from "@interior-design/model-operations";
import { randomUUID } from "node:crypto";

import { InMemorySpecificationRepository } from "../../../src/modules/specifications/memory.js";
import { SpecificationService } from "../../../src/modules/specifications/service.js";
import type { SpecificationClock } from "../../../src/modules/specifications/types.js";
import {
  actor,
  assetManifestSha256,
  briefContentSha256,
  briefId,
  correlation,
  constraint,
  modelId,
  nowIso,
  projectId,
  publication,
  sourceRecord,
  userId,
} from "../../c12/support.js";

export { actor, correlation, projectId, userId };

export const releaseId = "c1300000-0000-4000-8000-000000000301";
export const releaseSha256 = "9".repeat(64);
export const confirmationId = "c1300000-0000-4000-8000-000000000302";
export const branchId = "c1300000-0000-4000-8000-000000000303";
export const commitId = "c1300000-0000-4000-8000-000000000304";
export const resultSnapshotId = "c1300000-0000-4000-8000-000000000305";

export class MutableSpecificationClock implements SpecificationClock {
  value = new Date("2026-07-18T14:00:00.000Z");

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.value);
  }
}

function artifact(role: "licence-text" | "model" | "source-receipt" | "thumbnail", index: number) {
  const sha256 = index.toString(16).repeat(64);
  return {
    artifactId: `c1300000-0000-4000-8000-00000000040${String(index)}`,
    byteLength: 64,
    derivation: {
      configurationSha256: "5".repeat(64),
      sourceSha256: [],
      tool: "synthetic-platform-fixture",
      toolVersion: "1",
    },
    ...(role === "thumbnail"
      ? { image: { colourEncoding: "srgb", heightPx: 512, semantic: "thumbnail", widthPx: 512 } }
      : {}),
    mediaType:
      role === "model"
        ? "model/gltf-binary"
        : role === "thumbnail"
          ? "image/png"
          : "text/plain; charset=utf-8",
    objectKey: `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`,
    role,
    schemaVersion: c13CatalogArtifactSchemaVersion,
    sha256,
  } as const;
}

export function wrapCatalogAsset(
  c12Asset: InteriorAssetRef,
  options?: { readonly lifecycle?: "approved" | "withdrawn"; readonly versionSha256?: string },
): CatalogAssetVersion {
  return catalogAssetVersionSchema.parse({
    artifacts: [
      artifact("model", 1),
      artifact("thumbnail", 2),
      artifact("licence-text", 3),
      artifact("source-receipt", 4),
    ],
    assetId: c12Asset.id,
    category: c12Asset.category,
    commercialData: {
      delivery: "not-provided",
      liveAvailability: "not-provided",
      price: "not-provided",
      supplier: "not-provided",
    },
    description: "Creator-authored synthetic platform fixture with no price or availability claim.",
    displayName: `Synthetic ${c12Asset.category}`,
    kind: c12Asset.kind,
    lifecycle: options?.lifecycle ?? "approved",
    materials: [
      {
        baseColourSrgb8: [20, 40, 60],
        emissiveSrgb8: [0, 0, 0],
        materialId: "c1300000-0000-4000-8000-000000000410",
        metallicBasisPoints: 0,
        name: c12Asset.materialLabel,
        opaque: true,
        roughnessBasisPoints: 5_000,
        schemaVersion: c13MaterialDefinitionSchemaVersion,
        textureArtifactIds: [],
        uvSet: 0,
      },
    ],
    placementProjection: {
      c12Asset,
      coordinateTransform: "gltf-front-positive-z-to-interior-forward-positive-y-v1",
      floorCentredPivot: true,
      gltfMetresToInteriorMillimetres: 1_000,
      projectionSha256: "7".repeat(64),
      schemaVersion: c13PlacementProjectionSchemaVersion,
    },
    rights: {
      concludedLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      creator: "Synthetic fixture author",
      declaredLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      grants: {
        commercialUse: true,
        derivatives: true,
        rawRedistribution: false,
        renderedOutputDistribution: true,
        thumbnailDisplay: true,
      },
      licenceTextArtifactSha256: "3".repeat(64),
      policy: { serviceProcessingAllowed: true, trainingAllowed: false },
      recordSha256: c12Asset.rights.rightsRecordSha256,
      review: { reviewedAt: nowIso, reviewerUserId: userId, state: "approved" },
      schemaVersion: c13CatalogRightsSchemaVersion,
      sourceKind: "creator-owned-synthetic",
      sourceReceiptArtifactSha256: "4".repeat(64),
      spdxLicenseListVersion: "3.27.0",
    },
    schemaVersion: c13CatalogAssetVersionSchemaVersion,
    tags: ["synthetic"],
    version: c12Asset.version,
    versionId: c12Asset.versionId,
    versionSha256: options?.versionSha256 ?? "c".repeat(64),
  });
}

const workingSnapshot = {
  ...sourceRecord.snapshot,
  derivedFromSnapshotSha256: sourceRecord.snapshotSha256,
  profile: "proposed" as const,
};

const fixtureJob = optionJobSchema.parse({
  assetManifestSha256,
  attempt: 1,
  baseBrief: { briefId, contentSha256: briefContentSha256, revision: 3 },
  completedAt: nowIso,
  constraints: [constraint],
  constraintsSha256: "a".repeat(64),
  createdAt: nowIso,
  createdBy: userId,
  id: "c1300000-0000-4000-8000-000000000320",
  optionCount: 2,
  projectId,
  requestedDirections: ["circulation-first", "conversation-first"],
  requestedOptionCount: 2,
  retryable: false,
  schemaVersion: "c12-option-job-v1",
  sourceModel: {
    modelId,
    profile: "existing",
    snapshotId: sourceRecord.id,
    snapshotSha256: sourceRecord.snapshotSha256,
    snapshotVersion: sourceRecord.version,
  },
  stage: "complete",
  state: "succeeded",
  updatedAt: nowIso,
  version: 3,
  workingModel: {
    modelId,
    profile: "proposed",
    snapshotId: "c1300000-0000-4000-8000-000000000321",
    snapshotSha256: sourceRecord.snapshotSha256,
    snapshotVersion: 1,
  },
});

const published = publication(fixtureJob, workingSnapshot);
const option = required(published.options[0], "Synthetic published option missing.");
const candidate = reduceModelOperations(workingSnapshot, option.operationBundle.operations);
export const initialCatalogAsset = wrapCatalogAsset(
  only(option.operationBundle.assetPlacements).asset,
);

export const sourceConfirmation: C12ConfirmationSource = {
  acceptedBrief: fixtureJob.baseBrief,
  assetManifestSha256,
  branchId,
  branchRevision: 1,
  bundleId: option.operationBundle.id,
  bundleSha256: option.operationBundle.bundleSha256,
  candidateSnapshotSha256: option.operationBundle.candidateSnapshotSha256,
  commitId,
  confirmationId,
  jobId: fixtureJob.id,
  jobVersion: fixtureJob.version,
  modelId,
  optionId: option.id,
  optionSetSha256: published.optionSet.setSha256,
  profile: "proposed",
  resultSnapshotId,
  resultSnapshotSha256: candidate.snapshotSha256,
  resultSnapshotVersion: 2,
};

export const release = catalogReleaseSchema.parse({
  assetVersionIds: [initialCatalogAsset.versionId, "c1300000-0000-4000-8000-000000000331"],
  createdAt: nowIso,
  manifestSha256: releaseSha256,
  releaseId,
  schemaVersion: c13CatalogReleaseSchemaVersion,
  status: "published",
  version: "1.0.0",
});

export const creationRequest = {
  catalogReleaseId: releaseId,
  catalogReleaseSha256: releaseSha256,
  confirmationId,
};

export function replacementAsset(lifecycle: "approved" | "withdrawn" = "approved") {
  const original = only(option.operationBundle.assetPlacements).asset;
  return wrapCatalogAsset(
    {
      ...original,
      contentSha256: "d".repeat(64),
      geometryEnvelopeMm: { ...original.geometryEnvelopeMm, widthMm: 600 },
      id: "c1300000-0000-4000-8000-000000000330",
      metadataSha256: "e".repeat(64),
      placementPolicy: { ...original.placementPolicy, policySha256: "f".repeat(64) },
      rights: { ...original.rights, rightsRecordSha256: "1".repeat(64) },
      versionId: "c1300000-0000-4000-8000-000000000331",
    },
    { lifecycle, versionSha256: "2".repeat(64) },
  );
}

export function testRuntime(options?: { readonly failScene?: boolean }) {
  const clock = new MutableSpecificationClock();
  const repository = new InMemorySpecificationRepository({ clock });
  repository.creationSources.set(
    InMemorySpecificationRepository.creationKey(
      actor.tenantId,
      projectId,
      confirmationId,
      releaseId,
    ),
    {
      assets: [initialCatalogAsset],
      bundle: option.operationBundle,
      catalogRelease: release,
      catalogReleaseSha256: releaseSha256,
      snapshot: candidate.snapshot,
      source: sourceConfirmation,
    },
  );
  const sceneRequests: unknown[] = [];
  const service = new SpecificationService({
    clock,
    repository,
    sceneJobs: {
      requestExactRevision(input) {
        sceneRequests.push(structuredClone(input));
        return options?.failScene === true
          ? Promise.reject(new Error("Synthetic C10 request failure."))
          : Promise.resolve();
      },
    },
  });
  return { candidate, clock, repository, sceneRequests, service };
}

export async function createSpecification(runtime = testRuntime(), idempotencyKey = randomUUID()) {
  const result = await runtime.service.create({
    actor,
    correlation,
    idempotencyKey,
    projectId,
    request: creationRequest,
  });
  return { ...runtime, createResult: result, specification: result.specification };
}

export function seedReplacement(
  runtime: Awaited<ReturnType<typeof createSpecification>>,
  asset = replacementAsset(),
) {
  const revision = runtime.specification.currentRevision;
  const line = only(revision.lines);
  runtime.repository.substitutionSources.set(
    [actor.tenantId, projectId, runtime.specification.specificationId, asset.versionId].join(":"),
    {
      asset,
      branchRevision: revision.branchRevision,
      branchSnapshotId: revision.modelSnapshotId,
      branchSnapshotSha256: revision.modelSnapshotSha256,
      branchSnapshotVersion: sourceConfirmation.resultSnapshotVersion,
      currentRevision: revision,
      line,
      snapshot: runtime.candidate.snapshot,
      specificationId: runtime.specification.specificationId,
    },
  );
  return asset;
}

export const ownerActor: Actor = actor;

export function only<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined || values.length !== 1) {
    throw new Error(`Expected exactly one synthetic value; received ${String(values.length)}.`);
  }
  return value;
}

export function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
