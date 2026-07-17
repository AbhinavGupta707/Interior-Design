import {
  assetProcessingCommandSchema,
  assetProcessingResultSchema,
  c2IngestionPolicy,
  derivedAssetArtifactSchema,
  type AssetProcessingCommand,
  type AssetProcessingResult,
} from "@interior-design/contracts";
import { writeFile } from "node:fs/promises";

import type { WorkerConfig } from "./config.js";
import { detectAndValidateMime } from "./detection.js";
import { MediaRejection, RetryableWorkerError } from "./errors.js";
import {
  inspectMedia,
  type ArtifactDraft,
  type ProvenanceTool,
  workerMediaLimits,
} from "./inspectors.js";
import type { DerivedWrite, ObjectStorage } from "./storage.js";
import { IsolatedWorkspace, type SourceFingerprint } from "./workspace.js";

export interface PreparedProcessing {
  readonly cleanup: () => Promise<void>;
  readonly result: AssetProcessingResult;
  readonly writes: readonly DerivedWrite[];
}

export interface ProcessJobInput {
  readonly command: AssetProcessingCommand;
  readonly executedAt: string;
  readonly signal?: AbortSignal;
}

export interface ThreatScanner {
  readonly tool: ProvenanceTool;
  assess(filePath: string, signal?: AbortSignal): Promise<"malware-suspected" | undefined>;
}

const workerTool: ProvenanceTool = { name: "spatial-worker", version: "c2-ingest-v1" };

function artifactExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "application/json") return "json";
  throw new Error("Unsupported derived artifact MIME type.");
}

function artifactKey(
  command: AssetProcessingCommand,
  sourceSha256: string,
  kind: "metadata-manifest" | "preview" | "thumbnail",
  artifactSha256: string,
  mimeType: string,
): string {
  const key = `${command.destinations.prefix}/${sourceSha256}/${kind}/${artifactSha256}.${artifactExtension(mimeType)}`;
  if (key.length > 1_024) {
    throw new MediaRejection("processing-failed");
  }
  return key;
}

function rejectionResult(
  command: AssetProcessingCommand,
  executedAt: string,
  source: SourceFingerprint,
  rejection: MediaRejection,
  tools: readonly ProvenanceTool[] = [workerTool],
): AssetProcessingResult {
  return assetProcessingResultSchema.parse({
    artifacts: [],
    assetId: command.assetId,
    detectedMimeType: rejection.detectedMimeType,
    projectId: command.projectId,
    provenance: {
      executedAt,
      policyVersion: "c2-ingest-v1",
      tools,
    },
    rejectionCode: rejection.code,
    status: "rejected",
    technicalMetadata: rejection.technicalMetadata,
    verifiedSource: source,
    version: "c2-ingest-v1",
  });
}

function quarantineResult(
  command: AssetProcessingCommand,
  executedAt: string,
  source: SourceFingerprint,
  tool: ProvenanceTool,
): AssetProcessingResult {
  return assetProcessingResultSchema.parse({
    artifacts: [],
    assetId: command.assetId,
    detectedMimeType: "application/octet-stream",
    projectId: command.projectId,
    provenance: {
      executedAt,
      policyVersion: "c2-ingest-v1",
      tools: [workerTool, tool],
    },
    rejectionCode: "malware-suspected",
    status: "quarantined",
    technicalMetadata: {},
    verifiedSource: source,
    version: "c2-ingest-v1",
  });
}

