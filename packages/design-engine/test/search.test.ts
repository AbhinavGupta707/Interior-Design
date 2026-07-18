import { designOptionSetSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { sha256Canonical } from "../src/canonical.js";
import { runDeterministicDesignEngine } from "../src/index.js";
import type { DesignCandidateTemplate } from "../src/types.js";
import { furnishingOperation, id, ids, makeAsset, makeRequest, template } from "./support.js";

function thirdDominatedTemplate(): DesignCandidateTemplate {
  const operation = furnishingOperation({
    elementId: id(600),
    operationId: id(601),
    xMm: 2_500,
    yMm: 2_500,
  });
  return template({
    direction: "storage-first",
    elementId: operation.element.id,
    objectives: [4_000, 4_000],
    operation,
    templateId: ids.templateC,
  });
}

function permutations<TValue>(values: readonly TValue[]): readonly (readonly TValue[])[] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [
      value,
      ...rest,
    ]),
  );
}

describe("bounded Pareto search", () => {
  it("rejects a dominated candidate and is invariant to every template insertion permutation", () => {
    const request = makeRequest();
    const templates = [...request.candidateTemplates, thirdDominatedTemplate()];
    const baseline = runDeterministicDesignEngine({ ...request, candidateTemplates: templates });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    expect(baseline.evaluatedCandidateCount).toBe(3);
    expect(baseline.candidates.map(({ templateId }) => templateId)).not.toContain(ids.templateC);
    permutations(templates).forEach((candidateTemplates) => {
      expect(runDeterministicDesignEngine({ ...request, candidateTemplates })).toEqual(baseline);
    });
  });

  it("treats narrative and generated UUID-only changes as zero diversity", () => {
    const asset = makeAsset();
    const leftOperation = furnishingOperation({
      asset,
      elementId: id(610),
      operationId: id(611),
      reason: "First narrative that must not affect diversity.",
      xMm: 2_000,
      yMm: 1_500,
    });
    const rightOperation = furnishingOperation({
      asset,
      elementId: id(612),
      operationId: id(613),
      reason: "Different prose with identical computational content.",
      xMm: 2_000,
      yMm: 1_500,
    });
    const candidates = [
      template({
        direction: "circulation-first",
        elementId: leftOperation.element.id,
        objectives: [8_000, 6_000],
        operation: leftOperation,
        templateId: id(614),
      }),
      template({
        direction: "conversation-first",
        elementId: rightOperation.element.id,
        objectives: [8_000, 6_000],
        operation: rightOperation,
        templateId: id(615),
      }),
    ];
    const result = runDeterministicDesignEngine(
      makeRequest({ assets: [asset], candidateTemplates: candidates }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.abstention.code).toBe("NO_FEASIBLE_DIVERSE_SET");
  });

  it("does not let a preference narrative alter geometry, search ordering or declarations", () => {
    const request = makeRequest();
    const baseline = runDeterministicDesignEngine(request);
    expect(baseline.ok).toBe(true);
    const acceptedBrief = {
      ...request.acceptedBrief,
      entries: [
        {
          category: "style-aesthetic" as const,
          classification: "preference" as const,
          id: id(616),
          priority: 3,
          provenance: {
            capturedAt: "2026-07-18T09:30:00.000Z",
            method: "user-stated" as const,
            statedByUserId: ids.actor,
          },
          roomOrLevelElementIds: [],
          statement: "A private narrative that is not a computational geometry input.",
          status: "active" as const,
        },
      ],
    };
    const acceptedBriefContentSha256 = sha256Canonical({
      entries: acceptedBrief.entries,
      id: acceptedBrief.id,
      ...(acceptedBrief.modelReference === undefined
        ? {}
        : { modelReference: acceptedBrief.modelReference }),
      projectId: acceptedBrief.projectId,
      referenceBoard: acceptedBrief.referenceBoard,
      schemaVersion: acceptedBrief.schemaVersion,
    });
    expect(
      runDeterministicDesignEngine({
        ...request,
        acceptedBrief,
        acceptedBriefContentSha256,
      }),
    ).toEqual(baseline);
  });

  it("computes complete asset, assignment, placement, material and operation diversity", () => {
    const warm = makeAsset();
    const cool = makeAsset({
      contentSha256: "1".repeat(64),
      id: id(620),
      metadataSha256: "2".repeat(64),
      versionId: id(621),
    });
    const warmOperation = furnishingOperation({
      asset: warm,
      elementId: id(622),
      operationId: id(623),
      xMm: 1_200,
      yMm: 1_000,
    });
    const coolOperation = furnishingOperation({
      asset: cool,
      elementId: id(624),
      operationId: id(625),
      xMm: 3_200,
      yMm: 1_000,
    });
    const candidates = [
      template({
        assignmentKey: "primary-seat",
        direction: "circulation-first",
        elementId: warmOperation.element.id,
        objectives: [9_000, 5_000],
        operation: warmOperation,
        templateId: id(626),
      }),
      template({
        assignmentKey: "conversation-seat",
        direction: "conversation-first",
        elementId: coolOperation.element.id,
        objectives: [5_000, 9_000],
        operation: coolOperation,
        templateId: id(627),
      }),
    ];
    const request = makeRequest({ assets: [warm, cool], candidateTemplates: candidates });
    const baseline = runDeterministicDesignEngine(request);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    expect(baseline.pairwiseDiversity[0]).toMatchObject({
      assetInventoryDistanceBasisPoints: 10_000,
      assignmentDistanceBasisPoints: 10_000,
      materialDistanceBasisPoints: 10_000,
      operationSignatureDistanceBasisPoints: 10_000,
      placementDistanceMm: 0,
      spatiallyOrMateriallyDistinct: true,
    });
    expect(
      runDeterministicDesignEngine({
        ...request,
        assets: [...request.assets].reverse(),
        candidateTemplates: [...request.candidateTemplates].reverse(),
      }),
    ).toEqual(baseline);
  });

  it("emits every pair for a three-candidate set compatible with the frozen option-set schema", () => {
    const request = makeRequest();
    const third = furnishingOperation({
      elementId: id(630),
      operationId: id(631),
      xMm: 2_500,
      yMm: 2_500,
    });
    const candidateTemplates = [
      ...request.candidateTemplates,
      template({
        direction: "storage-first",
        elementId: third.element.id,
        objectives: [7_000, 7_000],
        operation: third,
        templateId: id(632),
      }),
    ];
    const result = runDeterministicDesignEngine({
      ...request,
      candidateTemplates,
      requestedDirections: ["circulation-first", "conversation-first", "storage-first"],
      requestedOptionCount: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairwiseDiversity).toHaveLength(3);
    expect(
      designOptionSetSchema.safeParse({
        createdAt: "2026-07-18T10:00:00.000Z",
        jobId: id(633),
        optionIds: result.candidates.map(({ candidateId }) => candidateId),
        pairwiseDiversity: result.pairwiseDiversity,
        projectId: ids.project,
        schemaVersion: "c12-design-option-set-v1",
        setSha256: result.declarationSha256,
      }).success,
    ).toBe(true);
  });

  it("ends by candidate count and returns RESOURCE_LIMIT when the bound prevents a complete set", () => {
    const request = makeRequest();
    const result = runDeterministicDesignEngine({
      ...request,
      configuration: { ...request.configuration, candidateBudget: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.abstention.code).toBe("RESOURCE_LIMIT");
  });
});
