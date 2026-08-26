import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { expect, test, type Page, type Route } from "@playwright/test";

import { dossier as dossierFixture } from "../../../apps/web/test/c3/fixtures";
import { brief as briefFixture } from "../../../apps/web/test/design-consultation/fixtures";
import {
  confirmationA,
  job as optionJob,
  optionA,
  optionB,
  optionSet,
  ownerSession,
  project,
} from "../../../apps/web/test/design-options/fixtures";
import { branch as branchFixture, snapshotRecord } from "../../../apps/web/test/editor-2d/fixtures";
import {
  chairAsset,
  confirmation as substitutionConfirmation,
  finishAsset,
  lightAsset,
  preview as substitutionPreview,
  release,
  sofaAsset,
  specification as specificationFixture,
} from "../../../apps/web/test/materials-products/fixtures";
import { asset as planAsset, job as planJob } from "../../../apps/web/test/plan-import/fixtures";
import {
  availableCapabilities,
  eligibleSources as eligibleSourcesFixture,
  hostCapabilities,
  job as renderJobFixture,
  result as renderResultFixture,
} from "../../../apps/web/test/render-stills/fixtures";
import {
  job as sceneJobFixture,
  scene as sceneFixture,
} from "../../../apps/web/test/viewer-3d/fixtures";

