import { canonicalHomeSnapshotSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  asBuiltHomeSnapshot,
  canonicalFixtureIds,
  canonicalProfileFixtures,
  existingHomeSnapshot,
  preservedUnknownFactCodes,
  proposedHomeSnapshot,
} from "../src/models/index.js";

function collectClaimIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child) => collectClaimIds(child));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...(typeof record.claimId === "string" ? [record.claimId] : []),
      ...Object.entries(record)
        .filter(([key]) => key !== "claimId")
        .flatMap(([, child]) => collectClaimIds(child)),
    ];
  }
  return [];
}

describe("C4 canonical profile fixtures", () => {
  it.each(Object.entries(canonicalProfileFixtures))(
    "parses the %s snapshot against the frozen schema",
    (_profile, snapshot) => {
      expect(canonicalHomeSnapshotSchema.parse(snapshot)).toEqual(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(new Set(collectClaimIds(snapshot)).size).toBe(collectClaimIds(snapshot).length);
    },
  );

  it("contains every frozen canonical element collection in a two-level home", () => {
    const elements = existingHomeSnapshot.elements;
    expect(elements.levels).toHaveLength(2);
    expect(elements.spaces.length).toBeGreaterThanOrEqual(4);
    expect(elements.surfaces.length).toBeGreaterThanOrEqual(4);
    expect(elements.walls.length).toBeGreaterThanOrEqual(8);
    expect(elements.openings.some((opening) => opening.kind === "door")).toBe(true);
    expect(elements.openings.some((opening) => opening.kind === "window")).toBe(true);
    expect(elements.stairs).toHaveLength(1);
    expect(elements.fixedObjects).toHaveLength(1);
    expect(elements.furnishings).toHaveLength(1);
    expect(elements.finishes).toHaveLength(1);
    expect(elements.lights).toHaveLength(1);
    expect(elements.cameras).toHaveLength(1);
  });

  it("keeps profile state and derivation explicit", () => {
    expect(existingHomeSnapshot.profile).toBe("existing");
    expect(existingHomeSnapshot.derivedFromSnapshotSha256).toBeUndefined();
    expect(proposedHomeSnapshot.profile).toBe("proposed");
    expect(proposedHomeSnapshot.derivedFromSnapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(asBuiltHomeSnapshot.profile).toBe("as-built");
    expect(asBuiltHomeSnapshot.derivedFromSnapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("preserves unknown structural facts without inventing a wall role", () => {
    for (const snapshot of Object.values(canonicalProfileFixtures)) {
      const codes = snapshot.knownLimitations.map((limitation) => limitation.code);
      expect(codes).toEqual(expect.arrayContaining([...preservedUnknownFactCodes]));
      expect(JSON.stringify(snapshot)).not.toMatch(/load[- ]?bearing|non[- ]?load[- ]?bearing/iu);
    }
  });

  it("uses opaque stable IDs and no real customer or address payload", () => {
    expect(existingHomeSnapshot.projectId).toBe(canonicalFixtureIds.project);
    expect(existingHomeSnapshot.propertyId).toBe(canonicalFixtureIds.property);
    expect(JSON.stringify(existingHomeSnapshot)).not.toMatch(
      /\b[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}\b|uprn|homeowner@|@example\./iu,
    );
  });

  it("survives a JSON round trip without profile or unknown-state loss", () => {
    for (const snapshot of Object.values(canonicalProfileFixtures)) {
      const roundTripped = canonicalHomeSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
      expect(roundTripped).toEqual(snapshot);
    }
  });
});
