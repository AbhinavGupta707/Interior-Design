/**
 * Bounded, repository-owned C14 host acceptance. This is intentionally a
 * standalone command rather than a default test: it invokes a real local
 * Blender process and writes retained synthetic evidence only when explicitly
 * given a new repository-relative output directory.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  BundledOiioExrInspector,
  C10ProtectedGlbInspector,
  FixedArgumentRendererProcess,
  IsolatedStillRenderer,
  rendererArtifactFileNames,
} from "../src/index.js";
import { buildRenderScene } from "@interior-design/render-scene";
import { compareProtectedImageGeometry } from "../../../packages/render-evaluation/src/index.js";
import type { RenderArtifactRole, RenderProfile } from "@interior-design/contracts";
import { renderFixture } from "../../../packages/render-scene/test/support.js";

const execFile = promisify(execFileCallback);
const gibibyte = 1024 * 1024 * 1024;
const minimumFreeBytes = 20 * gibibyte;
const smokeProfile = { heightPx: 64, samples: 1, threads: 1, widthPx: 64 } as const;
const acceptanceProfile = { heightPx: 256, samples: 16, threads: 1, widthPx: 256 } as const;
const renderTimeoutMilliseconds = 45_000;
const maximumProcessOutputBytes = 65_536;
const artifactRoles = [
  "geometry-safe-png",
  "multilayer-exr",
  "depth-exr",
  "normal-exr",
  "segmentation-png",
] as const satisfies readonly Exclude<RenderArtifactRole, "illustrative-enhancement-png">[];

interface BlenderIdentity {
  readonly buildHash: string;
  readonly version: string;
}

interface AcceptanceArguments {
  readonly blenderPath: string;
  readonly outputDirectory: string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function repositoryRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

function parseArguments(arguments_: readonly string[]): AcceptanceArguments {
  const outputIndex = arguments_.indexOf("--output-directory");
  assert(outputIndex >= 0, "C14_OUTPUT_DIRECTORY_REQUIRED");
  const suppliedOutput = arguments_[outputIndex + 1];
  assert(
    typeof suppliedOutput === "string" && suppliedOutput.length > 0,
    "C14_OUTPUT_DIRECTORY_REQUIRED",
  );
  assert(arguments_.length === 2, "C14_ACCEPTANCE_ARGUMENTS_INVALID");
  const root = repositoryRoot();
  const outputDirectory = path.resolve(root, suppliedOutput);
  const relative = path.relative(root, outputDirectory);
  assert(
    relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== "..",
    "C14_OUTPUT_DIRECTORY_OUTSIDE_REPOSITORY",
  );
  return {
    blenderPath:
      process.env.C14_ACCEPTANCE_BLENDER_PATH ??
      "/opt/homebrew/Caskroom/blender/5.2.0/blender.wrapper.sh",
    outputDirectory,
  };
}

async function regularFile(pathname: string): Promise<Uint8Array> {
  const stat = await lstat(pathname);
  assert(stat.isFile() && !stat.isSymbolicLink(), "C14_ACCEPTANCE_FILE_INVALID");
  return readFile(pathname);
}

async function blenderIdentity(blenderPath: string): Promise<BlenderIdentity> {
  const result = await execFile(blenderPath, ["--version"], {
    encoding: "utf8",
    maxBuffer: maximumProcessOutputBytes,
    timeout: 10_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const version = output.match(/^Blender ([^\r\n]+)$/mu)?.[1]?.trim();
  const buildHash = output.match(/^\s*build hash:\s*([a-f0-9]{7,120})\s*$/imu)?.[1];
  assert(version !== undefined && buildHash !== undefined, "C14_BLENDER_IDENTITY_UNAVAILABLE");
  return { buildHash, version };
}

async function freeBytes(pathname: string): Promise<number> {
  const filesystem = await statfs(pathname);
  return Number(filesystem.bavail) * Number(filesystem.bsize);
}

function profile(
  identity: BlenderIdentity,
  dimensions: typeof smokeProfile | typeof acceptanceProfile,
): RenderProfile {
  return {
    blenderBuildHash: identity.buildHash,
    blenderVersion: identity.version,
    colourManagement: {
      displayDevice: "sRGB",
      look: "AgX - Medium High Contrast",
      viewTransform: "AgX",
    },
    denoise: "none",
    device: "cpu",
    engine: "cycles",
    heightPx: dimensions.heightPx,
    profileId: "cycles-cpu-geometry-safe-v1",
    samples: dimensions.samples,
    seed: 14,
    threads: dimensions.threads,
    transparentBackground: false,
    widthPx: dimensions.widthPx,
  };
}

async function runBundle(options: {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly exrInspectorPath: string;
  readonly exrInspectorSha256: string;
  readonly hostFingerprintSha256: string;
  readonly identity: BlenderIdentity;
  readonly rendererScriptPath: string;
  readonly rendererScriptSha256: string;
  readonly resultId: string;
  readonly settings: typeof smokeProfile | typeof acceptanceProfile;
  readonly workspaceRoot: string;
}) {
  const fixture = renderFixture({ cameraTarget: { xMm: 0, yMm: 0, zMm: 500 } });
  const built = buildRenderScene({
    ...fixture.input,
    profile: profile(options.identity, options.settings),
    rendererScriptSha256: options.rendererScriptSha256,
  });
  const renderer = new IsolatedStillRenderer({
    descriptor: {
      executablePath: options.executablePath,
      executableSha256: options.executableSha256,
      rendererScriptPath: options.rendererScriptPath,
      rendererScriptSha256: options.rendererScriptSha256,
    },
    exrInspector: new BundledOiioExrInspector({
      descriptor: {
        executablePath: options.executablePath,
        executableSha256: options.executableSha256,
        inspectorScriptPath: options.exrInspectorPath,
        inspectorScriptSha256: options.exrInspectorSha256,
      },
      timeoutMilliseconds: renderTimeoutMilliseconds,
      workspaceRoot: options.workspaceRoot,
    }),
    glbInspector: new C10ProtectedGlbInspector(),
    hostFingerprintSha256: options.hostFingerprintSha256,
    maximumOutputBytes: maximumProcessOutputBytes,
    process: new FixedArgumentRendererProcess(),
    timeoutMilliseconds: renderTimeoutMilliseconds,
    workspaceRoot: options.workspaceRoot,
  });
  const manifestBytes = built.canonicalBytes();
  return renderer.render(
    {
      glbBytes: fixture.input.sceneGlb,
      glbSha256: fixture.input.scene.artifact.glbSha256,
      renderSceneManifest: built.manifest,
      renderSceneManifestBytes: manifestBytes,
      renderSceneManifestSha256: built.envelope.sha256,
      resultId: options.resultId,
    },
    AbortSignal.timeout(renderTimeoutMilliseconds + 5_000),
  );
}

async function writePrimaryBundle(
  directory: string,
  bundle: Awaited<ReturnType<typeof runBundle>>,
  renderScene: Uint8Array,
): Promise<void> {
  for (const role of artifactRoles) {
    const bytes = bundle.artifactBytes.get(role);
    assert(bytes !== undefined, "C14_ACCEPTANCE_ARTIFACT_MISSING");
    await writeFile(path.join(directory, rendererArtifactFileNames[role]), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
  await writeFile(path.join(directory, "render-output-manifest.json"), bundle.manifestBytes, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(path.join(directory, "render-scene.json"), renderScene, {
    flag: "wx",
    mode: 0o600,
  });
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  await access(arguments_.outputDirectory)
    .then(() => Promise.reject(new Error("C14_OUTPUT_DIRECTORY_EXISTS")))
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    });
  const rendererRoot = path.resolve(import.meta.dirname, "..");
  const rendererScriptPath = path.join(rendererRoot, "renderer", "c14_render.py");
  const exrInspectorPath = path.join(rendererRoot, "renderer", "c14_inspect_exr.py");
  const [executableBytes, rendererScriptBytes, exrInspectorBytes, identity] = await Promise.all([
    regularFile(arguments_.blenderPath),
    regularFile(rendererScriptPath),
    regularFile(exrInspectorPath),
    blenderIdentity(arguments_.blenderPath),
  ]);
  const workspaceRoot = await mkdir(path.join(tmpdir(), "c14-host-acceptance"), {
    mode: 0o700,
    recursive: true,
  }).then(() => path.join(tmpdir(), "c14-host-acceptance"));
  const workspaceStat = await lstat(workspaceRoot);
  assert(
    workspaceStat.isDirectory() && !workspaceStat.isSymbolicLink(),
    "C14_WORKSPACE_ROOT_INVALID",
  );
  const availableBytes = await freeBytes(workspaceRoot);
  assert(availableBytes >= minimumFreeBytes, "C14_DISK_ADMISSION_DENIED");
  const hostFingerprintSha256 = sha256(
    JSON.stringify({
      blenderBuildHash: identity.buildHash,
      blenderVersion: identity.version,
      platform: process.platform,
      processArchitecture: process.arch,
      profileId: "cycles-cpu-geometry-safe-v1",
    }),
  );
  const common = {
    executablePath: arguments_.blenderPath,
    executableSha256: sha256(executableBytes),
    exrInspectorPath,
    exrInspectorSha256: sha256(exrInspectorBytes),
    hostFingerprintSha256,
    identity,
    rendererScriptPath,
    rendererScriptSha256: sha256(rendererScriptBytes),
    workspaceRoot,
  };
  try {
    const smoke = await runBundle({ ...common, resultId: randomUUID(), settings: smokeProfile });
    assert(smoke.artifacts.length === artifactRoles.length, "C14_SMOKE_ARTIFACT_SET_INVALID");
    const primary = await runBundle({
      ...common,
      resultId: randomUUID(),
      settings: acceptanceProfile,
    });
    const replay = await runBundle({
      ...common,
      resultId: randomUUID(),
      settings: acceptanceProfile,
    });
    const replayByteEquality = Object.fromEntries(
      artifactRoles.map((role) => {
        const first = primary.artifactBytes.get(role);
        const second = replay.artifactBytes.get(role);
        assert(first !== undefined && second !== undefined, "C14_REPLAY_ARTIFACT_MISSING");
        return [role, sha256(first) === sha256(second)];
      }),
    );
    const primarySafe = primary.artifactBytes.get("geometry-safe-png");
    const replaySafe = replay.artifactBytes.get("geometry-safe-png");
    const primarySegmentation = primary.artifactBytes.get("segmentation-png");
    const replaySegmentation = replay.artifactBytes.get("segmentation-png");
    assert(
      primarySafe !== undefined &&
        replaySafe !== undefined &&
        primarySegmentation !== undefined &&
        replaySegmentation !== undefined,
      "C14_REPLAY_PNG_ARTIFACT_MISSING",
    );
    const geometryReplay = await compareProtectedImageGeometry({
      allowedEditMaskPng: primarySegmentation,
      basePng: primarySafe,
      baseSegmentationPng: primarySegmentation,
      candidatePng: replaySafe,
      candidateSegmentationPng: replaySegmentation,
      channelTolerance: 0,
    });
    assert(
      geometryReplay.changedOutsideAllowedMaskPixels === 0 &&
        geometryReplay.protectedEdgeAgreementBasisPoints === 10_000 &&
        geometryReplay.segmentationIoUBasisPoints === 10_000,
      "C14_REPLAY_GEOMETRY_MISMATCH",
    );
    const stageDirectory = await mkdtemp(path.join(tmpdir(), "c14-host-evidence-"));
    try {
      const fixture = renderFixture({ cameraTarget: { xMm: 0, yMm: 0, zMm: 500 } });
      const primaryScene = buildRenderScene({
        ...fixture.input,
        profile: profile(identity, acceptanceProfile),
        rendererScriptSha256: common.rendererScriptSha256,
      });
      await writePrimaryBundle(stageDirectory, primary, primaryScene.canonicalBytes());
      const evidence = {
        artifacts: Object.fromEntries(
          artifactRoles.map((role) => {
            const bytes = primary.artifactBytes.get(role);
            assert(bytes !== undefined, "C14_ACCEPTANCE_ARTIFACT_MISSING");
            return [role, { byteLength: bytes.byteLength, sha256: sha256(bytes) }];
          }),
        ),
        constraints: {
          diskAdmissionMinimumBytes: minimumFreeBytes,
          maximumProcessOutputBytes,
          oneWorker: true,
          renderTimeoutMilliseconds,
        },
        fixture: "repository-owned synthetic exact C10/C13 render-scene fixture",
        hostFingerprintSha256,
        profile: profile(identity, acceptanceProfile),
        renderer: {
          blenderBuildHash: identity.buildHash,
          blenderVersion: identity.version,
          executableSha256: common.executableSha256,
          exrInspectorScriptSha256: common.exrInspectorSha256,
          rendererScriptSha256: common.rendererScriptSha256,
        },
        replay: {
          artifactByteHashesEqual: replayByteEquality,
          geometrySafeComparison: geometryReplay,
          manifestSourceAndRenderSceneMatch:
            primary.manifest.renderSceneManifestSha256 ===
              replay.manifest.renderSceneManifestSha256 &&
            primary.manifest.source.sceneGlbSha256 === replay.manifest.source.sceneGlbSha256,
          outputManifestSha256: sha256(replay.manifestBytes),
        },
        smoke: {
          artifactByteHashes: Object.fromEntries(
            artifactRoles.map((role) => {
              const bytes = smoke.artifactBytes.get(role);
              assert(bytes !== undefined, "C14_SMOKE_ARTIFACT_MISSING");
              return [role, sha256(bytes)];
            }),
          ),
          profile: profile(identity, smokeProfile),
        },
        source: {
          c10GlbSha256: primary.manifest.source.sceneGlbSha256,
          c13Specification: primary.manifest.source.specification,
          renderSceneManifestSha256: primary.manifest.renderSceneManifestSha256,
        },
      };
      await writeFile(
        path.join(stageDirectory, "acceptance-evidence.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
        {
          flag: "wx",
          mode: 0o600,
        },
      );
      await rename(stageDirectory, arguments_.outputDirectory);
    } catch (error) {
      await rm(stageDirectory, { force: true, recursive: true });
      throw error;
    }
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "C14_ACCEPTANCE_FAILED"}\n`);
  process.exitCode = 1;
});
