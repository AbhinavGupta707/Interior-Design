/// <reference types="node" />

import { createHash } from "node:crypto";

import {
  c10ScenePolicy,
  canonicalHomeSnapshotSchema,
  sceneArtifactSchema,
  sceneCompileConfigurationSchema,
  sceneManifestSchema,
  sceneSnapshotReferenceSchema,
} from "@interior-design/contracts";

import type {
  SceneCompilationRuntimePorts,
  SceneCompilationRuntimeResult,
  SceneCompilationTask,
  SceneCompilerOutput,
  SceneWorkState,
} from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function resultForState(state: Exclude<SceneWorkState, "current">): SceneCompilationRuntimeResult {
  return state === "cancelled"
    ? { safeCode: "SCENE_COMPILATION_CANCELLED", status: "cancelled" }
    : { safeCode: "SCENE_COMPILATION_STALE", status: "stale" };
}

function cancellationResult(): SceneCompilationRuntimeResult {
  return { safeCode: "SCENE_COMPILATION_CANCELLED", status: "cancelled" };
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function validateTask(task: SceneCompilationTask): void {
  if (
    !uuidPattern.test(task.jobId) ||
    !Number.isInteger(task.attempt) ||
    task.attempt < 1 ||
    task.attempt > c10ScenePolicy.maximumAttempts ||
    task.publicationFence.length < 1 ||
    task.publicationFence.length > 256
  ) {
    throw new Error("Scene compilation task envelope is invalid.");
  }
  sceneSnapshotReferenceSchema.parse(task.sourceSnapshot);
  sceneCompileConfigurationSchema.parse(task.configuration);
}

function validateGlbHeader(glb: Uint8Array): void {
  if (
    glb.byteLength < 20 ||
    glb.byteLength > c10ScenePolicy.maximumArtifactBytes ||
    glb.byteLength % 4 !== 0
  ) {
    throw new Error("Compiler returned an invalid bounded GLB length.");
  }
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== glb.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  ) {
    throw new Error("Compiler returned a malformed GLB header.");
  }
}

function validateCompilerOutput(
  output: SceneCompilerOutput,
  task: SceneCompilationTask,
): SceneCompilerOutput {
  const artifact = sceneArtifactSchema.parse(output.artifact);
  const manifest = sceneManifestSchema.parse(output.manifest);
  validateGlbHeader(output.glb);
  if (
    artifact.byteSize !== output.glb.byteLength ||
    artifact.glbSha256 !== sha256(output.glb) ||
    artifact.manifestSha256 !== sha256(output.manifestBytes) ||
    !sameJson(manifest.sourceSnapshot, task.sourceSnapshot) ||
    !sameJson(manifest.compiler.configuration, task.configuration)
  ) {
    throw new Error("Compiler output integrity or source pins do not match the task.");
  }
  let manifestDocument: unknown;
  try {
    manifestDocument = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(output.manifestBytes),
    ) as unknown;
  } catch (error) {
    throw new Error("Compiler manifest bytes are invalid UTF-8 or JSON.", { cause: error });
  }
  if (!sameJson(sceneManifestSchema.parse(manifestDocument), manifest)) {
    throw new Error("Compiler manifest bytes differ from the validated manifest object.");
  }
  return { artifact, glb: output.glb, manifest, manifestBytes: output.manifestBytes };
}

async function currentState(
  ports: SceneCompilationRuntimePorts,
  task: SceneCompilationTask,
  signal: AbortSignal,
): Promise<SceneWorkState> {
  if (signal.aborted) return "cancelled";
  return ports.workState.check(task, signal);
}

export async function runSceneCompilation(
  task: SceneCompilationTask,
  ports: SceneCompilationRuntimePorts,
  signal: AbortSignal,
): Promise<SceneCompilationRuntimeResult> {
  const boundedSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(c10ScenePolicy.workerTimeoutMilliseconds),
  ]);
  try {
    validateTask(task);
    const initialState = await currentState(ports, task, boundedSignal);
    if (initialState !== "current") return resultForState(initialState);

    const rawSnapshot = await ports.snapshots.loadExactSnapshot(task.sourceSnapshot, boundedSignal);
    if (isAborted(boundedSignal)) return cancellationResult();
    const snapshot = canonicalHomeSnapshotSchema.parse(rawSnapshot);
    if (
      snapshot.modelId !== task.sourceSnapshot.modelId ||
      snapshot.profile !== task.sourceSnapshot.profile ||
      snapshot.projectId !== task.sourceSnapshot.projectId
    ) {
      throw new Error("Exact snapshot port returned a record outside the requested source scope.");
    }

    const beforeCompile = await currentState(ports, task, boundedSignal);
    if (beforeCompile !== "current") return resultForState(beforeCompile);
    const compiled = validateCompilerOutput(
      await ports.compiler.compile({
        configuration: task.configuration,
        signal: boundedSignal,
        snapshot,
        sourceSnapshot: task.sourceSnapshot,
      }),
      task,
    );
    if (isAborted(boundedSignal)) return cancellationResult();

    const beforePublish = await currentState(ports, task, boundedSignal);
    if (beforePublish !== "current") return resultForState(beforePublish);
    const publication = await ports.publisher.publishIfCurrent(
      {
        artifact: compiled.artifact,
        attempt: task.attempt,
        contentAddress: {
          glbSha256: compiled.artifact.glbSha256,
          manifestSha256: compiled.artifact.manifestSha256,
        },
        glb: compiled.glb,
        jobId: task.jobId,
        manifest: compiled.manifest,
        manifestBytes: compiled.manifestBytes,
        publicationFence: task.publicationFence,
      },
      boundedSignal,
    );
    if (publication !== "published") return resultForState(publication);
    return { artifact: compiled.artifact, manifest: compiled.manifest, status: "published" };
  } catch {
    return boundedSignal.aborted
      ? cancellationResult()
      : { safeCode: "SCENE_COMPILATION_FAILED", status: "failed" };
  }
}
