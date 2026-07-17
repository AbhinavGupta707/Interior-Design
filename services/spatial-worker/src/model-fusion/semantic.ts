import {
  canonicalHomeSnapshotSchema,
  captureProposalResultSchema,
  fusionDiscrepancySchema,
  planProposalSchema,
  type CanonicalHomeSnapshot,
  type FusionDiscrepancy,
  type FusionRegistrationResult,
  type PlanProposal,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson, canonicalSha256 } from "../media-prep/canonical.js";
import { ProcessExecutionError, runBoundedProcess } from "../subprocess.js";
import { canonicalSnapshotSha256 } from "./canonical.js";
import type {
  FusionSemanticOutput,
  FusionSemanticProducerPort,
  FusionSourcePayload,
} from "./types.js";
import { FusionWorkerError } from "./types.js";

const point3Schema = z.object({ xMm: z.int(), yMm: z.int(), zMm: z.int() }).strict();
const point2Schema = z.object({ xMm: z.int(), yMm: z.int() }).strict();
const claimSchema = z
  .object({
    confidenceBasisPoints: z.int().min(0).max(10_000),
    evidence: z
      .object({ evidenceId: z.uuid(), evidenceSha256: z.string(), schemaVersion: z.string() })
      .strict(),
    observationIds: z.array(z.uuid()),
    referenceId: z.uuid(),
    rights: z
      .object({
        serviceProcessingConsent: z.literal(true),
        trainingUseConsent: z.literal("denied"),
      })
      .strict(),
    sourceId: z.uuid(),
    sourceSchemaVersion: z.string(),
    sourceSha256: z.string(),
    state: z.enum(["observed", "source-derived", "fused", "inferred", "user-asserted"]),
    tool: z
      .object({
        configSha256: z.string(),
        name: z.string(),
        toolSha256: z.string(),
        version: z.string(),
      })
      .strict(),
  })
  .strict();
const provenanceSchema = z
  .object({
    claims: z.array(claimSchema).min(1),
    confidenceBasisPoints: z.int().min(0).max(10_000),
    inference: z.string(),
    state: z.enum(["source-derived", "fused", "user-asserted"]),
  })
  .strict();
const diagnosticSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
    message: z.string().min(1),
    observationIds: z.array(z.uuid()),
    severity: z.enum(["information", "warning", "error"]),
    sourceIds: z.array(z.uuid()),
  })
  .strict();