const hash = (value: string) => value.repeat(64);
const id = (value: number) => `c1430000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const source = optionJob.sourceModel;
const acceptedBriefHash = optionJob.baseBrief.contentSha256;
const proposedSnapshotId = id(14);
const proposedSnapshotSha256 = hash("d");
const proposedSceneJobId = id(15);
const renderJobId = id(18);
const renderResultId = id(19);
const safeArtifactId = id(20);

interface AcceptanceState {
  briefAccepted: boolean;
  optionConfirmed: boolean;
  renderCreated: boolean;
  specificationCreated: boolean;
  substitutionConfirmed: boolean;
  readonly mutations: string[];
  readonly requests: string[];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function fixturePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      row[offset] = 184 + (x % 24);
      row[offset + 1] = 150 + (y % 24);
      row[offset + 2] = 112;
      row[offset + 3] = 255;
    }
    return row;
  });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const pngBytes = fixturePng(96, 64);
const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");

const session = {
  ...ownerSession,
  actor: { ...ownerSession.actor, displayName: "Synthetic England apartment homeowner" },
};
const currentSnapshot = {
  ...snapshotRecord,
  id: source.snapshotId,
  modelId: source.modelId,
  projectId: project.id,
  snapshot: {
    ...snapshotRecord.snapshot,
    modelId: source.modelId,
    projectId: project.id,
  },
  snapshotSha256: source.snapshotSha256,
  version: source.snapshotVersion,
};
const branch = {
  ...branchFixture,
  headSnapshotId: source.snapshotId,
  headSnapshotSha256: source.snapshotSha256,
  modelId: source.modelId,
  projectId: project.id,
  revision: 2,
  sourceSnapshotId: id(5),
};
const draftBrief = {
  ...briefFixture,
  acceptedAt: undefined,
  acceptedBy: undefined,
  id: optionJob.baseBrief.briefId,
  modelReference: {
    modelId: source.modelId,
    snapshotId: source.snapshotId,
    snapshotSha256: source.snapshotSha256,
  },
  projectId: project.id,
  revision: optionJob.baseBrief.revision,
  status: "draft" as const,
};
const acceptedBrief = {
  ...draftBrief,
  acceptedAt: "2026-08-25T18:00:00.000Z",
  acceptedBy: session.actor.userId,
  status: "accepted" as const,
};
const evidenceAsset = { ...planAsset, projectId: project.id };
const exactPlanJob = { ...planJob, assetId: evidenceAsset.id, projectId: project.id };
const sourceConfirmation = {
  ...specificationFixture.currentRevision.sourceConfirmation,
  acceptedBrief: optionJob.baseBrief,
  confirmationId: confirmationA.id,
  jobId: optionJob.id,
  jobVersion: optionJob.version,
  modelId: source.modelId,
  optionId: optionA.id,
  resultSnapshotId: id(13),
  resultSnapshotSha256: confirmationA.resultSnapshotSha256,
  resultSnapshotVersion: 1,
};
const initialSpecification = {
  ...specificationFixture,
  currentRevision: {
    ...specificationFixture.currentRevision,
    modelSnapshotId: sourceConfirmation.resultSnapshotId,
    modelSnapshotSha256: sourceConfirmation.resultSnapshotSha256,
    sourceConfirmation,
  },
  projectId: project.id,
};
const evolvedSpecification = {
  ...initialSpecification,
  currentRevision: {
    ...initialSpecification.currentRevision,
    branchRevision: initialSpecification.currentRevision.branchRevision + 1,
    modelSnapshotId: proposedSnapshotId,
    modelSnapshotSha256: proposedSnapshotSha256,
    revision: 2,
    revisionSha256: hash("e"),
    lines: initialSpecification.currentRevision.lines.map((line, index) =>
      index === 0
        ? {
            ...line,
            assetContentSha256: sofaAsset.placementProjection.c12Asset.contentSha256,
            assetMetadataSha256: sofaAsset.placementProjection.c12Asset.metadataSha256,
            assetVersionId: sofaAsset.versionId,
            assetVersionSha256: sofaAsset.versionSha256,
            placementPolicySha256:
              sofaAsset.placementProjection.c12Asset.placementPolicy.policySha256,
            placementProjectionSha256: sofaAsset.placementProjection.projectionSha256,
            rightsRecordSha256: sofaAsset.rights.recordSha256,
            selectionSource: {
              confirmationId: substitutionConfirmation.confirmationId,
              kind: "confirmed-substitution" as const,
            },
          }
        : line,
    ),
  },
  selectionBoard: { ...initialSpecification.selectionBoard, revision: 2 },
};

function existingSceneJob() {
  return {
    ...sceneJobFixture,
    id: id(6),
    projectId: project.id,
    request: {
      ...sceneJobFixture.request,
      label: "Confirmed one-bedroom apartment twin",
      sourceSnapshot: {
        modelId: source.modelId,
        profile: "existing" as const,
        projectId: project.id,
        schemaVersion: "c4-canonical-home-v1" as const,
        snapshotId: source.snapshotId,
        snapshotSha256: source.snapshotSha256,
      },
    },
    sceneId: id(7),
  };
}

function proposedSceneJob() {
  return {
    ...sceneJobFixture,
    id: proposedSceneJobId,
    projectId: project.id,
    request: {
      ...sceneJobFixture.request,
      label: "Specification revision 2",
      sourceSnapshot: {
        modelId: source.modelId,
        profile: "proposed" as const,
        projectId: project.id,
        schemaVersion: "c4-canonical-home-v1" as const,
        snapshotId: proposedSnapshotId,
        snapshotSha256: proposedSnapshotSha256,
      },
    },
    sceneId: id(16),
  };
}

function proposedScene() {
  const job = proposedSceneJob();
  const manifest = { ...sceneFixture.manifest, sourceSnapshot: job.request.sourceSnapshot };
  return {
    ...sceneFixture,
    artifact: {
      ...sceneFixture.artifact,
      manifestSha256: createHash("sha256").update(canonicalJson(manifest)).digest("hex"),
    },
    id: job.sceneId,
    manifest,
    projectId: project.id,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported synthetic canonical value.");
}

function renderCapabilities() {
  return {
    ...availableCapabilities,
    sources: [
      {
        cameras: availableCapabilities.sources[0]?.cameras ?? [],
        label: "Synthetic exact C13-backed proposed apartment scene",
        sourceSceneJobId: proposedSceneJobId,
        specifications: [
          {
            label: "Selected apartment design · specification revision 2",
            specificationId: initialSpecification.specificationId,
            specificationRevision: 2,
          },
        ],
      },
    ],
  };
}

function renderEligibleSources() {
  const fixture = eligibleSourcesFixture.sources[0];
  if (!fixture) throw new Error("Expected synthetic render eligibility fixture");
  return {
    projectId: project.id,
    schemaVersion: "c14-render-eligible-sources-v1" as const,
    sources: [
      {
        cameras: fixture.cameras,
        label: "Synthetic exact C13-backed proposed apartment scene",
        source: {
          ...fixture.source,
          projectId: project.id,
          sceneJobId: proposedSceneJobId,
          specification: {
            ...fixture.source.specification,
            specificationId: initialSpecification.specificationId,
            specificationRevision: 2,
          },
        },
      },
    ],
  };
}

function renderJob() {
  const cameraId = renderCapabilities().sources[0]?.cameras[0]?.cameraId;
  if (!cameraId) throw new Error("Expected synthetic render camera");
  return {
    ...renderJobFixture,
    createdBy: session.actor.userId,
    id: renderJobId,
    projectId: project.id,
    request: {
      ...renderJobFixture.request,
      cameraId,
      enhancement: "disabled" as const,
      label: "Homeowner proposed living room still",
      sourceSceneJobId: proposedSceneJobId,
      specification: {
        specificationId: initialSpecification.specificationId,
        specificationRevision: 2,
      },
    },
    resultId: renderResultId,
  };
}

function renderResult() {
  const job = renderJob();
  const artifact = {
    ...renderResultFixture.manifest.artifacts[0],
    byteLength: pngBytes.byteLength,
    heightPx: 64,
    id: safeArtifactId,
    mediaType: "image/png" as const,
    role: "geometry-safe-png" as const,
    sha256: pngSha256,
    widthPx: 96,
  };
  const diagnostics = renderResultFixture.manifest.artifacts.slice(1).map((item) =>
    item.role === "segmentation-png"
      ? {
          ...item,
          byteLength: pngBytes.byteLength,
          heightPx: 64,
          sha256: pngSha256,
          widthPx: 96,
        }
      : item,
  );
  return {
    ...renderResultFixture,
    id: renderResultId,
    jobId: job.id,
    manifest: {
      ...renderResultFixture.manifest,
      artifacts: [artifact, ...diagnostics],
      resultId: renderResultId,
      source: {
        ...renderResultFixture.manifest.source,
        projectId: project.id,
        sceneJobId: proposedSceneJobId,
        specification: {
          ...renderResultFixture.manifest.source.specification,
          specificationId: initialSpecification.specificationId,
          specificationRevision: 2,
        },
      },
    },
    manifestSha256: hash("9"),
    projectId: project.id,
  };
}

function renderEnhancement() {
  const artifacts = renderResult().manifest.artifacts;
  const shaFor = (role: string) => {
    const artifact = artifacts.find((item) => item.role === role);
    if (!artifact) throw new Error(`Expected synthetic ${role} artifact`);
    return artifact.sha256;
  };
  return {
    baseArtifactSha256: shaFor("geometry-safe-png"),
    conditioningSha256: {
      depth: shaFor("depth-exr"),
      normal: shaFor("normal-exr"),
      segmentation: shaFor("segmentation-png"),
    },
    schemaVersion: "c14-enhancement-result-v1" as const,
    state: "not-requested" as const,
  };
}

async function fulfil(route: Route, value: unknown, status = 200): Promise<void> {
  await route.fulfill({
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    contentType: "application/json",
    status,
  });
}

async function installFixture(page: Page, state: AcceptanceState): Promise<void> {
  await page.route("http://127.0.0.1:4365/signed/*.png**", async (route) => {
    await route.fulfill({
      body: pngBytes,
      headers: {
        "content-length": String(pngBytes.byteLength),
        "content-type": "image/png",
      },
      status: 200,
    });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.requests.push(`${request.method()} ${path}`);
    const method = request.method();
    const projectBase = `/api/c1/projects/${project.id}`;
    const c13 = `/api/c13/projects/${project.id}`;
    const specification = state.substitutionConfirmed ? evolvedSpecification : initialSpecification;

    if (path === "/api/c1/session") return fulfil(route, session);
    if (path === "/api/c1/projects") return fulfil(route, [project]);
    if (path === projectBase) return fulfil(route, project);
    if (path === `${projectBase}/intake`)
      return fulfil(route, {
        intake: {
          accessibilityNeeds: [],
          bathrooms: 1,
          bedrooms: 1,
          dwellingType: "flat",
          evidenceAvailable: {
            photographs: false,
            plans: true,
            roomCapture: false,
            video: false,
          },
          goals: ["Create a warm, calm living space with better circulation"],
          household: { adults: 2, children: 0, pets: 0 },
          levels: 1,
          mustChange: ["Improve evening lighting"],
          mustKeep: ["Keep the dining table"],
          styleWords: ["warm", "mineral", "quiet"],
        },
        projectId: project.id,
        updatedAt: "2026-08-25T17:00:00.000Z",
        updatedBy: session.actor.userId,
        version: 3,
      });
    if (path === `/api/c3/projects/${project.id}/property/dossier`)
      return fulfil(route, dossierFixture);
    if (path === `/api/c2/projects/${project.id}/assets`) return fulfil(route, [evidenceAsset]);
    if (path === `/api/c5/projects/${project.id}/models/existing/source`)
      return fulfil(route, currentSnapshot);
    if (path === `/api/c5/projects/${project.id}/models/existing/branches`)
      return fulfil(route, { branches: [branch], profile: "existing", projectId: project.id });
    if (path === `/api/c6/projects/${project.id}/workspace`)
      return fulfil(route, {
        assets: [evidenceAsset],
        branches: [branch],
        jobs: [exactPlanJob],
        project,
        session,
      });
    if (path === `/api/c8/projects/${project.id}/workspace`)
      return fulfil(route, {
        assets: [],
        capabilities: {
          appearanceProvider: "unavailable",
          geometryWorker: "unavailable",
          gpu: "unavailable",
        },
        jobs: [],
        project,
        session,
      });
    if (path === `/api/c9/projects/${project.id}/workspace`)
      return fulfil(route, {
        branches: [branch],
        capabilities: { geometryProducer: "unavailable", semanticProducer: "unavailable" },
        jobs: [],
        project,
        session,
        sources: [],
      });
    if (path === `/api/c10/projects/${project.id}/workspace`)
      return fulfil(route, {
        evidenceClassification: "fixture-presentation",
        jobs: [...(state.substitutionConfirmed ? [proposedSceneJob()] : []), existingSceneJob()],
        project,
        session,
        snapshots: [
          {
            modelId: source.modelId,
            profile: "existing" as const,
            projectId: project.id,
            schemaVersion: "c4-canonical-home-v1" as const,
            snapshotId: source.snapshotId,
            snapshotSha256: source.snapshotSha256,
          },
          ...(state.substitutionConfirmed
            ? [
                {
                  modelId: source.modelId,
                  profile: "proposed" as const,
                  projectId: project.id,
                  schemaVersion: "c4-canonical-home-v1" as const,
                  snapshotId: proposedSnapshotId,
                  snapshotSha256: proposedSnapshotSha256,
                },
              ]
            : []),
        ],
      });
    if (path === `/api/c10/projects/${project.id}/scene-jobs/${proposedSceneJobId}`)
      return fulfil(route, proposedSceneJob());
    if (path === `/api/c10/projects/${project.id}/scene-jobs/${proposedSceneJobId}/scene`)
      return fulfil(route, proposedScene());

    if (path === `/api/c11/projects/${project.id}/workspace`)
      return fulfil(route, {
        brief: state.briefAccepted ? acceptedBrief : draftBrief,
        briefContentSha256: acceptedBriefHash,
        capability: {
          activeAdapter: "deterministic-local-v1",
          evidenceClassification: "fixture-presentation",
          externalNetworkUsed: false,
          externalProviders: "disabled",
        },
        intake: null,
        project,
        session,
      });
    if (path === `/api/c11/projects/${project.id}/design-brief/accept` && method === "POST") {
      state.briefAccepted = true;
      state.mutations.push("c11.brief.accept");
      return fulfil(route, acceptedBrief);
    }

    const jobs = `/api/c12/projects/${project.id}/design-option-jobs`;
    if (path === jobs && method === "GET")
      return fulfil(route, { jobs: [optionJob], projectId: project.id });
    if (path === `${jobs}/${optionJob.id}`) return fulfil(route, optionJob);
    if (path === `${jobs}/${optionJob.id}/options`)
      return fulfil(route, {
        jobId: optionJob.id,
        optionSet,
        options: [optionA, optionB].map((option) =>
          state.optionConfirmed && option.id === optionA.id
            ? { ...option, status: "confirmed" }
            : option,
        ),
        projectId: project.id,
      });
    if (path === `${jobs}/${optionJob.id}/options/${optionA.id}/confirm` && method === "POST") {
      state.optionConfirmed = true;
      state.mutations.push("c12.option.confirm");
      return fulfil(route, confirmationA);
    }
    if (
      path === `${jobs}/${optionJob.id}/options/${optionA.id}/confirmation` &&
      method === "GET" &&
      state.optionConfirmed
    )
      return fulfil(route, confirmationA);

    if (path === `${c13}/catalog/releases`) return fulfil(route, { releases: [release] });
    if (path === `${c13}/catalog/releases/${release.releaseId}`) return fulfil(route, release);
    if (path === `${c13}/catalog/releases/${release.releaseId}/assets`)
      return fulfil(route, {
        assets: [chairAsset, sofaAsset, finishAsset, lightAsset],
        releaseId: release.releaseId,
        total: 4,
      });
    if (path.startsWith(`${c13}/catalog/releases/${release.releaseId}/assets/`)) {
      const assetId = path.split("/").at(-1);
      const asset = [chairAsset, sofaAsset, finishAsset, lightAsset].find(
        ({ versionId }) => versionId === assetId,
      );
      return asset ? fulfil(route, asset) : fulfil(route, { detail: "Not found" }, 404);
    }
    if (path === `${c13}/specifications`)
      return fulfil(route, {
        projectId: project.id,
        specifications: state.specificationCreated ? [specification] : [],
      });
    if (path === `${c13}/specifications/from-c12-confirmation` && method === "POST") {
      state.specificationCreated = true;
      state.mutations.push("c13.specification.create");
      return fulfil(route, initialSpecification, 201);
    }
    const specBase = `${c13}/specifications/${initialSpecification.specificationId}`;
    if (path === specBase) return fulfil(route, specification);
    if (path === `${specBase}/revisions`)
      return fulfil(route, {
        revisions: state.substitutionConfirmed
          ? [initialSpecification.currentRevision, evolvedSpecification.currentRevision]
          : [initialSpecification.currentRevision],
        specificationId: initialSpecification.specificationId,
      });
    if (path === `${specBase}/schedule-lines`)
      return fulfil(route, {
        lines: specification.currentRevision.lines,
        revision: specification.currentRevision.revision,
        specificationId: specification.specificationId,
      });
    if (path === `${specBase}/substitutions` && method === "POST") {
      state.mutations.push("c13.substitution.preview");
      return fulfil(route, {
        ...substitutionPreview,
        baseSnapshotId: initialSpecification.currentRevision.modelSnapshotId,
        baseSnapshotSha256: initialSpecification.currentRevision.modelSnapshotSha256,
        elementId: initialSpecification.currentRevision.lines[0]?.elementId,
        replacementAssetVersionId: sofaAsset.versionId,
        specificationId: initialSpecification.specificationId,
        specificationRevision: 1,
      });
    }
    if (
      path === `${specBase}/substitutions/${substitutionPreview.previewId}/confirm` &&
      method === "POST"
    ) {
      state.substitutionConfirmed = true;
      state.mutations.push("c13.substitution.confirm");
      return fulfil(route, {
        confirmation: {
          ...substitutionConfirmation,
          elementId: initialSpecification.currentRevision.lines[0]?.elementId,
          resultSnapshotId: proposedSnapshotId,
          resultSnapshotSha256: proposedSnapshotSha256,
          sceneJobId: proposedSceneJobId,
          specificationId: initialSpecification.specificationId,
          specificationRevision: 2,
        },
        sceneRequestState: "requested",
      });
    }

    const c14 = `/api/c14/projects/${project.id}`;
    if (path === `${c14}/render-capabilities`) return fulfil(route, hostCapabilities);
    if (path === `${c14}/render-eligible-sources`) return fulfil(route, renderEligibleSources());
    if (path === `${c14}/render-jobs` && method === "GET")
      return fulfil(route, { jobs: state.renderCreated ? [renderJob()] : [] });
    if (path === `${c14}/render-jobs` && method === "POST") {
      state.renderCreated = true;
      state.mutations.push("c14.render.create");
      return fulfil(route, renderJob(), 201);
    }
    if (path === `${c14}/render-jobs/${renderJobId}/result`) return fulfil(route, renderResult());
    if (path === `${c14}/render-jobs/${renderJobId}/enhancement`)
      return fulfil(route, renderEnhancement());
    const artifactAccessMatch = path.match(
      new RegExp(`^${c14}/render-jobs/${renderJobId}/artifacts/([^/]+)/access$`),
    );
    if (artifactAccessMatch) {
      const artifact = renderResult().manifest.artifacts.find(
        ({ id: artifactId }) => artifactId === artifactAccessMatch[1],
      );
      if (!artifact || artifact.mediaType !== "image/png")
        return fulfil(route, { detail: "Not found", status: 404, title: "Not found" }, 404);
      return fulfil(route, {
        artifactId: artifact.id,
        byteLength: artifact.byteLength,
        expiresAt: "2099-08-25T20:00:00.000Z",
        manifestSha256: renderResult().manifestSha256,
        mediaType: artifact.mediaType,
        role: artifact.role,
        sha256: artifact.sha256,
        url: `http://127.0.0.1:4365/signed/${artifact.id}.png?fixture=creator-owned`,
      });
    }

    return fulfil(route, { detail: `Unhandled synthetic route ${method} ${path}` }, 404);
  });
}

