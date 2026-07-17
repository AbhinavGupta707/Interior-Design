import { describe, expect, it, vi } from "vitest";

import { createPropertyClient } from "../../src/features/property/api";
import { resolution } from "./fixtures";

describe("C3 property client", () => {
  it("validates an exact result and sends a bounded idempotency key", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(resolution, { status: 201 }));
    const client = createPropertyClient(transport);

    await expect(
      client.resolveProperty("33333333-3333-4333-8333-333333333333", {
        countryCode: "GB",
        query: "Example Mews",
      }),
    ).resolves.toEqual(resolution);

    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    const key = new Headers(init.headers).get("idempotency-key") ?? "";
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("maps transport failure to an offline state without invented output", async () => {
    const client = createPropertyClient(vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(
      client.resolveProperty("33333333-3333-4333-8333-333333333333", {
        countryCode: "GB",
        query: "Example Mews",
      }),
    ).rejects.toMatchObject({ kind: "offline", status: 0 });
  });

  it("rejects a response that violates the frozen cardinality contract", async () => {
    const client = createPropertyClient(
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...resolution, candidates: [], status: "matched" })),
    );
    await expect(
      client.resolveProperty("33333333-3333-4333-8333-333333333333", {
        countryCode: "GB",
        query: "Example Mews",
      }),
    ).rejects.toMatchObject({ kind: "invalid-response", status: 502 });
  });

  it("distinguishes an expired resolution from a stale revision", async () => {
    const client = createPropertyClient(
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "PROPERTY_RESOLUTION_EXPIRED", detail: "Search again." },
            { status: 409 },
          ),
        ),
    );
    await expect(
      client.selectProperty("33333333-3333-4333-8333-333333333333", {
        candidateId: "66666666-6666-4666-8666-666666666666",
        expectedVersion: 0,
        mode: "candidate",
        resolutionId: "77777777-7777-4777-8777-777777777777",
      }),
    ).rejects.toMatchObject({ kind: "resolution-expired" });
  });

  it("treats a missing dossier as an honest empty state", async () => {
    const client = createPropertyClient(
      vi.fn().mockResolvedValue(Response.json({ detail: "No selection." }, { status: 404 })),
    );
    await expect(client.getDossier("33333333-3333-4333-8333-333333333333")).resolves.toBeNull();
  });
});
