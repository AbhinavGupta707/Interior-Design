import {
  canonicalHomeSnapshotSchema,
  captureProposalResultSchema,
  planProposalSchema,
  type CanonicalHomeSnapshot,
  type FusionSource,
} from "@interior-design/contracts";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalSnapshotSha256 } from "../../src/model-fusion/canonical.js";
import { GeometryKernelRegistrationProducer } from "../../src/model-fusion/registration.js";
import { PythonScanToModelProducer } from "../../src/model-fusion/semantic.js";
import type { FusionSourcePayload } from "../../src/model-fusion/types.js";
import { c9ProducerLimits } from "../../src/model-fusion/protocol.js";
import { captureProposalFixture } from "./support.js";

const ids = {
  asset: "ca000000-0000-4000-8000-000000000101",
  job: "ca000000-0000-4000-8000-000000000102",
  planProposal: "ca000000-0000-4000-8000-000000000103",
  planSource: "ca000000-0000-4000-8000-000000000104",
  roomSource: "ca000000-0000-4000-8000-000000000105",
  snapshot: "ca000000-0000-4000-8000-000000000106",
} as const;

function known<T>(
  value: { readonly knowledge: "known"; readonly value: T } | { readonly knowledge: "unknown" },
): T {
  if (value.knowledge === "unknown")
    throw new Error("The production producer fixture requires known geometry.");
  return value.value;
}

function planPayload(snapshot: CanonicalHomeSnapshot) {
  const levelCandidates = snapshot.elements.levels.map((level, index) => ({
    candidateId: level.id,
    confidence: 90,
    elevationMillimetres: known(level.elevationMm),
    kind: "level" as const,
    sourceRegion: {
      maximum: { x: 10 + index, y: 10 + index },
      minimum: { x: index, y: index },
    },
    suggestedName:
      level.name.knowledge === "known" ? level.name.value : `Level ${String(index + 1)}`,
  }));
  const wallCandidates = snapshot.elements.walls.map((wall, index) => {
    const line = known(wall.path);
    const start = line[0];
    const end = line.at(-1);
    if (start === undefined || end === undefined) throw new Error("Fixture wall has no endpoints.");
    return {
      candidateId: wall.id,
      confidence: 90,
      end: { x: end.xMm, y: end.yMm },
      heightMillimetres: known(wall.heightMm),
      kind: "wall" as const,
      levelCandidateId: wall.levelId,
      sourceRegion: {
        maximum: { x: 100 + index, y: 100 + index },
        minimum: { x: 90 + index, y: 90 + index },
      },
      start: { x: start.xMm, y: start.yMm },
      thicknessMillimetres:
        wall.thicknessMm.knowledge === "known" ? wall.thicknessMm.value : undefined,
    };
  });
  return planProposalSchema.parse({
    candidates: [...levelCandidates, ...wallCandidates],
    createdAt: "2026-07-17T12:00:00.000Z",
    findings: [],
    jobId: ids.job,
    normalizedInputSha256: "4".repeat(64),
    overallConfidence: 90,
    parser: {
      adapterId: "c9-production-test-plan",
      adapterVersion: "1.0.0",
      manifestSha256: "5".repeat(64),
      mode: "deterministic-fixture",
      normalizers: [{ name: "c9-production-test-normalizer", version: "1.0.0" }],
    },
    projectId: snapshot.projectId,
    proposalId: ids.planProposal,
    schemaVersion: "c6-plan-proposal-v1",
    source: {
      assetId: ids.asset,
      byteSize: 1_024,
      coordinateSpace: "fixture-microunits",
      detectedMimeType: "image/png",
      heightSourceUnits: 20_000,
      pageIndex: 0,
      projectId: snapshot.projectId,
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sha256: "6".repeat(64),
      widthSourceUnits: 20_000,
    },
    status: "proposal",
    unresolvedRegions: [],
  });
}

function captureWithKnownLevels() {
  const capture = captureProposalFixture();
  const proposedSnapshot = canonicalHomeSnapshotSchema.parse({
    ...capture.proposedSnapshot,
    elements: {
      ...capture.proposedSnapshot.elements,
      levels: capture.proposedSnapshot.elements.levels.map((level, index) => {
        const matchingWall = capture.proposedSnapshot.elements.walls.find(
          (wall) => wall.levelId === level.id && wall.heightMm.knowledge === "known",
        );
        const matchingHeight =
          matchingWall?.heightMm.knowledge === "known" ? matchingWall.heightMm.value : 3_000;
        return {
          ...level,
          elevationMm: {
            attribution: level.origin,
            knowledge: "known",
            value: index * 3_000,
          },
          name:
            level.name.knowledge === "known"
              ? level.name
              : {
                  attribution: level.origin,
                  knowledge: "known",
                  value: `Level ${String(index + 1)}`,
                },
          storeyHeightMm:
            level.storeyHeightMm.knowledge === "known"
              ? level.storeyHeightMm
              : {
                  attribution: level.origin,
                  knowledge: "known",
                  value: matchingHeight,
                },
        };
      }),
    },
  });
  return captureProposalResultSchema.parse({ ...capture, proposedSnapshot });
}

