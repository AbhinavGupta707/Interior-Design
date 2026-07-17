import { describe, expect, it } from "vitest";

import { ModelFusionService } from "../../src/modules/model-fusion/service.js";
import type { FusionTelemetry } from "../../src/modules/model-fusion/types.js";
import { alphaProjectId } from "../c4/fixtures.js";
import { actors } from "../c6/support.js";
import {
  fusionRequest,
  MemoryFusionRepository,
  MemoryFusionVerification,
  planSourceId,
  roomplanSourceId,
} from "./support.js";

function owner() {
  const actor = actors["fixture|owner-alpha"];
  if (!actor) throw new Error("Synthetic C9 owner fixture is missing.");
  return actor;
}

function command(key = "c9-service-create-0001") {
  return {
    actor: owner(),
    correlation: {
      requestId: key,
      spanId: "9".repeat(16),
      traceId: "9".repeat(32),
      traceParent: `00-${"9".repeat(32)}-${"9".repeat(16)}-01`,
    },
    idempotencyKey: key,
    projectId: alphaProjectId,
    request: fusionRequest,
  };
}

describe("C9 model fusion service", () => {
  it("pins exact base/source hashes, computes a deterministic manifest and records redacted telemetry", async () => {
    const repository = new MemoryFusionRepository();
    const verification = new MemoryFusionVerification();
    const telemetry: FusionTelemetry & { events: Parameters<FusionTelemetry["record"]>[0][] } = {
      events: [],
      record(event) {
        this.events.push(event);
      },
    };
    const service = new ModelFusionService({
      baseVerifier: verification,
      repository,
      sourceVerifier: verification,
      telemetry,
    });
    const created = await service.createJob(command());
    expect(created.job).toMatchObject({ attempt: 1, state: "queued", version: 1 });
    expect(repository.lastCreate?.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(repository.lastCreate?.sourceManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(telemetry.events).toEqual([{ outcome: "accepted", stage: "create" }]);
    expect(JSON.stringify(telemetry.events)).not.toMatch(/sha256|source|project|tenant|user/u);
  });

  it.each([
    ["missing base", "base", "FUSION_BASE_SNAPSHOT_MISMATCH"],
    ["missing source", "missing", "FUSION_SOURCE_NOT_FOUND"],
    ["withdrawn rights", "rights", "FUSION_SOURCE_RIGHTS_WITHDRAWN"],
    ["changed hash", "hash", "FUSION_SOURCE_CHANGED"],
    ["changed element count", "count", "FUSION_SOURCE_CHANGED"],
  ])("rejects %s before durable creation", async (_label, defect, code) => {
    const repository = new MemoryFusionRepository();
    const verification = new MemoryFusionVerification();
    if (defect === "base") verification.baseAvailable = false;
    if (defect === "missing") verification.verified.delete(planSourceId);
    const plan = verification.verified.get(planSourceId);
    if (plan && defect === "rights")
      verification.verified.set(planSourceId, { ...plan, rightsActive: false });
    if (plan && defect === "hash")
      verification.verified.set(planSourceId, { ...plan, sha256: "f".repeat(64) });
    if (plan && defect === "count")
      verification.verified.set(planSourceId, { ...plan, elementCount: plan.elementCount + 1 });
    const service = new ModelFusionService({
      baseVerifier: verification,
      repository,
      sourceVerifier: verification,
    });
    await expect(service.createJob(command(`c9-${defect}-0001`))).rejects.toMatchObject({
      code,
      statusCode: 409,
    });
    expect(repository.jobs.size).toBe(0);
  });

  it("rechecks every exact source and rights grant before creating a new retry attempt", async () => {
    const repository = new MemoryFusionRepository();
    const verification = new MemoryFusionVerification();
    const service = new ModelFusionService({
      baseVerifier: verification,
      repository,
      sourceVerifier: verification,
    });
    const created = await service.createJob(command("c9-retry-create-0001"));
    const cancelled = await service.cancelJob({
      ...command("c9-retry-cancel-0001"),
      expectedVersion: created.job.version,
      fusionJobId: created.job.id,
    });
    const capture = verification.verified.get(roomplanSourceId);
    if (!capture) throw new Error("Synthetic RoomPlan verification is missing.");
    verification.verified.set(roomplanSourceId, { ...capture, rightsActive: false });
    await expect(
      service.retryJob({
        ...command("c9-retry-denied-0001"),
        expectedVersion: cancelled.job.version,
        fusionJobId: created.job.id,
      }),
    ).rejects.toMatchObject({ code: "FUSION_SOURCE_RIGHTS_WITHDRAWN", statusCode: 409 });
    expect(repository.jobs.get(created.job.id)).toMatchObject({ attempt: 1, state: "cancelled" });
  });

  it("canonicalises source order for the durable source-manifest hash", async () => {
    const firstRepository = new MemoryFusionRepository();
    const secondRepository = new MemoryFusionRepository();
    const verification = new MemoryFusionVerification();
    const first = new ModelFusionService({
      baseVerifier: verification,
      repository: firstRepository,
      sourceVerifier: verification,
    });
    const second = new ModelFusionService({
      baseVerifier: verification,
      repository: secondRepository,
      sourceVerifier: verification,
    });
    await first.createJob(command("c9-order-a-0001"));
    await second.createJob({
      ...command("c9-order-b-0001"),
      request: { ...fusionRequest, sources: [...fusionRequest.sources].reverse() },
    });
    expect(firstRepository.lastCreate?.sourceManifestSha256).toBe(
      secondRepository.lastCreate?.sourceManifestSha256,
    );
    expect(firstRepository.lastCreate?.requestSha256).not.toBe(
      secondRepository.lastCreate?.requestSha256,
    );
  });
});
