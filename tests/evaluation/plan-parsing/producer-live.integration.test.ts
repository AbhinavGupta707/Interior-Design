import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import {
  holdoutHardNegativePlanFixtures,
  holdoutInBoxPlanFixtures,
} from "../../../packages/test-fixtures/src/plans/holdout/catalog.js";

import { parseObservationBundle } from "./observation-codec.js";
import { evaluatePlanAdapter } from "./reference-evaluator.js";

const producerObservationPath = process.env.C6_PRODUCER_OBSERVATIONS;
const producerManifestSha256 = process.env.C6_PRODUCER_MANIFEST_SHA256;

it.skipIf(producerObservationPath === undefined)(
  "[producer-live opt-in] evaluates producer observations; SKIP when C6_PRODUCER_OBSERVATIONS is unset",
  async () => {
    if (producerObservationPath === undefined) throw new Error("unreachable");
    if (producerManifestSha256 === undefined || !/^[a-f0-9]{64}$/u.test(producerManifestSha256)) {
      throw new Error("C6_PRODUCER_MANIFEST_SHA256 must be 64 lowercase hexadecimal characters.");
    }
    const observations = parseObservationBundle(await readFile(producerObservationPath));
    const first = observations[0];
    if (first === undefined) throw new Error("Producer observation bundle is empty.");
    const report = evaluatePlanAdapter({
      adapter: {
        adapterId: first.adapterId,
        adapterVersion: first.adapterVersion,
        evidenceKind: "producer-live",
        manifestSha256: producerManifestSha256,
      },
      dataset: {
        hardNegatives: holdoutHardNegativePlanFixtures,
        inBox: holdoutInBoxPlanFixtures,
      },
      observations,
    });
    expect(report.failures.missingObservationCount).toBe(0);
    expect(Object.values(report.gates).every(({ status }) => status === "passed")).toBe(true);
    expect(report.correction.targetStatus).toBe("not-measured");
  },
);