function sources(): {
  readonly base: CanonicalHomeSnapshot;
  readonly payloads: readonly FusionSourcePayload[];
} {
  const capture = captureWithKnownLevels();
  if (capture.status !== "proposal")
    throw new Error("The RoomPlan fixture did not produce a proposal.");
  const base = capture.proposedSnapshot;
  const descriptors: readonly FusionSource[] = [
    {
      coordinateFrame: "project-local",
      elementCount: planPayload(base).candidates.length,
      evidenceState: "source-derived",
      id: ids.planSource,
      kind: "plan-proposal",
      referenceId: ids.planProposal,
      rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
      scaleStatus: "metric-validated",
      schemaVersion: "c6-plan-proposal-v1",
      sha256: "7".repeat(64),
    },
    {
      coordinateFrame: "project-local",
      elementCount: capture.elementSources.length,
      evidenceState: "source-derived",
      id: ids.roomSource,
      kind: "roomplan-proposal",
      referenceId: capture.proposalId,
      rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
      scaleStatus: "metric-validated",
      schemaVersion: "c7-capture-proposal-v1",
      sha256: "8".repeat(64),
    },
  ];
  return {
    base,
    payloads: [
      { descriptor: descriptors[0] as FusionSource, payload: planPayload(base) },
      { descriptor: descriptors[1] as FusionSource, payload: capture },
    ],
  };
}

describe("C9 production fusion producers", () => {
  it("registers project-local and explicit source-local control points deterministically", async () => {
    const fixture = sources();
    const firstSource = fixture.payloads[0];
    if (firstSource === undefined) throw new Error("The plan fixture source is missing.");
    const sourceLocal: FusionSourcePayload = {
      payload: firstSource.payload,
      descriptor: {
        ...firstSource.descriptor,
        coordinateFrame: "source-local-arbitrary",
        scaleStatus: "unknown",
      },
    };
    const producer = new GeometryKernelRegistrationProducer();
    const results = await producer.register({
      anchorGroups: [
        {
          sourceId: sourceLocal.descriptor.id,
          anchors: [
            {
              anchorId: "ca000000-0000-4000-8000-000000000111",
              confidenceBasisPoints: 10_000,
              method: "shared-control-point",
              sourcePoint: { xMm: 0, yMm: 0, zMm: 0 },
              projectPoint: { xMm: 100, yMm: 200, zMm: 0 },
            },
            {
              anchorId: "ca000000-0000-4000-8000-000000000112",
              confidenceBasisPoints: 10_000,
              method: "shared-control-point",
              sourcePoint: { xMm: 1_000, yMm: 0, zMm: 0 },
              projectPoint: { xMm: 1_100, yMm: 200, zMm: 0 },
            },
            {
              anchorId: "ca000000-0000-4000-8000-000000000113",
              confidenceBasisPoints: 10_000,
              method: "shared-control-point",
              sourcePoint: { xMm: 0, yMm: 1_000, zMm: 0 },
              projectPoint: { xMm: 100, yMm: 1_200, zMm: 0 },
            },
          ],
        },
      ],
      limits: c9ProducerLimits,
      sources: [sourceLocal, fixture.payloads[1] as FusionSourcePayload],
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      method: "control-points",
      scaleStatus: "metric-estimated",
      status: "registered",
      transform: { translationMm: { xMm: 100, yMm: 200, zMm: 0 } },
    });
    expect(results[1]).toMatchObject({ method: "identity", status: "registered" });
  });

  it("runs real C6+C7 observations through the bounded Python fitter and returns a canonical proposal", async () => {
    const fixture = sources();
    const registration = new GeometryKernelRegistrationProducer();
    const registrations = await registration.register({
      anchorGroups: [],
      limits: c9ProducerLimits,
      sources: fixture.payloads,
    });
    const producer = new PythonScanToModelProducer({
      pythonCommand: "python3",
      pythonModuleRoot: path.resolve(process.cwd(), "../inference-worker/src"),
    });
    const result = await producer.fit({
      baseSnapshot: fixture.base,
      baseSnapshotReference: {
        modelId: fixture.base.modelId,
        profile: "existing",
        snapshotId: ids.snapshot,
        snapshotSha256: "9".repeat(64),
      },
      inferencePolicy: "label-and-expose",
      jobId: ids.job,
      limits: c9ProducerLimits,
      projectId: fixture.base.projectId,
      registrations,
      sources: fixture.payloads,
    });
    if (result.status === "abstained") {
      throw new Error(`The real fitting fixture abstained: ${JSON.stringify(result)}`);
    }
    expect(result.coverage).toMatchObject({ inputSourceCount: 2, registeredSourceCount: 2 });
    expect(result.candidateSnapshot.elements.levels.length).toBeGreaterThan(0);
    expect(result.candidateSnapshot.elements.walls.length).toBeGreaterThan(0);
    expect(canonicalHomeSnapshotSchema.parse(result.candidateSnapshot)).toEqual(
      result.candidateSnapshot,
    );
    expect(result.candidateSnapshotSha256).toBe(canonicalSnapshotSha256(result.candidateSnapshot));
    expect(JSON.stringify(result)).not.toMatch(/credential|objectKey|canonicalWrite|https?:\/\//u);
  }, 30_000);
});