const fittedGeometrySchema = z
  .object({
    fixedObjects: z.array(
      z
        .object({
          category: z.string(),
          dimensionsMm: z
            .object({ depthMm: z.int(), heightMm: z.int(), widthMm: z.int() })
            .strict(),
          id: z.uuid(),
          levelId: z.uuid(),
          position: point3Schema,
          provenance: provenanceSchema,
          rotationMilliDegrees: z.int().nullable(),
          unknownFields: z.array(z.string()),
        })
        .strict(),
    ),
    levels: z.array(
      z
        .object({
          elevationMm: z.int(),
          id: z.uuid(),
          levelKey: z.string(),
          name: z.string().nullable(),
          provenance: provenanceSchema,
          storeyHeightMm: z.int().positive(),
          unknownFields: z.array(z.string()),
        })
        .strict(),
    ),
    openings: z.array(
      z
        .object({
          heightMm: z.int().positive(),
          hostWallId: z.uuid(),
          id: z.uuid(),
          kind: z.enum(["opening", "door", "window"]),
          offsetAlongHostMm: z.int().nonnegative(),
          provenance: provenanceSchema,
          sillHeightMm: z.int().nonnegative(),
          unknownFields: z.array(z.string()),
          widthMm: z.int().positive(),
        })
        .strict(),
    ),
    spaces: z.array(
      z
        .object({
          boundedByWallIds: z.array(z.uuid()),
          boundary: z.array(point2Schema).min(3),
          classification: z.string().nullable(),
          id: z.uuid(),
          levelId: z.uuid(),
          name: z.string().nullable(),
          provenance: provenanceSchema,
          unknownFields: z.array(z.string()),
        })
        .strict(),
    ),
    stairs: z.array(
      z
        .object({
          fromLevelId: z.uuid(),
          id: z.uuid(),
          path: z.array(point2Schema).min(2),
          provenance: provenanceSchema,
          stepCount: z.int().positive(),
          toLevelId: z.uuid(),
          totalRiseMm: z.int().positive(),
          totalRunMm: z.int().positive(),
          unknownFields: z.array(z.string()),
          widthMm: z.int().positive(),
        })
        .strict(),
    ),
    surfaces: z.array(
      z
        .object({
          boundary: z.array(point3Schema).min(3),
          id: z.uuid(),
          kind: z.enum(["floor", "ceiling", "slab", "wall-face", "other"]),
          levelId: z.uuid(),
          provenance: provenanceSchema,
          unknownFields: z.array(z.string()),
        })
        .strict(),
    ),
    walls: z.array(
      z
        .object({
          alignment: z.literal("centre"),
          baseOffsetMm: z.int(),
          heightMm: z.int().positive(),
          id: z.uuid(),
          levelId: z.uuid(),
          path: z.array(point2Schema).min(2),
          provenance: provenanceSchema,
          thicknessMm: z.null(),
          unknownFields: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
const unknownRegionSchema = z
  .object({
    boundary: z.array(point3Schema).nullable(),
    id: z.uuid(),
    levelId: z.uuid().nullable(),
    provenance: provenanceSchema,
    reason: z.string().min(1),
  })
  .strict();
const proposalPayloadSchema = z
  .object({
    coordinateSystem: z
      .object({
        axes: z
          .object({ x: z.literal("east"), y: z.literal("north"), z: z.literal("up") })
          .strict(),
        handedness: z.literal("right"),
        kind: z.literal("local-cartesian"),
        lengthUnit: z.literal("mm"),
      })
      .strict(),
    diagnostics: z.array(diagnosticSchema),
    geometry: fittedGeometrySchema,
    status: z.enum(["proposal", "partial-proposal"]),
    unknownRegions: z.array(unknownRegionSchema),
    workUnits: z.int().nonnegative(),
  })
  .strict();
const terminalPayloadSchema = z
  .object({
    diagnostics: z.array(diagnosticSchema).min(1),
    safeCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
    status: z.enum(["abstained", "cancelled"]),
  })
  .strict();
const scanResultSchema = z
  .object({
    authority: z.literal("proposal-only"),
    baseSnapshot: z
      .object({
        modelId: z.uuid(),
        profile: z.literal("existing"),
        snapshotId: z.uuid(),
        snapshotSha256: z.string(),
      })
      .strict(),
    fitter: z
      .object({
        configSha256: z.string(),
        manifestSha256: z.string(),
        name: z.string(),
        toolSha256: z.string(),
        version: z.string(),
      })
      .strict(),
    jobId: z.uuid(),
    payload: z.union([proposalPayloadSchema, terminalPayloadSchema]),
    payloadSha256: z.string(),
    profile: z.literal("existing"),
    projectId: z.uuid(),
    requestSha256: z.string(),
    schemaVersion: z.literal("c9-scan-to-model-result-v1"),
    sourceManifestSha256: z.string(),
    status: z.enum(["proposal", "partial-proposal", "abstained", "cancelled"]),
  })
  .strict();

type Observation = Readonly<Record<string, unknown>>;
type Registration = Exclude<FusionRegistrationResult, { readonly status: "unregistered" }>;
type Provenance = z.infer<typeof provenanceSchema>;
type Point2 = { readonly xMm: number; readonly yMm: number };

export interface PythonScanToModelProducerOptions {
  readonly pythonCommand?: string;
  readonly pythonModuleRoot: string;
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function knownValue<T>(
  value: { readonly knowledge: "known"; readonly value: T } | { readonly knowledge: "unknown" },
): T | undefined {
  return value.knowledge === "known" ? value.value : undefined;
}

function safeLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 .,'()/_-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80);
  return /^[A-Za-z0-9]/u.test(normalized) ? normalized : undefined;
}

function levelKey(elevationMm: number): string {
  return `level-${elevationMm < 0 ? "neg-" : ""}${String(Math.abs(elevationMm))}`;
}

function confidenceForCapture(
  proposal: Extract<
    ReturnType<typeof captureProposalResultSchema.parse>,
    { readonly status: "proposal" }
  >,
  elementId: string,
): number {
  const score = proposal.elementSources.find(
    ({ modelElementId }) => modelElementId === elementId,
  )?.confidence;
  return (score ?? proposal.overallConfidence) * 100;
}

function planeNormal(
  start: Point2,
  end: Point2,
): { readonly xE9: number; readonly yE9: number; readonly zE9: number } | undefined {
  const dx = end.xMm - start.xMm;
  const dy = end.yMm - start.yMm;
  const length = Math.hypot(dx, dy);
  if (length === 0) return undefined;
  return {
    xE9: Math.round((-dy / length) * 1_000_000_000),
    yE9: Math.round((dx / length) * 1_000_000_000),
    zE9: 0,
  };
}

function commonObservation(sourceId: string, key: string, confidenceBasisPoints: number) {
  return {
    confidenceBasisPoints,
    coverage: "observed" as const,
    observationId: deterministicUuid(`c9:observation:${sourceId}:${key}`),
  };
}

function captureObservations(source: FusionSourcePayload): Observation[] {
  const proposal = captureProposalResultSchema.parse(source.payload);
  if (proposal.status !== "proposal") return [];
  const snapshot = proposal.proposedSnapshot;
  const levels = new Map(snapshot.elements.levels.map((level) => [level.id, level]));
  const observations: Observation[] = [];
  for (const level of snapshot.elements.levels) {
    const elevation = knownValue(level.elevationMm);
    const height = knownValue(level.storeyHeightMm);
    if (elevation === undefined || height === undefined) continue;
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `level:${level.id}`,
        confidenceForCapture(proposal, level.id),
      ),
      elevationMm: elevation,
      levelKey: levelKey(elevation),
      name: safeLabel(knownValue(level.name)),
      observationType: "level-hint",
      storeyHeightMm: height,
    });
  }
  for (const wall of snapshot.elements.walls) {
    const level = levels.get(wall.levelId);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    const path = knownValue(wall.path);
    const baseOffset = knownValue(wall.baseOffsetMm);
    const height = knownValue(wall.heightMm);
    if (
      elevation === undefined ||
      path === undefined ||
      baseOffset === undefined ||
      height === undefined
    )
      continue;
    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index];
      const end = path[index + 1];
      if (start === undefined || end === undefined) continue;
      const normal = planeNormal(start, end);
      if (normal === undefined) continue;
      const bottom = elevation + baseOffset;
      observations.push({
        ...commonObservation(
          source.descriptor.id,
          `wall:${wall.id}:${String(index)}`,
          confidenceForCapture(proposal, wall.id),
        ),
        boundary: [
          { ...start, zMm: bottom },
          { ...end, zMm: bottom },
          { ...end, zMm: bottom + height },
          { ...start, zMm: bottom + height },
        ],
        levelKey: levelKey(elevation),
        normalE9: normal,
        observationType: "plane",
        semantic: "wall-face",
      });
    }
  }
  for (const surface of snapshot.elements.surfaces) {
    if (
      !(["floor", "ceiling", "slab"] as const).includes(
        surface.kind as "floor" | "ceiling" | "slab",
      )
    )
      continue;
    const level = levels.get(surface.levelId);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    const boundary = knownValue(surface.boundary);
    if (elevation === undefined || boundary === undefined) continue;
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `surface:${surface.id}`,
        confidenceForCapture(proposal, surface.id),
      ),
      boundary,
      levelKey: levelKey(elevation),
      normalE9: {
        xE9: 0,
        yE9: 0,
        zE9: surface.kind === "ceiling" ? -1_000_000_000 : 1_000_000_000,
      },
      observationType: "plane",
      semantic: surface.kind,
    });
  }
  for (const space of snapshot.elements.spaces) {
    const level = levels.get(space.levelId);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    const boundary = knownValue(space.boundary);
    if (elevation === undefined || boundary === undefined) continue;
    const boundaryId = deterministicUuid(
      `c9:observation:${source.descriptor.id}:space-boundary:${space.id}`,
    );
    const boundaryWalls = snapshot.elements.walls.filter((wall) =>
      space.boundedByElementIds.includes(wall.id),
    );
    const occludedEdgeIndices = boundary
      .map((start, index) => {
        const end = boundary[(index + 1) % boundary.length];
        if (end === undefined) return index;
        const matched = boundaryWalls.some((wall) => {
          const path = knownValue(wall.path);
          if (path === undefined) return false;
          return path.some((point, pointIndex) => {
            const next = path[pointIndex + 1];
            if (next === undefined) return false;
            return (
              (point.xMm === start.xMm &&
                point.yMm === start.yMm &&
                next.xMm === end.xMm &&
                next.yMm === end.yMm) ||
              (point.xMm === end.xMm &&
                point.yMm === end.yMm &&
                next.xMm === start.xMm &&
                next.yMm === start.yMm)
            );
          });
        });
        return matched ? undefined : index;
      })
      .filter((index): index is number => index !== undefined);
    observations.push({
      confidenceBasisPoints: confidenceForCapture(proposal, space.id),
      coverage: occludedEdgeIndices.length === 0 ? "observed" : "partial",
      levelKey: levelKey(elevation),
      observationId: boundaryId,
      observationType: "boundary",
      occludedEdgeIndices,
      polygon: boundary.map((point) => ({ ...point, zMm: elevation })),
    });
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `room:${space.id}`,
        confidenceForCapture(proposal, space.id),
      ),
      boundaryObservationId: boundaryId,
      classification: safeLabel(knownValue(space.classification)),
      levelKey: levelKey(elevation),
      name: safeLabel(knownValue(space.name)),
      observationType: "room-hint",
    });
  }
  for (const opening of snapshot.elements.openings) {
    const wall = snapshot.elements.walls.find(({ id }) => id === opening.hostWallId);
    const level = wall === undefined ? undefined : levels.get(wall.levelId);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    const path = wall === undefined ? undefined : knownValue(wall.path);
    const baseOffset = wall === undefined ? undefined : knownValue(wall.baseOffsetMm);
    const offset = knownValue(opening.offsetAlongHostMm);
    const width = knownValue(opening.widthMm);
    const height = knownValue(opening.heightMm);
    const sill = knownValue(opening.sillHeightMm);
    if (
      [elevation, path, baseOffset, offset, width, height, sill].some(
        (value) => value === undefined,
      )
    )
      continue;
    if (wall === undefined) continue;
    const pathValue = path as readonly Point2[];
    let remaining = offset as number;
    for (let index = 0; index < pathValue.length - 1; index += 1) {
      const start = pathValue[index];
      const end = pathValue[index + 1];
      if (start === undefined || end === undefined) continue;
      const length = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
      if (remaining > length || remaining + (width as number) > length) {
        remaining -= length;
        continue;
      }
      const unitX = (end.xMm - start.xMm) / length;
      const unitY = (end.yMm - start.yMm) / length;
      const first = {
        xMm: Math.round(start.xMm + unitX * remaining),
        yMm: Math.round(start.yMm + unitY * remaining),
      };
      const second = {
        xMm: Math.round(first.xMm + unitX * (width as number)),
        yMm: Math.round(first.yMm + unitY * (width as number)),
      };
      const bottom = (elevation as number) + (baseOffset as number) + (sill as number);
      observations.push({
        ...commonObservation(
          source.descriptor.id,
          `opening:${opening.id}`,
          confidenceForCapture(proposal, opening.id),
        ),
        boundary: [
          { ...first, zMm: bottom },
          { ...second, zMm: bottom },
          { ...second, zMm: bottom + (height as number) },
          { ...first, zMm: bottom + (height as number) },
        ],
        hostPlaneObservationId: deterministicUuid(
          `c9:observation:${source.descriptor.id}:wall:${wall.id}:${String(index)}`,
        ),
        kind: opening.kind,
        levelKey: levelKey(elevation as number),
        observationType: "opening",
      });
      break;
    }
  }
  for (const stair of snapshot.elements.stairs) {
    const from = levels.get(stair.fromLevelId);
    const to = levels.get(stair.toLevelId);
    const fromElevation = from === undefined ? undefined : knownValue(from.elevationMm);
    const toElevation = to === undefined ? undefined : knownValue(to.elevationMm);
    const path = knownValue(stair.path);
    const width = knownValue(stair.widthMm);
    const rise = knownValue(stair.riseMm);
    const run = knownValue(stair.runMm);
    const steps = knownValue(stair.stepCount);
    if (
      [fromElevation, toElevation, path, width, rise, run, steps].some(
        (value) => value === undefined,
      )
    )
      continue;
    const pathValue = path as readonly Point2[];
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `stair:${stair.id}`,
        confidenceForCapture(proposal, stair.id),
      ),
      fromLevelKey: levelKey(fromElevation as number),
      observationType: "stair-hint",
      path: pathValue.map((point, index) => ({
        ...point,
        zMm: Math.round(
          (fromElevation as number) +
            (((toElevation as number) - (fromElevation as number)) * index) /
              Math.max(1, pathValue.length - 1),
        ),
      })),
      stepCount: steps,
      toLevelKey: levelKey(toElevation as number),
      totalRiseMm: rise,
      totalRunMm: run,
      widthMm: width,
    });
  }
  for (const object of snapshot.elements.fixedObjects) {
    const level = levels.get(object.levelId);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    const category = safeLabel(knownValue(object.category));
    const dimensions = knownValue(object.dimensions);
    const position = knownValue(object.placement.position);
    const rotation = knownValue(object.placement.rotationMilliDegrees);
    if (
      elevation === undefined ||
      category === undefined ||
      dimensions === undefined ||
      position === undefined
    )
      continue;
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `fixed:${object.id}`,
        confidenceForCapture(proposal, object.id),
      ),
      category,
      dimensionsMm: dimensions,
      levelKey: levelKey(elevation),
      observationType: "fixed-object-hint",
      position,
      rotationMilliDegrees: rotation ?? 0,
    });
  }
  return observations;
}