function manifestJson(input: {
  readonly command: AssetProcessingCommand;
  readonly detectedMimeType: string;
  readonly executedAt: string;
  readonly source: SourceFingerprint;
  readonly technicalMetadata: AssetProcessingResult["technicalMetadata"];
  readonly threatScanner: ProvenanceTool | undefined;
  readonly tools: readonly ProvenanceTool[];
  readonly visibleArtifacts: readonly AssetProcessingResult["artifacts"][number][];
}): string {
  return `${JSON.stringify(
    {
      assetId: input.command.assetId,
      derivedArtifacts: input.visibleArtifacts.map((artifact) => ({
        byteSize: artifact.byteSize,
        kind: artifact.kind,
        mimeType: artifact.mimeType,
        sha256: artifact.sha256,
      })),
      detectedMimeType: input.detectedMimeType,
      projectId: input.command.projectId,
      provenance: {
        executedAt: input.executedAt,
        policyVersion: "c2-ingest-v1",
        tools: input.tools,
      },
      schemaVersion: "c2-derived-manifest-v1",
      securityControls: {
        antivirus:
          input.threatScanner === undefined
            ? "not-configured"
            : "adapter-no-suspicion-signal-not-antivirus-clearance",
        malwareScannerAdapter: input.threatScanner,
        externalSvgResources: "rejected",
        metadataStrippedFromRasterOutputs: true,
        rawSvgOutput: false,
      },
      source: input.source,
      technicalMetadata: input.technicalMetadata,
      workerLimits: {
        maximumImageDimension: c2IngestionPolicy.maximumImageDimension,
        maximumImagePixels: c2IngestionPolicy.maximumImagePixels,
        maximumMediaStreams: workerMediaLimits.maximumMediaStreams,
        maximumPdfPages: c2IngestionPolicy.maximumPdfPages,
        maximumSvgBytes: workerMediaLimits.maximumSvgBytes,
        maximumVideoDurationMilliseconds: workerMediaLimits.maximumVideoDurationMilliseconds,
      },
    },
    null,
    2,
  )}\n`;
}

async function describeDraft(
  command: AssetProcessingCommand,
  source: SourceFingerprint,
  workspace: IsolatedWorkspace,
  draft: ArtifactDraft,
): Promise<{
  readonly artifact: AssetProcessingResult["artifacts"][number];
  readonly write: DerivedWrite;
}> {
  const fingerprint = await workspace.fingerprintFile(draft.filePath);
  const artifact = derivedAssetArtifactSchema.parse({
    byteSize: fingerprint.byteSize,
    key: artifactKey(command, source.sha256, draft.kind, fingerprint.sha256, draft.mimeType),
    kind: draft.kind,
    mimeType: draft.mimeType,
    sha256: fingerprint.sha256,
  });
  return {
    artifact,
    write: {
      bucket: command.destinations.derivedBucket,
      byteSize: artifact.byteSize,
      contentType: artifact.mimeType,
      filePath: draft.filePath,
      key: artifact.key,
      sha256: artifact.sha256,
    },
  };
}

export class MediaProcessor {
  readonly #config: WorkerConfig;
  readonly #storage: ObjectStorage;
  readonly #threatScanner: ThreatScanner | undefined;

  constructor(config: WorkerConfig, storage: ObjectStorage, threatScanner?: ThreatScanner) {
    this.#config = config;
    this.#storage = storage;
    this.#threatScanner = threatScanner;
  }

