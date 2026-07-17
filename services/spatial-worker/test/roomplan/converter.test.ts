import { captureProposalResultSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  convertRoomPlanToProposal,
  createRoomPlanAbstention,
  type RoomPlanConversionContext,
} from "../../src/roomplan/converter.js";
import { canonicalJson } from "../../src/roomplan/canonical.js";
import { SYNTHETIC_IDS, syntheticNormalized, syntheticSources } from "./fixtures.js";

function context(): RoomPlanConversionContext {
  const sources = syntheticSources();
  const normalized = sources.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
  if (normalized === undefined) throw new Error("Synthetic normalized artifact is absent.");
  return {
    captureSessionId: SYNTHETIC_IDS.captureSession,
    createdAt: "2026-01-01T12:02:00.000Z",
    normalizedArtifactId: SYNTHETIC_IDS.normalizedArtifact,
    normalizedInputSha256: normalized.sha256,
    packageId: SYNTHETIC_IDS.package,
    packageManifestSha256: "f".repeat(64),
    projectId: SYNTHETIC_IDS.project,
    proposalId: SYNTHETIC_IDS.proposal,
  };
}

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("The synthetic converter fixture is incomplete.");
  return value;
}

describe("convertRoomPlanToProposal", () => {
  it("produces a schema-valid existing-state proposal with complete mappings and explicit unknowns", () => {
    const result = convertRoomPlanToProposal(syntheticNormalized(), context());
    expect(captureProposalResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe("proposal");
    if (result.status !== "proposal") throw new Error("Expected a proposal.");
    expect(result.proposedSnapshot.profile).toBe("existing");
    expect(result.proposedSnapshot.projectId).toBe(SYNTHETIC_IDS.project);
    expect(result.proposedSnapshot.coordinateSystem.axes).toEqual({
      x: "east",
      y: "north",
      z: "up",
    });
    expect(result.proposedSnapshot.coordinateSystem.globalAnchor.status).toBe("not-established");
    expect(result.proposedSnapshot.elements.walls).toHaveLength(1);
    expect(result.proposedSnapshot.elements.spaces).toHaveLength(1);
    expect(result.proposedSnapshot.elements.openings).toHaveLength(1);
    expect(result.proposedSnapshot.elements.furnishings).toHaveLength(1);
    const wall = result.proposedSnapshot.elements.walls[0];
    expect(wall?.path.knowledge).toBe("known");
    expect(wall?.path.knowledge === "known" ? wall.path.value : undefined).toEqual([
      { xMm: -2_000, yMm: -1_500 },
      { xMm: 2_000, yMm: -1_500 },
    ]);
    expect(wall?.thicknessMm.knowledge).toBe("unknown");
    const opening = result.proposedSnapshot.elements.openings[0];
    expect(
      opening?.offsetAlongHostMm.knowledge === "known"
        ? opening.offsetAlongHostMm.value
        : undefined,
    ).toBe(2_550);
    expect(result.elementSources).toHaveLength(5);
    expect(result.unresolvedSourceEntityIds).toEqual([]);
  });

  it("is byte-for-byte deterministic under source collection reordering", () => {
    const input = syntheticNormalized();
    const reordered = {
      ...input,
      objects: [...input.objects].reverse(),
      rooms: [...input.rooms].reverse(),
      surfaces: [...input.surfaces].reverse(),
    };
    expect(canonicalJson(convertRoomPlanToProposal(reordered, context()))).toBe(
      canonicalJson(convertRoomPlanToProposal(input, context())),
    );
  });

  it("leaves curves, stairs, and unsupported objects unresolved instead of inventing geometry", () => {
    const input = structuredClone(syntheticNormalized());
    input.surfaces[0] = {
      ...present(input.surfaces[0]),
      curve: {
        centreXMicrometres: 0,
        centreZMicrometres: 0,
        endNanoradians: 1_000_000_000,
        radiusMicrometres: 2_000_000,
        startNanoradians: 0,
      },
    };
    input.objects.push({
      ...present(input.objects[0]),
      category: "stairs",
      sourceIdentifier: "50000000-0000-4000-8000-000000000099",
    });
    const result = convertRoomPlanToProposal(input, context());
    expect(result.status).toBe("proposal");
    if (result.status !== "proposal") throw new Error("Expected a proposal.");
    expect(result.unresolvedSourceEntityIds).toEqual(
      [SYNTHETIC_IDS.opening, SYNTHETIC_IDS.wall, "50000000-0000-4000-8000-000000000099"].sort(),
    );
    expect(result.proposedSnapshot.elements.walls).toEqual([]);
    expect(result.proposedSnapshot.elements.stairs).toEqual([]);
    expect(result.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CURVED_WALL_UNRESOLVED",
        "OPENING_PARENT_UNRESOLVED",
        "STAIR_CONNECTIVITY_UNKNOWN",
      ]),
    );
  });

  it("abstains for low quality and topology with no safely representable boundary", () => {
    const lowQuality = structuredClone(syntheticNormalized());
    lowQuality.quality.worldMappingStatusAtFinish = "not-available";
    const lowResult = convertRoomPlanToProposal(lowQuality, context());
    expect(lowResult.status).toBe("abstained");
    expect(lowResult.status === "abstained" ? lowResult.code : undefined).toBe("low-quality");

    const empty = structuredClone(syntheticNormalized());
    empty.surfaces = empty.surfaces.filter(
      ({ category }) => category !== "wall" && category !== "floor",
    );
    const emptyResult = convertRoomPlanToProposal(empty, context());
    expect(emptyResult.status).toBe("abstained");
    expect(emptyResult.status === "abstained" ? emptyResult.code : undefined).toBe(
      "ambiguous-topology",
    );
  });

  it("does not emit an opening whose observed interval lies outside its host wall", () => {
    const input = structuredClone(syntheticNormalized());
    present(input.surfaces[2]).transform.translationMicrometres.x = 3_000_000;
    const result = convertRoomPlanToProposal(input, context());
    expect(result.status).toBe("proposal");
    if (result.status !== "proposal") throw new Error("Expected a bounded proposal.");
    expect(result.proposedSnapshot.elements.openings).toEqual([]);
    expect(result.unresolvedSourceEntityIds).toContain(SYNTHETIC_IDS.opening);
    expect(result.findings.map(({ code }) => code)).toContain("OPENING_OFFSET_UNRESOLVED");
  });

  it("leaves self-intersecting and collinear floor boundaries unresolved", () => {
    for (const corners of [
      [
        { x: -1_000_000, y: 0, z: -1_000_000 },
        { x: 1_000_000, y: 0, z: 1_000_000 },
        { x: -1_000_000, y: 0, z: 1_000_000 },
        { x: 1_000_000, y: 0, z: -1_000_000 },
      ],
      [
        { x: -1_000_000, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1_000_000, y: 0, z: 0 },
      ],
    ]) {
      const input = structuredClone(syntheticNormalized());
      present(input.surfaces[1]).polygonCornersMicrometres = corners;
      const result = convertRoomPlanToProposal(input, context());
      expect(result.status).toBe("proposal");
      if (result.status !== "proposal") throw new Error("Expected a bounded proposal.");
      expect(result.proposedSnapshot.elements.spaces).toEqual([]);
      expect(result.unresolvedSourceEntityIds).toContain(SYNTHETIC_IDS.floor);
      expect(result.findings.map(({ code }) => code)).toContain("FLOOR_BOUNDARY_UNRESOLVED");
    }
  });

  it("builds deterministic explicit abstentions", () => {
    const first = createRoomPlanAbstention(context(), "source-mismatch", "Synthetic mismatch.");
    const second = createRoomPlanAbstention(context(), "source-mismatch", "Synthetic mismatch.");
    expect(first).toEqual(second);
    expect(first.status).toBe("abstained");
    expect(first.status === "abstained" ? first.retryable : true).toBe(false);
  });
});