function planLevelMap(
  proposal: PlanProposal,
): Map<string, PlanProposal["candidates"][number] & { readonly kind: "level" }> {
  return new Map(
    proposal.candidates
      .filter(
        (
          candidate,
        ): candidate is Extract<PlanProposal["candidates"][number], { readonly kind: "level" }> =>
          candidate.kind === "level",
      )
      .map((candidate) => [candidate.candidateId, candidate]),
  );
}

function planObservations(source: FusionSourcePayload, registration: Registration): Observation[] {
  const proposal = planProposalSchema.parse(source.payload);
  const levels = planLevelMap(proposal);
  const walls = new Map(
    proposal.candidates
      .filter(
        (
          candidate,
        ): candidate is Extract<PlanProposal["candidates"][number], { readonly kind: "wall" }> =>
          candidate.kind === "wall",
      )
      .map((candidate) => [candidate.candidateId, candidate]),
  );
  const scale = registration.transform.scalePartsPerMillion;
  const rawZ = (projectZ: number): number =>
    Math.round(((projectZ - registration.transform.translationMm.zMm) * 1_000_000) / scale);
  const rawDimension = (dimension: number): number =>
    Math.max(1, Math.round((dimension * 1_000_000) / scale));
  const observations: Observation[] = [];
  for (const level of levels.values()) {
    const wallHeights = proposal.candidates
      .filter(
        (
          candidate,
        ): candidate is Extract<PlanProposal["candidates"][number], { readonly kind: "wall" }> =>
          candidate.kind === "wall" && candidate.levelCandidateId === level.candidateId,
      )
      .map(({ heightMillimetres }) => heightMillimetres)
      .filter((height): height is number => height !== undefined);
    const height = wallHeights[0];
    if (height === undefined || wallHeights.some((entry) => entry !== height)) continue;
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `level:${level.candidateId}`,
        level.confidence * 100,
      ),
      elevationMm: rawZ(level.elevationMillimetres),
      levelKey: levelKey(level.elevationMillimetres),
      name: safeLabel(level.suggestedName),
      observationType: "level-hint",
      storeyHeightMm: rawDimension(height),
    });
  }
  for (const wall of walls.values()) {
    const level = levels.get(wall.levelCandidateId);
    if (level === undefined || wall.heightMillimetres === undefined) continue;
    const start = { xMm: wall.start.x, yMm: wall.start.y };
    const end = { xMm: wall.end.x, yMm: wall.end.y };
    const normal = planeNormal(start, end);
    if (normal === undefined) continue;
    const bottom = rawZ(level.elevationMillimetres);
    const height = rawDimension(wall.heightMillimetres);
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `wall:${wall.candidateId}:0`,
        wall.confidence * 100,
      ),
      boundary: [
        { ...start, zMm: bottom },
        { ...end, zMm: bottom },
        { ...end, zMm: bottom + height },
        { ...start, zMm: bottom + height },
      ],
      levelKey: levelKey(level.elevationMillimetres),
      normalE9: normal,
      observationType: "plane",
      semantic: "wall-face",
    });
  }
  for (const opening of proposal.candidates.filter(
    (
      candidate,
    ): candidate is Extract<PlanProposal["candidates"][number], { readonly kind: "opening" }> =>
      candidate.kind === "opening",
  )) {
    const host = walls.get(opening.hostWallCandidateId);
    const level = levels.get(opening.levelCandidateId);
    if (
      host === undefined ||
      level === undefined ||
      opening.headHeightMillimetres === undefined ||
      opening.sillHeightMillimetres === undefined
    )
      continue;
    const bottom = rawZ(level.elevationMillimetres + opening.sillHeightMillimetres);
    const top = rawZ(level.elevationMillimetres + opening.headHeightMillimetres);
    observations.push({
      ...commonObservation(
        source.descriptor.id,
        `opening:${opening.candidateId}`,
        opening.confidence * 100,
      ),
      boundary: [
        { xMm: opening.start.x, yMm: opening.start.y, zMm: bottom },
        { xMm: opening.end.x, yMm: opening.end.y, zMm: bottom },
        { xMm: opening.end.x, yMm: opening.end.y, zMm: top },
        { xMm: opening.start.x, yMm: opening.start.y, zMm: top },
      ],
      hostPlaneObservationId: deterministicUuid(
        `c9:observation:${source.descriptor.id}:wall:${host.candidateId}:0`,
      ),
      kind: opening.openingKind === "unknown" ? "unknown" : opening.openingKind,
      levelKey: levelKey(level.elevationMillimetres),
      observationType: "opening",
    });
  }
  return observations;
}

