import {
  c14RenderPolicy,
  renderSceneManifestSchema,
  type RenderArtifactRole,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./canonical.js";
import { normalizeRenderArtifactContainer } from "./container-normalization.js";
import { rendererFailure } from "./errors.js";
import { sha256 } from "./hash.js";
import type {
  ExrInspectionPort,
  GlbInspectionPort,
  RenderExecutionInput,
  RendererExecutableDescriptor,
  RendererProcessPort,
  ValidatedRenderBundle,
} from "./types.js";
import { rendererArtifactFileNames } from "./types.js";
import { createOutputManifest, validateArtifactBytes, validateProtectedGlb } from "./validation.js";
import {
  createPrivateRenderWorkspace,
  removePrivateRenderWorkspace,
  stagePrivateFile,
} from "./workspace.js";

const artifactRoles = [
  "geometry-safe-png",
  "multilayer-exr",
  "depth-exr",
  "normal-exr",
  "segmentation-png",
] as const;
type RendererOutputRole = (typeof artifactRoles)[number];

function deterministicArtifactId(
  resultId: string,
  role: RenderArtifactRole,
  digest: string,
): string {
  const bytes = createHash("sha256")
    .update(`${resultId}:${role}:${digest}`)
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readRegularOutput(
  workspace: string,
  fileName: string,
  role: RendererOutputRole,
): Promise<Uint8Array> {
  const outputRoot = path.join(workspace, "output");
  const outputStat = await lstat(outputRoot).catch(() => undefined);
  if (
    outputStat === undefined ||
    !outputStat.isDirectory() ||
    outputStat.isSymbolicLink() ||
    path.dirname(await realpath(outputRoot)) !== workspace
  ) {
    rendererFailure("RENDER_OUTPUT_PATH_INVALID");
  }
  const target = path.resolve(outputRoot, fileName);
  if (path.dirname(target) !== outputRoot) rendererFailure("RENDER_OUTPUT_PATH_INVALID");
  const stat = await lstat(target).catch(() => undefined);
  if (
    stat === undefined ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > c14RenderPolicy.maximumArtifactBytes
  ) {
    rendererFailure("RENDER_OUTPUT_MISSING");
  }
  return normalizeRenderArtifactContainer(role, await readFile(target));
}

export interface IsolatedRendererOptions {
  readonly descriptor: RendererExecutableDescriptor;
  readonly exrInspector: ExrInspectionPort;
  readonly glbInspector: GlbInspectionPort;
  readonly hostFingerprintSha256: string;
  readonly maximumOutputBytes?: number;
  readonly process: RendererProcessPort;
  readonly timeoutMilliseconds?: number;
  readonly workspaceRoot: string;
}

export class IsolatedStillRenderer {
  readonly #options: IsolatedRendererOptions;

  constructor(options: IsolatedRendererOptions) {
    this.#options = options;
  }

  async render(input: RenderExecutionInput, signal?: AbortSignal): Promise<ValidatedRenderBundle> {
    if (!/^[a-f0-9]{64}$/u.test(this.#options.hostFingerprintSha256)) {
      rendererFailure("RENDER_HOST_FINGERPRINT_INVALID");
    }
    if (
      sha256(input.glbBytes) !== input.glbSha256 ||
      sha256(input.renderSceneManifestBytes) !== input.renderSceneManifestSha256
    ) {
      rendererFailure("RENDER_INPUT_HASH_MISMATCH");
    }
    const manifest = renderSceneManifestSchema.parse(input.renderSceneManifest);
    if (
      manifest.source.sceneGlbSha256 !== input.glbSha256 ||
      manifest.rendererScriptSha256 !== this.#options.descriptor.rendererScriptSha256
    ) {
      rendererFailure("RENDER_INPUT_BINDING_MISMATCH");
    }
    const inspection = await this.#options.glbInspector.inspect(input.glbBytes);
    validateProtectedGlb({
      actualSha256: sha256(input.glbBytes),
      expectedSha256: manifest.source.sceneGlbSha256,
      inspection,
      manifest,
    });

    const workspace = await createPrivateRenderWorkspace(this.#options.workspaceRoot);
    try {
      await stagePrivateFile(workspace, "scene.glb", input.glbBytes);
      await stagePrivateFile(workspace, "render-scene.json", input.renderSceneManifestBytes);
      await stagePrivateFile(
        workspace,
        "protected-objects.json",
        Buffer.from(
          canonicalJson({
            objectBounds: inspection.objectBounds,
            objectIds: inspection.objectIds,
          }),
          "utf8",
        ),
      );
      const processResult = await this.#options.process.run(
        {
          descriptor: this.#options.descriptor,
          maximumOutputBytes: this.#options.maximumOutputBytes ?? 64 * 1024,
          timeoutMilliseconds: this.#options.timeoutMilliseconds ?? 7_200_000,
          workspacePath: workspace,
        },
        signal,
      );
      if (processResult.exitCode !== 0) rendererFailure("RENDER_PROCESS_FAILED");

      const artifactEntries = await Promise.all(
        artifactRoles.map(async (role) => {
          const bytes = await readRegularOutput(workspace, rendererArtifactFileNames[role], role);
          const digest = sha256(bytes);
          const artifact = await validateArtifactBytes({
            artifactId: deterministicArtifactId(input.resultId, role, digest),
            bytes,
            expectedHeightPx: manifest.profile.heightPx,
            expectedWidthPx: manifest.profile.widthPx,
            exrInspector: this.#options.exrInspector,
            role,
          });
          return [role, { artifact, bytes }] as const;
        }),
      );
      const artifacts = artifactEntries.map(([, value]) => value.artifact);
      const outputManifest = createOutputManifest({
        artifacts,
        executableSha256: this.#options.descriptor.executableSha256,
        hostFingerprintSha256: this.#options.hostFingerprintSha256,
        renderInput: input,
      });
      const manifestBytes = Buffer.from(canonicalJson(outputManifest), "utf8");
      return {
        artifactBytes: new Map(artifactEntries.map(([role, value]) => [role, value.bytes])),
        artifacts,
        manifest: outputManifest,
        manifestBytes,
        manifestSha256: sha256(manifestBytes),
      };
    } finally {
      await removePrivateRenderWorkspace(this.#options.workspaceRoot, workspace);
    }
  }
}
