import type { DesignBrief } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveDeterministicDesignConstraints,
  runDeterministicDesignEngine,
} from "../src/index.js";
import {
  attribution,
  constraintRequest,
  id,
  ids,
  makeExistingSnapshot,
  makeRequest,
} from "./support.js";

function preferenceEntry(): DesignBrief["entries"][number] {
  return {
    category: "style-aesthetic",
    classification: "preference",
    id: id(700),
    priority: 3,
    provenance: {
      capturedAt: "2026-07-18T09:30:00.000Z",
      method: "user-stated",
      statedByUserId: ids.actor,
    },
    roomOrLevelElementIds: [ids.space],
    statement: "Synthetic preference that is not interpreted as geometry.",
    status: "active",
  };
}

describe("candidate-independent constraint preflight", () => {
  it("freezes common policy constraints for the C11 preference-only production slice", () => {
    const request = makeRequest({ briefEntries: [preferenceEntry()] });
    const result = deriveDeterministicDesignConstraints(constraintRequest(request));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.constraints.length).toBeGreaterThanOrEqual(2);
    expect(result.constraints.every(({ kind }) => kind === "retain-element")).toBe(true);
    expect(
      result.constraints.map((constraint) =>
        constraint.kind === "retain-element" ? constraint.retainedElementId : "",
      ),
    ).toEqual(expect.arrayContaining([ids.level, ids.space]));
    expect(JSON.stringify(result.constraints)).not.toContain(ids.elementA);
    expect(JSON.stringify(result.constraints)).not.toContain(ids.elementB);
    expect(
      deriveDeterministicDesignConstraints({
        ...constraintRequest(request),
        candidateTemplates: request.candidateTemplates,
      }),
    ).toMatchObject({ abstention: { code: "INVALID_INPUT", stage: "parse" }, ok: false });
    const differentPolicy = deriveDeterministicDesignConstraints(
      constraintRequest(
        makeRequest({
          briefEntries: [preferenceEntry()],
          touch: { keepOut: "allow", obstacle: "forbid", room: "forbid" },
        }),
      ),
    );
    expect(differentPolicy.ok).toBe(true);
    if (differentPolicy.ok) {
      expect(differentPolicy.constraintsSha256).not.toBe(result.constraintsSha256);
    }
  });

  it("matches full-engine constraints across distinct templates and insertion permutations", () => {
    const keepOuts = [
      {
        id: id(710),
        levelId: ids.level,
        polygon: [
          { xMm: 100, yMm: 3_500 },
          { xMm: 200, yMm: 3_500 },
          { xMm: 200, yMm: 3_600 },
          { xMm: 100, yMm: 3_600 },
        ],
        sourceElementIds: [],
      },
      {
        id: id(711),
        levelId: ids.level,
        polygon: [
          { xMm: 4_800, yMm: 3_500 },
          { xMm: 4_900, yMm: 3_500 },
          { xMm: 4_900, yMm: 3_600 },
          { xMm: 4_800, yMm: 3_600 },
        ],
        sourceElementIds: [],
      },
    ] as const;
    const request = makeRequest({ briefEntries: [preferenceEntry()], keepOuts });
    const preflight = deriveDeterministicDesignConstraints(constraintRequest(request));
    const engine = runDeterministicDesignEngine(request);
    expect(preflight.ok).toBe(true);
    expect(engine.ok).toBe(true);
    if (!preflight.ok || !engine.ok) return;

    expect(engine.constraints).toEqual(preflight.constraints);
    expect(engine.constraintsSha256).toBe(preflight.constraintsSha256);
    const expectedIds = engine.constraints.map(({ id: constraintId }) => constraintId).sort();
    for (const candidate of engine.candidates) {
      const results = candidate.operationBundle.constraintResults;
      const resultIds = results.map(({ constraintId }) => constraintId).sort();
      // Mirrors L3 publication: one and only one result for every frozen job constraint.
      expect(results).toHaveLength(expectedIds.length);
      expect(new Set(resultIds).size).toBe(expectedIds.length);
      expect(resultIds).toEqual(expectedIds);
      expect(
        results.filter(({ strength }) => strength === "hard").every(({ passed }) => passed),
      ).toBe(true);
    }

    const permuted = {
      ...request,
      candidateTemplates: [...request.candidateTemplates].reverse(),
      keepOuts: [...request.keepOuts].reverse(),
    };
    const permutedPreflight = deriveDeterministicDesignConstraints(constraintRequest(permuted));
    const permutedEngine = runDeterministicDesignEngine(permuted);
    expect(permutedPreflight).toEqual(preflight);
    expect(permutedEngine).toEqual(engine);
  });

  it("abstains instead of falsely passing a fact for only one generated template element", () => {
    const entry: DesignBrief["entries"][number] = {
      category: "minimum-dimension",
      classification: "hard-constraint",
      id: id(720),
      priority: 5,
      provenance: {
        capturedAt: "2026-07-18T09:30:00.000Z",
        method: "user-stated",
        statedByUserId: ids.actor,
      },
      roomOrLevelElementIds: [ids.space],
      statement: "Synthetic template-specific fact.",
      status: "active",
    };
    const request = makeRequest({
      briefConstraintFacts: [
        {
          assetElementIds: [ids.elementA],
          briefEntryId: entry.id,
          clearanceMm: 900,
          kind: "minimum-clearance",
          scope: "all-sides",
        },
      ],
      briefEntries: [entry],
    });
    const preflight = deriveDeterministicDesignConstraints(constraintRequest(request));
    const engine = runDeterministicDesignEngine(request);
    expect(preflight).toMatchObject({
      abstention: {
        code: "UNSUPPORTED_HARD_REQUIREMENT",
        professionalReviewReasons: ["insufficient-evidence"],
        stage: "derive",
      },
      ok: false,
    });
    expect(engine).toEqual(preflight);
  });

  it("abstains when required common geometry cannot fit the 200-constraint ceiling", () => {
    const existing = makeExistingSnapshot();
    const baseSpace = existing.elements.spaces[0];
    if (baseSpace === undefined) throw new Error("Synthetic fixture must contain one space.");
    for (let index = 1; index < 200; index += 1) {
      existing.elements.spaces.push({ ...structuredClone(baseSpace), id: id(800 + index) });
    }
    const request = makeRequest({ existing });
    expect(deriveDeterministicDesignConstraints(constraintRequest(request))).toMatchObject({
      abstention: { code: "RESOURCE_LIMIT", stage: "derive" },
      ok: false,
    });
  });

  it("abstains before freezing an unknown common room boundary", () => {
    const existing = makeExistingSnapshot();
    const space = existing.elements.spaces[0];
    if (space === undefined) throw new Error("Synthetic fixture must contain one space.");
    space.boundary = {
      attribution: {
        claimId: ids.claim,
        evidenceIds: [],
        method: attribution.method,
        reason: "not-observed",
        state: "unknown",
        verification: { status: "not-reviewed" },
      },
      knowledge: "unknown",
    };
    const request = makeRequest({ existing });
    expect(deriveDeterministicDesignConstraints(constraintRequest(request))).toMatchObject({
      abstention: { code: "INSUFFICIENT_GEOMETRY", stage: "validate" },
      ok: false,
    });
  });
});