function compareJson(left: unknown, right: unknown): number {
  return canonicalJson(left).localeCompare(canonicalJson(right));
}

function canonicalCycle(values: readonly unknown[]): readonly unknown[] {
  if (values.length < 3) return values;
  const variants: unknown[][] = [];
  for (const sequence of [values, [...values].reverse()]) {
    for (let index = 0; index < sequence.length; index += 1) {
      variants.push([...sequence.slice(index), ...sequence.slice(0, index)]);
    }
  }
  return variants.toSorted(compareJson)[0] ?? values;
}

function recordField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return (value as Readonly<Record<string, unknown>>)[key];
}

function canonicalManifestValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const source =
      parentKey === "boundary" || parentKey === "polygon" ? canonicalCycle(value) : value;
    const normalized = source.map((entry) => canonicalManifestValue(entry));
    if (parentKey === "sources") {
      return normalized.toSorted((left, right) => {
        const leftId = recordField(left, "sourceId");
        const rightId = recordField(right, "sourceId");
        return compareJson(leftId, rightId);
      });
    }
    if (parentKey === "observations") {
      return normalized.toSorted((left, right) => {
        const leftKey = [recordField(left, "observationType"), recordField(left, "observationId")];
        const rightKey = [
          recordField(right, "observationType"),
          recordField(right, "observationId"),
        ];
        return compareJson(leftKey, rightKey);
      });
    }
    return parentKey === "occludedEdgeIndices" ? normalized.toSorted(compareJson) : normalized;
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "manifestSha256")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalManifestValue(entry, key)]),
  );
}

