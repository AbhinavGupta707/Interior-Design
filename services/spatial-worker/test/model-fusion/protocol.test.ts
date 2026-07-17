import { describe, expect, it } from "vitest";

import {
  BoundedFusionProducerProtocol,
  UnavailableRegistrationProducer,
  UnavailableSemanticProducer,
} from "../../src/model-fusion/protocol.js";
import { FusionWorkerError } from "../../src/model-fusion/types.js";
import { fusionWorkerFixture } from "./support.js";

describe("C9 bounded producer protocol", () => {
  it("turns absent provider composition into explicit unregistered results and honest abstention", async () => {
    const { acquired } = fusionWorkerFixture();
    const protocol = new BoundedFusionProducerProtocol({
      registration: new UnavailableRegistrationProducer(),
      semantic: new UnavailableSemanticProducer(),
    });
    const registrations = await protocol.register(acquired.sources, []);
    expect(registrations).toHaveLength(2);
    expect(registrations.every(({ status }) => status === "unregistered")).toBe(true);
    const semantic = await protocol.fit({
      baseSnapshot: acquired.baseSnapshot,
      inferencePolicy: "label-and-expose",
      registrations,
      sources: acquired.sources,
    });
    expect(semantic).toMatchObject({
      safeCode: "FUSION_PRODUCER_UNAVAILABLE",
      status: "abstained",
    });
  });

  it("rejects producer output that omits or injects an exact source identifier", async () => {
    const { acquired } = fusionWorkerFixture();
    const protocol = new BoundedFusionProducerProtocol({
      registration: {
        register: () => Promise.resolve([]),
      },
      semantic: new UnavailableSemanticProducer(),
    });
    await expect(protocol.register(acquired.sources, [])).rejects.toMatchObject({
      safeCode: "FUSION_REGISTRATION_SCOPE_MISMATCH",
    });
  });

  it("fences an already-cancelled protocol call before accepting producer output", async () => {
    const { acquired } = fusionWorkerFixture();
    const cancellation = new AbortController();
    cancellation.abort();
    const protocol = new BoundedFusionProducerProtocol({
      registration: {
        register: (_input, signal) =>
          signal?.aborted
            ? Promise.reject(new FusionWorkerError("PRODUCER_ABORTED"))
            : Promise.resolve([]),
      },
      semantic: new UnavailableSemanticProducer(),
    });
    await expect(
      protocol.register(acquired.sources, [], cancellation.signal),
    ).rejects.toMatchObject({
      safeCode: "FUSION_CANCELLED",
    });
  });

  it("enforces the 16 MiB semantic output resource bound", async () => {
    const { acquired } = fusionWorkerFixture();
    const protocol = new BoundedFusionProducerProtocol({
      registration: new UnavailableRegistrationProducer(),
      semantic: {
        fit: (input) =>
          Promise.resolve({
            coverage: {
              inputSourceCount: input.sources.length,
              levelsCovered: 0,
              registeredSourceCount: 0,
              unknownRegionCount: 1,
            },
            discrepancies: [],
            findings: [
              {
                code: "FUSION_OVERSIZED_FIXTURE",
                detail: "x".repeat(17 * 1_024 * 1_024),
                severity: "error",
              },
            ],
            safeCode: "FUSION_OVERSIZED_FIXTURE",
            status: "abstained",
          }),
      },
    });
    const registrations = await protocol.register(acquired.sources, []);
    await expect(
      protocol.fit({
        baseSnapshot: acquired.baseSnapshot,
        inferencePolicy: "label-and-expose",
        registrations,
        sources: acquired.sources,
      }),
    ).rejects.toMatchObject({ safeCode: "FUSION_PRODUCER_OUTPUT_LIMIT" });
  });
});
