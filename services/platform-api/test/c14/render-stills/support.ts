import {
  c14RenderArtifactSchemaVersion,
  createRenderJobRequestSchema,
  renderJobSchema,
  renderOutputManifestSchema,
  type RenderArtifact,
  type RenderArtifactRole,
  type RenderJob,
  type RenderSourceReference,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import type {
  RenderEnhancementRecord,
  RenderRepository,
  StoredRenderArtifact,
} from "../../../src/modules/render-stills/types.js";

export const ids = Object.freeze({
  artifact: "14000000-0000-4000-8000-000000000001",
  camera: "14000000-0000-4000-8000-000000000002",
  catalog: "14000000-0000-4000-8000-000000000003",
  job: "14000000-0000-4000-8000-000000000004",
  project: "14000000-0000-4000-8000-000000000005",
  result: "14000000-0000-4000-8000-000000000006",
  scene: "14000000-0000-4000-8000-000000000007",
  sceneArtifact: "14000000-0000-4000-8000-000000000008",
  sceneJob: "14000000-0000-4000-8000-000000000009",
  specification: "14000000-0000-4000-8000-000000000010",
  tenant: "14000000-0000-4000-8000-000000000011",
  user: "14000000-0000-4000-8000-000000000012",
});

export const hash = (character: string): string => character.repeat(64);

export const request = createRenderJobRequestSchema.parse({
  cameraId: ids.camera,
  enhancement: "disabled",
  label: "Geometry-safe fixture",
  lightingPresetId: "canonical-lights-neutral-world-v1",
  profileId: "cycles-cpu-geometry-safe-v1",
  sourceSceneJobId: ids.sceneJob,
  specification: { specificationId: ids.specification, specificationRevision: 2 },
});

export const source: RenderSourceReference = {
  projectId: ids.project,
  sceneArtifactId: ids.sceneArtifact,
  sceneGlbSha256: hash("a"),
  sceneId: ids.scene,
  sceneJobId: ids.sceneJob,
  sceneManifestSha256: hash("b"),
  sourceSnapshotSha256: hash("c"),
  specification: {
    catalogReleaseId: ids.catalog,
    catalogReleaseSha256: hash("d"),
    specificationId: ids.specification,
    specificationRevision: 2,
    specificationRevisionSha256: hash("e"),
  },
};

export function queuedJob(overrides: Partial<RenderJob> = {}): RenderJob {
  return renderJobSchema.parse({
    attempt: 1,
    createdAt: "2026-07-19T00:00:00.000Z",
    createdBy: ids.user,
    id: ids.job,
    projectId: ids.project,
    request,
    state: "queued",
    updatedAt: "2026-07-19T00:00:00.000Z",
    version: 1,
    ...overrides,
  });
}

export function safeBundle() {
  const roles = [
    "geometry-safe-png",
    "multilayer-exr",
    "depth-exr",
    "normal-exr",
    "segmentation-png",
  ] as const;
  const artifactBytes = new Map<RenderArtifactRole, Uint8Array>();
  const artifacts: RenderArtifact[] = roles.map((role, index) => {
    const bytes = Buffer.from(`fixture-${role}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    artifactBytes.set(role, bytes);
    return {
      byteLength: bytes.byteLength,
      heightPx: 64,
      id: `14000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
      mediaType: role.endsWith("-png") ? "image/png" : "image/x-exr",
      role,
      schemaVersion: c14RenderArtifactSchemaVersion,
      sha256,
      widthPx: 64,
    };
  });
  const manifest = renderOutputManifestSchema.parse({
    artifacts,
    authority: "derived-visualisation-only",
    exactByteReplayScope: "same-host-build-script-profile-source",
    hostFingerprintSha256: hash("f"),
    renderSceneManifestSha256: hash("1"),
    renderer: {
      blenderBuildHash: "fixture-build",
      blenderVersion: "fixture-only",
      executableSha256: hash("2"),
      scriptSha256: hash("3"),
    },
    resultId: ids.result,
    schemaVersion: "c14-render-output-manifest-v1",
    source,
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return {
    artifactBytes,
    manifest,
    manifestBytes,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  };
}

function requiredJob(job: RenderJob | undefined): RenderJob {
  if (job === undefined) throw new Error("The C14 repository fixture has no current job.");
  return job;
}

function requiredEnhancement(
  enhancement: RenderEnhancementRecord | undefined,
): RenderEnhancementRecord {
  if (enhancement === undefined)
    throw new Error("The C14 repository fixture has no enhancement child.");
  return enhancement;
}

export class StubRenderRepository implements RenderRepository {
  createdCommand: Parameters<RenderRepository["createJob"]>[0] | undefined;
  job: RenderJob | undefined = queuedJob();
  pinnedSource: RenderSourceReference | undefined = source;
  published = false;
  artifact: StoredRenderArtifact | undefined;
  enhancement: RenderEnhancementRecord | undefined;

  acknowledgeCancellation(): Promise<void> {
    return Promise.resolve();
  }
  assertLease(): Promise<void> {
    return Promise.resolve();
  }
  cancelJob(): Promise<{ readonly job: RenderJob; readonly replayed: boolean }> {
    return Promise.resolve({ job: requiredJob(this.job), replayed: false });
  }
  claimNext(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  createJob(
    command: Parameters<RenderRepository["createJob"]>[0],
  ): Promise<{ readonly job: RenderJob; readonly replayed: boolean }> {
    this.createdCommand = command;
    return Promise.resolve({ job: requiredJob(this.job), replayed: false });
  }
  failAttempt(): Promise<RenderJob> {
    return Promise.resolve(requiredJob(this.job));
  }
  findArtifact(): Promise<StoredRenderArtifact | undefined> {
    return Promise.resolve(this.artifact);
  }
  findEnhancement(): Promise<RenderEnhancementRecord | undefined> {
    return Promise.resolve(this.enhancement);
  }
  findJob(): Promise<RenderJob | undefined> {
    return Promise.resolve(this.job);
  }
  findPinnedSource(): Promise<RenderSourceReference | undefined> {
    return Promise.resolve(this.pinnedSource);
  }
  findResult(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  heartbeat(): Promise<RenderJob> {
    return Promise.resolve(requiredJob(this.job));
  }
  listJobs(): Promise<readonly RenderJob[]> {
    return Promise.resolve(this.job === undefined ? [] : [this.job]);
  }
  publishResult(): Promise<RenderJob> {
    this.published = true;
    return Promise.resolve(requiredJob(this.job));
  }
  recordArtifactAccess(): Promise<void> {
    return Promise.resolve();
  }
  requestEnhancement(): Promise<{
    readonly enhancement: RenderEnhancementRecord;
    readonly replayed: boolean;
  }> {
    return Promise.resolve({ enhancement: requiredEnhancement(this.enhancement), replayed: false });
  }
  retryJob(): Promise<{ readonly job: RenderJob; readonly replayed: boolean }> {
    return Promise.resolve({ job: requiredJob(this.job), replayed: false });
  }
}