function manifestSha256(manifest: Readonly<Record<string, unknown>>): string {
  return canonicalSha256(canonicalManifestValue(manifest));
}

function sourceProtocolRecord(
  source: FusionSourcePayload,
  registration: Registration,
  observations: readonly Observation[],
) {
  const toolIdentity = { name: "c9-source-observation-adapter", version: "1.0.0" };
  return {
    coordinateFrame: source.descriptor.coordinateFrame,
    evidence: {
      evidenceId: source.descriptor.referenceId,
      evidenceSha256: source.descriptor.sha256,
      schemaVersion: source.descriptor.schemaVersion,
    },
    evidenceState: source.descriptor.evidenceState,
    kind: source.descriptor.kind,
    observations,
    referenceId: source.descriptor.referenceId,
    registrationStatus: registration.status,
    rights: source.descriptor.rights,
    scaleStatus: registration.scaleStatus,
    schemaVersion: source.descriptor.schemaVersion,
    sourceId: source.descriptor.id,
    sourceSha256: source.descriptor.sha256,
    tool: {
      configSha256: canonicalSha256({ conversion: "c6-c7-observation-v1", unit: "mm" }),
      ...toolIdentity,
      toolSha256: canonicalSha256(toolIdentity),
    },
    transform: registration.transform,
    unit: "mm",
  };
}

function attribution(provenance: Provenance, key: string) {
  const evidenceIds = [
    ...new Set(provenance.claims.map(({ evidence }) => evidence.evidenceId)),
  ].sort();
  const state = provenance.state === "fused" ? "fused" : "source-derived";
  return {
    claimId: deterministicUuid(`c9:canonical-claim:${key}`),
    ...(state === "fused" ? { confidenceBasisPoints: provenance.confidenceBasisPoints } : {}),
    evidenceIds,
    method: { kind: "fusion" as const, name: "c9-scan-to-model-adapter", version: "1.0.0" },
    state,
    verification: { status: "not-reviewed" as const },
  };
}