test("@workflow confirmed twin continues through useful design choices and a verified still", async ({
  context,
  page,
}) => {
  const state: AcceptanceState = {
    briefAccepted: false,
    mutations: [],
    optionConfirmed: false,
    renderCreated: false,
    requests: [],
    specificationCreated: false,
    substitutionConfirmed: false,
  };
  await installFixture(page, state);
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "hds_c1_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "synthetic-owner-token",
    },
  ]);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/projects");
  await page.getByRole("link", { name: "Resume home journey" }).click();
  await expect(page.getByText("Phase 2 · Design your home")).toBeVisible();
  await expect(page.getByText("Shape and accept the design brief").first()).toBeVisible();
  await page.getByRole("link", { name: "Continue and accept the brief" }).first().click();

  await page.getByLabel(/I reviewed this exact revision, including conflicts/iu).check();
  await page.getByRole("button", { name: /Accept revision/iu }).click();
  await page.getByRole("link", { name: "Generate two valid design options" }).click();
  await expect(page.getByText("Asset inventory: different")).toBeVisible();
  await page
    .getByLabel(/I reviewed this option’s exact pins/iu)
    .first()
    .check();
  await page.getByRole("button", { name: "Confirm this option" }).first().click();
  await page.getByRole("link", { name: "Build the room specification" }).click();

  const sofa = page.locator("li").filter({ hasText: "Generic compact sofa" });
  await sofa.getByRole("button", { name: /^Use Generic compact sofa version/iu }).click();
  await page.getByRole("button", { name: "Prepare bounded preview" }).click();
  await page
    .getByLabel(/I understand confirmation creates an immutable specification revision/iu)
    .check();
  await page.getByRole("button", { name: "Confirm exact substitution" }).click();
  await page.getByRole("link", { name: new RegExp(`Open exact C10 scene job`) }).click();

  await expect(page.getByText("Specification revision 2").first()).toBeVisible();
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  await expect(page.getByText("Exact DOM scene summary")).toBeVisible();
  await page.getByRole("link", { name: "← Home journey" }).click();
  await page.getByRole("link", { name: "Create geometry-safe still" }).first().click();
  await expect(page.getByLabel("Source scene")).toHaveValue(proposedSceneJobId);
  await page.getByRole("button", { name: "Create geometry-safe still job" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Geometry-locked deterministic render",
    }),
  ).toBeVisible();
  await expect(page.getByText(/Verified in this tab/iu).first()).toBeVisible();

  await page.getByRole("link", { name: "Home journey" }).click();
  await expect(
    page.getByRole("heading", { name: "Create geometry-safe stills" }).last(),
  ).toBeVisible();
  await expect(page.getByText("complete", { exact: true }).last()).toBeVisible();
  expect(state.mutations).toEqual([
    "c11.brief.accept",
    "c12.option.confirm",
    "c13.specification.create",
    "c13.substitution.preview",
    "c13.substitution.confirm",
    "c14.render.create",
  ]);
  expect(state.requests.some((value) => value.includes("/api/c8-v2"))).toBe(false);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: "/tmp/c14-3-homeowner-design-studio-final.png",
  });
});
