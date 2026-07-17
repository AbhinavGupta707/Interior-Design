import {
  estimateFreeSimilarityTransform,
  type FixedSimilarityTransform,
} from "@interior-design/geometry-kernel";
import {
  fusionRegistrationResultSchema,
  type FusionRegistrationResult,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import type { FusionRegistrationProducerPort } from "./types.js";

const identityTransform: FixedSimilarityTransform = Object.freeze({
  rotationQuaternionE9: { w: 1_000_000_000, x: 0, y: 0, z: 0 },
  scalePartsPerMillion: 1_000_000,
  translationMm: { xMm: 0, yMm: 0, zMm: 0 },
});

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function componentId(sourceId: string): string {
  return deterministicUuid(`c9:project-registration-component:${sourceId}`);
}

function identityRegistration(
  source: Parameters<FusionRegistrationProducerPort["register"]>[0]["sources"][number],
): FusionRegistrationResult {
  return fusionRegistrationResultSchema.parse({
    confidenceBasisPoints: source.descriptor.scaleStatus === "metric-validated" ? 10_000 : 8_500,
    connectedComponentId: componentId(source.descriptor.id),
    findings:
      source.descriptor.scaleStatus === "metric-validated"
        ? []
        : [
            {
              code: "FUSION_METRIC_SCALE_ESTIMATED",
              detail: "The project-local source retains its declared estimated metric scale.",
              severity: "warning",
            },
          ],
    method: "identity",
    residuals: { inlierCount: 0, maximumMm: 0, medianMm: 0, p90Mm: 0, sampleCount: 0 },
    scaleStatus: source.descriptor.scaleStatus,
    schemaVersion: "c9-registration-result-v1",
    sourceId: source.descriptor.id,
    status: source.descriptor.scaleStatus === "metric-validated" ? "registered" : "partial",
    transform: identityTransform,
  });
}

function unavailableRegistration(
  sourceId: string,
  code: string,
  detail: string,
): FusionRegistrationResult {
  return fusionRegistrationResultSchema.parse({
    findings: [{ code, detail, severity: "error" }],
    schemaVersion: "c9-registration-result-v1",
    sourceId,
    status: "unregistered",
  });
}

/** Deterministic project registration using only explicit project control points. */
export class GeometryKernelRegistrationProducer implements FusionRegistrationProducerPort {
  register(
    input: Parameters<FusionRegistrationProducerPort["register"]>[0],
    signal?: AbortSignal,
  ): Promise<readonly FusionRegistrationResult[]> {
    const anchors = new Map(input.anchorGroups.map((group) => [group.sourceId, group.anchors]));
    const results = input.sources.map((source) => {
      if (signal?.aborted === true) {
        return unavailableRegistration(
          source.descriptor.id,
          "FUSION_REGISTRATION_CANCELLED",
          "Registration was cancelled before this source was processed.",
        );
      }
      if (source.descriptor.coordinateFrame === "project-local") {
        return identityRegistration(source);
      }
      const sourceAnchors = anchors.get(source.descriptor.id);
      if (sourceAnchors === undefined) {
        return unavailableRegistration(
          source.descriptor.id,
          "FUSION_CONTROL_POINTS_REQUIRED",
          "A source-local frame requires at least three explicit project control points.",
        );
      }
      const estimated = estimateFreeSimilarityTransform(
        sourceAnchors.map((anchor) => ({
          confidenceBasisPoints: anchor.confidenceBasisPoints,
          correspondenceId: anchor.anchorId,
          sourcePoint: anchor.sourcePoint,
          targetPoint: anchor.projectPoint,
        })),
      );
      if (!estimated.ok) {
        return unavailableRegistration(
          source.descriptor.id,
          `FUSION_${estimated.error.code}`,
          estimated.error.detail,
        );
      }
      const { residuals, transform } = estimated.value;
      const meanConfidence = Math.floor(
        sourceAnchors.reduce((total, anchor) => total + anchor.confidenceBasisPoints, 0) /
          sourceAnchors.length,
      );
      const inlierConfidence = Math.floor(
        (meanConfidence * residuals.inlierCount) / Math.max(1, residuals.sampleCount),
      );
      const residualPenalty = Math.min(4_000, residuals.p90Mm * 20);
      const confidenceBasisPoints = Math.max(0, inlierConfidence - residualPenalty);
      const scaleStatus =
        source.descriptor.scaleStatus === "metric-validated"
          ? "metric-validated"
          : "metric-estimated";
      const partial = residuals.inlierCount !== residuals.sampleCount || residuals.p90Mm > 50;
      return fusionRegistrationResultSchema.parse({
        confidenceBasisPoints,
        connectedComponentId: componentId(source.descriptor.id),
        findings: partial
          ? [
              {
                code: "FUSION_REGISTRATION_RESIDUALS_EXPOSED",
                detail:
                  "The control-point fit contains outliers or residuals above the exact-fit threshold.",
                severity: "warning",
              },
            ]
          : [],
        method: "control-points",
        residuals,
        scaleStatus,
        schemaVersion: "c9-registration-result-v1",
        sourceId: source.descriptor.id,
        status: partial ? "partial" : "registered",
        transform,
      });
    });
    return Promise.resolve(results);
  }
}
