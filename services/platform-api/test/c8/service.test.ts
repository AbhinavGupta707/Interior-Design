import { describe, expect, it } from "vitest";

import { ReconstructionService } from "../../src/modules/reconstruction/service.js";
import type { ReconstructionTelemetry } from "../../src/modules/reconstruction/types.js";
import { actors } from "../c6/support.js";
import {
  MemoryReconstructionRepository,
  eligibleSource,
  imageAssetId,
  reconstructionRequest,
} from "./support.js";

function owner() {
  const actor = actors["fixture|owner-alpha"];
  if (!actor) throw new Error("Synthetic owner fixture is missing.");
  return actor;
}

function command() {
  return {
    actor: owner(),
    correlation: {
      requestId: "c8-service-fixture",
      spanId: "1".repeat(16),
      traceId: "1".repeat(32),
      traceParent: `00-${"1".repeat(32)}-${"1".repeat(16)}-01`,
    },
    idempotencyKey: "c8-service-create-0001",
    projectId: reconstructionRequest.sources[0]?.assetId ? eligibleSource().projectId : "missing",
    request: reconstructionRequest,
  };
}

describe("C8 reconstruction service", () => {
  it("validates the exact immutable source and computes stable request/source hashes", async () => {
    const repository = new MemoryReconstructionRepository();
    const telemetry: ReconstructionTelemetry & {
      events: Parameters<ReconstructionTelemetry["record"]>[0][];
    } = {
      events: [],
      record(event) {
        this.events.push(event);
      },
    };
    const service = new ReconstructionService(repository, telemetry);
    const created = await service.createJob(command());
    expect(created.job.request.rights.trainingUseConsent).toBe("denied");
    expect(repository.lastCreate?.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(repository.lastCreate?.sourceManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(telemetry.events).toEqual([{ outcome: "accepted", stage: "create" }]);
  });

  it.each([
    ["not ready", { status: "processing" }, "RECONSTRUCTION_SOURCE_NOT_READY"],
    ["withdrawn", { withdrawn: true }, "RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN"],
    ["changed bytes", { byteSize: 2_000 }, "RECONSTRUCTION_SOURCE_CHANGED"],
    [
      "training enabled",
      { rights: { ...eligibleSource().rights, trainingUseConsent: "granted" } },
      "RECONSTRUCTION_SOURCE_RIGHTS_NOT_PERMITTED",
    ],
  ])("rejects a %s source before durable creation", async (_label, overrides, code) => {
    const repository = new MemoryReconstructionRepository();
    repository.sources.set(imageAssetId, eligibleSource(imageAssetId, overrides));
    await expect(new ReconstructionService(repository).createJob(command())).rejects.toMatchObject({
      code,
      statusCode: 409,
    });
    expect(repository.jobs.size).toBe(0);
  });
});