  async process(input: ProcessJobInput): Promise<PreparedProcessing> {
    const command = assetProcessingCommandSchema.parse(input.command);
    const workspace = await IsolatedWorkspace.create(
      this.#config.temporaryDirectory.root,
      this.#config.temporaryDirectory.maximumBytes,
    );
    const cleanup = (): Promise<void> => workspace.cleanup();
    let source: SourceFingerprint | undefined;
    try {
      const sourceBody = await this.#storage.openSource(
        command.source.bucket,
        command.source.key,
        input.signal,
      );
      source = await workspace.streamSource(sourceBody, "source.bin", input.signal);
      if (source.byteSize > c2IngestionPolicy.maximumAssetBytes) {
        throw new RetryableWorkerError("source-outside-result-contract");
      }
      if (
        source.byteSize !== command.expected.byteSize ||
        source.sha256 !== command.expected.sha256
      ) {
        return {
          cleanup,
          result: rejectionResult(
            command,
            input.executedAt,
            source,
            new MediaRejection("checksum-mismatch"),
          ),
          writes: [],
        };
      }

      if (this.#threatScanner !== undefined) {
        const assessment = await this.#threatScanner.assess(
          workspace.resolve("source.bin"),
          input.signal,
        );
        if (assessment === "malware-suspected") {
          return {
            cleanup,
            result: quarantineResult(command, input.executedAt, source, this.#threatScanner.tool),
            writes: [],
          };
        }
      }

      let detection;
      try {
        detection = await detectAndValidateMime(
          command,
          workspace.resolve("source.bin"),
          this.#config,
          input.signal,
        );
      } catch (error) {
        if (!(error instanceof MediaRejection)) throw error;
        return {
          cleanup,
          result: rejectionResult(command, input.executedAt, source, error),
          writes: [],
        };
      }

      let inspection;
      try {
        inspection = await inspectMedia(
          command,
          workspace.resolve("source.bin"),
          workspace,
          this.#config,
          detection,
          input.signal,
        );
      } catch (error) {
        if (!(error instanceof MediaRejection)) throw error;
        return {
          cleanup,
          result: rejectionResult(command, input.executedAt, source, error, [
            workerTool,
            { name: "file-type", version: "22.0.1" },
            { name: "file", version: detection.fileUtilityVersion },
          ]),
          writes: [],
        };
      }

      const verifiedSource = source;
      const tools =
        this.#threatScanner === undefined
          ? inspection.tools
          : [...inspection.tools, this.#threatScanner.tool];
      const described = await Promise.all(
        inspection.artifacts.map((draft) =>
          describeDraft(command, verifiedSource, workspace, draft),
        ),
      );
      const visibleArtifacts = described.map(({ artifact }) => artifact);
      const manifestPath = workspace.resolve("metadata-manifest.json");
      await writeFile(
        manifestPath,
        manifestJson({
          command,
          detectedMimeType: inspection.detectedMimeType,
          executedAt: input.executedAt,
          source,
          technicalMetadata: inspection.technicalMetadata,
          threatScanner: this.#threatScanner?.tool,
          tools,
          visibleArtifacts,
        }),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await workspace.assertWithinQuota();
      const manifestFingerprint = await workspace.fingerprintFile(manifestPath);
      const manifestArtifact = derivedAssetArtifactSchema.parse({
        byteSize: manifestFingerprint.byteSize,
        key: artifactKey(
          command,
          source.sha256,
          "metadata-manifest",
          manifestFingerprint.sha256,
          "application/json",
        ),
        kind: "metadata-manifest",
        mimeType: "application/json",
        sha256: manifestFingerprint.sha256,
      });
      const result = assetProcessingResultSchema.parse({
        artifacts: [...visibleArtifacts, manifestArtifact],
        assetId: command.assetId,
        detectedMimeType: inspection.detectedMimeType,
        projectId: command.projectId,
        provenance: {
          executedAt: input.executedAt,
          policyVersion: "c2-ingest-v1",
          tools,
        },
        status: "ready",
        technicalMetadata: inspection.technicalMetadata,
        verifiedSource: source,
        version: "c2-ingest-v1",
      });
      return {
        cleanup,
        result,
        writes: [
          ...described.map(({ write }) => write),
          {
            bucket: command.destinations.derivedBucket,
            byteSize: manifestArtifact.byteSize,
            contentType: manifestArtifact.mimeType,
            filePath: manifestPath,
            key: manifestArtifact.key,
            sha256: manifestArtifact.sha256,
          },
        ],
      };
    } catch (error) {
      if (error instanceof MediaRejection && source !== undefined) {
        return {
          cleanup,
          result: rejectionResult(command, input.executedAt, source, error),
          writes: [],
        };
      }
      await workspace.cleanup();
      if (error instanceof RetryableWorkerError) throw error;
      throw new RetryableWorkerError("processing-unavailable", error);
    }
  }
}