function known<T>(value: T, provenance: Provenance, key: string) {
  return { attribution: attribution(provenance, key), knowledge: "known" as const, value };
}

function unknown(
  provenance: Provenance,
  key: string,
  reason: "not-observed" | "unsupported" = "not-observed",
) {
  return {
    attribution: {
      claimId: deterministicUuid(`c9:canonical-claim:${key}`),
      evidenceIds: [
        ...new Set(provenance.claims.map(({ evidence }) => evidence.evidenceId)),
      ].sort(),
      method: { kind: "fusion" as const, name: "c9-scan-to-model-adapter", version: "1.0.0" },
      reason,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

function candidateSnapshot(
  base: CanonicalHomeSnapshot,
  payload: z.infer<typeof proposalPayloadSchema>,
  unsupportedKinds: readonly string[],
): CanonicalHomeSnapshot {
  const geometry = payload.geometry;
  const limitations = [
    ...base.knownLimitations,
    {
      code: "FUSION_PROPOSAL_NOT_COMMITTED",
      detail:
        "This candidate remains proposal-only until reviewed and committed as typed operations.",
    },
    ...payload.diagnostics.map(({ code, message }) => ({
      code: `FUSION_${code}`.slice(0, 80),
      detail: message.slice(0, 500),
    })),
    ...unsupportedKinds.map((kind) => ({
      code: "FUSION_SOURCE_SEMANTICS_UNAVAILABLE",
      detail: `${kind} was registered but supplied no inline semantic observations and remains unknown.`,
    })),
  ];
  const uniqueLimitations = [
    ...new Map(limitations.map((item) => [`${item.code}:${item.detail}`, item])).values(),
  ].slice(0, 100);
  return canonicalHomeSnapshotSchema.parse({
    coordinateSystem: base.coordinateSystem,
    elements: {
      cameras: base.elements.cameras,
      finishes: base.elements.finishes,
      fixedObjects: geometry.fixedObjects.map((item) => ({
        category: known(item.category, item.provenance, `${item.id}:category`),
        dimensions: known(item.dimensionsMm, item.provenance, `${item.id}:dimensions`),
        elementType: "fixed-object",
        id: item.id,
        levelId: item.levelId,
        name: unknown(item.provenance, `${item.id}:name`),
        origin: attribution(item.provenance, `${item.id}:origin`),
        placement: {
          position: known(item.position, item.provenance, `${item.id}:position`),
          rotationMilliDegrees:
            item.rotationMilliDegrees === null
              ? unknown(item.provenance, `${item.id}:rotation`, "unsupported")
              : known(item.rotationMilliDegrees, item.provenance, `${item.id}:rotation`),
        },
      })),
      furnishings: base.elements.furnishings,
      levels: geometry.levels.map((item) => ({
        elementType: "level",
        elevationMm: known(item.elevationMm, item.provenance, `${item.id}:elevation`),
        id: item.id,
        name:
          item.name === null
            ? unknown(item.provenance, `${item.id}:name`)
            : known(item.name, item.provenance, `${item.id}:name`),
        origin: attribution(item.provenance, `${item.id}:origin`),
        storeyHeightMm: known(item.storeyHeightMm, item.provenance, `${item.id}:height`),
      })),
      lights: base.elements.lights,
      openings: geometry.openings.map((item) => ({
        elementType: "opening",
        heightMm: known(item.heightMm, item.provenance, `${item.id}:height`),
        hostWallId: item.hostWallId,
        id: item.id,
        kind: item.kind,
        name: unknown(item.provenance, `${item.id}:name`),
        offsetAlongHostMm: known(item.offsetAlongHostMm, item.provenance, `${item.id}:offset`),
        origin: attribution(item.provenance, `${item.id}:origin`),
        sillHeightMm: known(item.sillHeightMm, item.provenance, `${item.id}:sill`),
        swing: unknown(item.provenance, `${item.id}:swing`, "unsupported"),
        widthMm: known(item.widthMm, item.provenance, `${item.id}:width`),
      })),
      spaces: geometry.spaces.map((item) => ({
        boundary: known(item.boundary, item.provenance, `${item.id}:boundary`),
        boundedByElementIds: item.boundedByWallIds,
        classification:
          item.classification === null
            ? unknown(item.provenance, `${item.id}:classification`)
            : known(item.classification, item.provenance, `${item.id}:classification`),
        elementType: "space",
        id: item.id,
        levelId: item.levelId,
        name:
          item.name === null
            ? unknown(item.provenance, `${item.id}:name`)
            : known(item.name, item.provenance, `${item.id}:name`),
        origin: attribution(item.provenance, `${item.id}:origin`),
      })),
      stairs: geometry.stairs.map((item) => ({
        elementType: "stair",
        fromLevelId: item.fromLevelId,
        id: item.id,
        name: unknown(item.provenance, `${item.id}:name`),
        origin: attribution(item.provenance, `${item.id}:origin`),
        path: known(item.path, item.provenance, `${item.id}:path`),
        riseMm: known(item.totalRiseMm, item.provenance, `${item.id}:rise`),
        runMm: known(item.totalRunMm, item.provenance, `${item.id}:run`),
        stepCount: known(item.stepCount, item.provenance, `${item.id}:steps`),
        toLevelId: item.toLevelId,
        widthMm: known(item.widthMm, item.provenance, `${item.id}:width`),
      })),
      surfaces: geometry.surfaces.map((item) => ({
        boundary: known(item.boundary, item.provenance, `${item.id}:boundary`),
        elementType: "surface",
        id: item.id,
        kind: item.kind,
        levelId: item.levelId,
        name: unknown(item.provenance, `${item.id}:name`),
        origin: attribution(item.provenance, `${item.id}:origin`),
      })),
      walls: geometry.walls.map((item) => ({
        alignment: item.alignment,
        baseOffsetMm: known(item.baseOffsetMm, item.provenance, `${item.id}:base-offset`),
        elementType: "wall",
        heightMm: known(item.heightMm, item.provenance, `${item.id}:height`),
        id: item.id,
        levelId: item.levelId,
        name: unknown(item.provenance, `${item.id}:name`),
        origin: attribution(item.provenance, `${item.id}:origin`),
        path: known(item.path, item.provenance, `${item.id}:path`),
        thicknessMm: unknown(item.provenance, `${item.id}:thickness`, "not-observed"),
      })),
    },
    knownLimitations: uniqueLimitations,
    modelId: base.modelId,
    profile: "existing",
    projectId: base.projectId,
    ...(base.propertyId === undefined ? {} : { propertyId: base.propertyId }),
    schemaVersion: "c4-canonical-home-v1",
  });
}

function sourceClaims(
  sourceIds: readonly string[],
  sources: readonly FusionSourcePayload[],
  value: unknown,
) {
  return [...new Set(sourceIds)]
    .map((sourceId) => sources.find(({ descriptor }) => descriptor.id === sourceId))
    .filter((source): source is FusionSourcePayload => source !== undefined)
    .map(({ descriptor }) => ({
      sourceId: descriptor.id,
      state: descriptor.evidenceState,
      valueSha256: canonicalSha256(value),
    }));
}

function discrepancies(
  payload: z.infer<typeof proposalPayloadSchema>,
  sources: readonly FusionSourcePayload[],
): FusionDiscrepancy[] {
  const values: FusionDiscrepancy[] = [];
  for (const region of payload.unknownRegions) {
    const claims = sourceClaims(
      region.provenance.claims.map(({ sourceId }) => sourceId),
      sources,
      region,
    );
    if (claims.length === 0) continue;
    values.push(
      fusionDiscrepancySchema.parse({
        affectedElementIds: region.levelId === null ? [] : [region.levelId],
        code: "FUSION_UNKNOWN_REGION",
        id: deterministicUuid(`c9:discrepancy:unknown:${region.id}`),
        kind: "unknown-region",
        message: `Evidence remains unknown: ${region.reason}`.slice(0, 500),
        requiresHumanDecision: true,
        schemaVersion: "c9-discrepancy-v1",
        severity: "warning",
        sourceClaims: claims,
        suggestedOperations: [],
      }),
    );
  }
  for (const diagnostic of payload.diagnostics) {
    const claims = sourceClaims(diagnostic.sourceIds, sources, diagnostic);
    if (claims.length === 0) continue;
    values.push(
      fusionDiscrepancySchema.parse({
        affectedElementIds: [],
        code: diagnostic.code,
        id: deterministicUuid(`c9:discrepancy:diagnostic:${canonicalSha256(diagnostic)}`),
        kind: "unknown-region",
        message: diagnostic.message.slice(0, 500),
        requiresHumanDecision: true,
        schemaVersion: "c9-discrepancy-v1",
        severity: diagnostic.severity,
        sourceClaims: claims,
        suggestedOperations: [],
      }),
    );
  }
  return values.slice(0, 10_000);
}

function abstention(
  input: Parameters<FusionSemanticProducerPort["fit"]>[0],
  safeCode: string,
  detail: string,
  unsupportedKinds: readonly string[] = [],
): FusionSemanticOutput {
  const registered = input.registrations.filter(({ status }) => status !== "unregistered").length;
  return {
    coverage: {
      inputSourceCount: input.sources.length,
      levelsCovered: 0,
      registeredSourceCount: registered,
      unknownRegionCount: Math.max(1, unsupportedKinds.length),
    },
    discrepancies: [],
    findings: [
      { code: safeCode, detail, severity: "error" },
      ...unsupportedKinds.map((kind) => ({
        code: "FUSION_SOURCE_SEMANTICS_UNAVAILABLE",
        detail: `${kind} exposes no inline semantic observations in its immutable result payload.`,
        severity: "warning" as const,
      })),
    ],
    safeCode,
    status: "abstained",
  };
}

/** Strict stdin/stdout bridge to the provider-free C9 semantic fitter. */
export class PythonScanToModelProducer implements FusionSemanticProducerPort {
  readonly #pythonCommand: string;
  readonly #pythonModuleRoot: string;

  constructor(options: PythonScanToModelProducerOptions) {
    this.#pythonCommand = options.pythonCommand ?? "python3";
    this.#pythonModuleRoot = options.pythonModuleRoot;
  }

  async fit(
    input: Parameters<FusionSemanticProducerPort["fit"]>[0],
    signal?: AbortSignal,
  ): Promise<FusionSemanticOutput> {
    const registrations = new Map(
      input.registrations
        .filter(
          (registration): registration is Registration => registration.status !== "unregistered",
        )
        .map((registration) => [registration.sourceId, registration]),
    );
    const unsupportedKinds: string[] = [];
    const protocolSources = [];
    for (const source of input.sources) {
      const registration = registrations.get(source.descriptor.id);
      if (registration === undefined) continue;
      let observations: Observation[];
      try {
        if (source.descriptor.kind === "roomplan-proposal")
          observations = captureObservations(source);
        else if (source.descriptor.kind === "plan-proposal")
          observations = planObservations(source, registration);
        else {
          unsupportedKinds.push(source.descriptor.kind);
          continue;
        }
      } catch (error) {
        throw new FusionWorkerError("FUSION_SOURCE_SEMANTICS_INVALID", { cause: error });
      }
      if (observations.length === 0) {
        unsupportedKinds.push(source.descriptor.kind);
        continue;
      }
      protocolSources.push(sourceProtocolRecord(source, registration, observations));
    }
    if (protocolSources.length < 2 || new Set(protocolSources.map(({ kind }) => kind)).size < 2) {
      return abstention(
        input,
        "FUSION_INSUFFICIENT_SEMANTIC_SOURCES",
        "At least two registered source kinds with explicit semantic geometry are required.",
        unsupportedKinds,
      );
    }
    const manifest: Readonly<Record<string, unknown>> = {
      manifestSha256: "0".repeat(64),
      schemaVersion: "c9-semantic-source-manifest-v1",
      sources: protocolSources,
    };
    const sourceManifest = { ...manifest, manifestSha256: manifestSha256(manifest) };
    const request = {
      baseSnapshot: input.baseSnapshotReference,
      cancellation: { requested: signal?.aborted ?? false },
      jobId: input.jobId,
      limits: {
        maximumObservations: 10_000,
        maximumOutputBytes: Math.min(8_388_608, input.limits.maximumOutputBytes),
        maximumSources: input.limits.maximumSources,
        maximumVertices: 100_000,
        maximumWorkUnits: 2_000_000,
        timeoutMilliseconds: Math.min(30_000, input.limits.timeoutMilliseconds),
      },
      projectId: input.projectId,
      schemaVersion: "c9-scan-to-model-request-v1",
      sourceManifest,
    };
    let processResult;
    try {
      processResult = await runBoundedProcess(
        this.#pythonCommand,
        ["-m", "inference_worker.scan_to_model"],
        {
          maximumOutputBytes: input.limits.maximumOutputBytes,
          timeoutMs: Math.min(35_000, input.limits.timeoutMilliseconds),
        },
        signal,
        { cwd: this.#pythonModuleRoot, stdin: canonicalJson(request) },
      );
    } catch (error) {
      if (error instanceof ProcessExecutionError && error.reason === "aborted") {
        throw new FusionWorkerError("FUSION_CANCELLED", { cause: error });
      }
      const retryable =
        error instanceof ProcessExecutionError && ["spawn", "timeout"].includes(error.reason);
      throw new FusionWorkerError("FUSION_SEMANTIC_PROCESS_FAILED", { cause: error, retryable });
    }
    let result: z.infer<typeof scanResultSchema>;
    try {
      result = scanResultSchema.parse(JSON.parse(processResult.stdout));
    } catch (error) {
      throw new FusionWorkerError("FUSION_SEMANTIC_OUTPUT_INVALID", { cause: error });
    }
    if (
      result.jobId !== input.jobId ||
      result.projectId !== input.projectId ||
      result.sourceManifestSha256 !== sourceManifest.manifestSha256 ||
      result.baseSnapshot.snapshotSha256 !== input.baseSnapshotReference.snapshotSha256 ||
      result.payloadSha256 !== canonicalSha256(result.payload) ||
      result.status !== result.payload.status
    ) {
      throw new FusionWorkerError("FUSION_SEMANTIC_OUTPUT_FENCED");
    }
    if (result.payload.status === "cancelled") {
      throw new FusionWorkerError("FUSION_CANCELLED");
    }
    if (result.payload.status === "abstained") {
      return abstention(
        input,
        result.payload.safeCode,
        result.payload.diagnostics
          .map(({ message }) => message)
          .join(" ")
          .slice(0, 500),
        unsupportedKinds,
      );
    }
    const proposalPayload = proposalPayloadSchema.parse(result.payload);
    const snapshot = candidateSnapshot(input.baseSnapshot, proposalPayload, unsupportedKinds);
    const proposalDiscrepancies = discrepancies(proposalPayload, input.sources);
    const registeredCount = input.registrations.filter(
      ({ status }) => status !== "unregistered",
    ).length;
    const unknownRegionCount = proposalPayload.unknownRegions.length + unsupportedKinds.length;
    return {
      candidateSnapshot: snapshot,
      candidateSnapshotSha256: canonicalSnapshotSha256(snapshot),
      coverage: {
        inputSourceCount: input.sources.length,
        levelsCovered: proposalPayload.geometry.levels.length,
        registeredSourceCount: registeredCount,
        unknownRegionCount,
      },
      discrepancies: proposalDiscrepancies,
      status:
        proposalPayload.status === "proposal" &&
        unknownRegionCount === 0 &&
        registeredCount === input.sources.length
          ? "full-house-proposal"
          : "partial-proposal",
    };
  }
}
