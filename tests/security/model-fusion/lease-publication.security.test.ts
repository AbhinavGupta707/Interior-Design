import { describe, expect, it } from "vitest";

import {
  assertPublicationFence,
  cancelResource,
  claimLease,
  retryResource,
  type FusionJobState,
  type FusionResource,
} from "./reference-boundary.js";
import { leaseClaim, resource } from "./synthetic-security-fixtures.js";

const leaseInput = Object.freeze({
  leaseToken: "synthetic-lease-token",
  nowMilliseconds: 1_000,
  ttlMilliseconds: 100,
  workerId: "synthetic-worker-c9",
});

describe("C9 lease, cancellation, retry and publication fencing", () => {
  it("claims once, denies a live second holder and permits explicit expiry reclaim", () => {
    const leased = claimLease(resource, leaseInput);
    expect(leased.lease).toMatchObject({ attempt: 1, epoch: 1, expiresAtMilliseconds: 1_100 });
    expect(() => claimLease(leased, { ...leaseInput, workerId: "attacker-worker" })).toThrow(
      "FUSION_LEASE_HELD",
    );
    const reclaimed = claimLease(leased, {
      ...leaseInput,
      leaseToken: "replacement-token",
      nowMilliseconds: 1_100,
      workerId: "replacement-worker",
    });
    expect(reclaimed.lease).toMatchObject({ attempt: 1, epoch: 2 });
    expect(reclaimed.version).toBe(leased.version + 1);
    expect(() => {
      assertPublicationFence(reclaimed, leaseClaim(leased), 1_100);
    }).toThrow("FUSION_STALE_PUBLICATION");
  });

  it("cancellation invalidates leases at every non-terminal processing stage", () => {
    const cancellable: readonly FusionJobState[] = [
      "cancel-requested",
      "comparing",
      "fitting",
      "queued",
      "registering",
    ];
    for (const state of cancellable) {
      const leased = claimLease({ ...resource, state }, leaseInput);
      const cancelled = cancelResource(leased);
      expect(cancelled).toMatchObject({ cancelled: true, state: "cancelled" });
      expect(cancelled.lease).toBeUndefined();
      expect(() => {
        assertPublicationFence(cancelled, leaseClaim(leased), 1_050);
      }).toThrow("FUSION_STALE_PUBLICATION");
    }
  });

  it("makes retry replacement attempts fenced, bounded and idempotent by exact key", () => {
    const failed = {
      ...resource,
      attempt: 1,
      state: "failed",
      version: 9,
    } satisfies FusionResource;
    const request = {
      expectedAttempt: 1,
      expectedVersion: 9,
      idempotencyKey: "c9-retry-synthetic-0001",
    };
    const replacement = retryResource(failed, request);
    expect(replacement).toMatchObject({ attempt: 2, state: "queued", version: 10 });
    expect(retryResource(replacement, request)).toBe(replacement);
    expect(() =>
      retryResource(replacement, { ...request, idempotencyKey: "c9-retry-synthetic-0002" }),
    ).toThrow("FUSION_RETRY_FENCE_DENIED");
    expect(() =>
      retryResource({ ...failed, attempt: 3 }, { ...request, expectedAttempt: 3 }),
    ).toThrow("FUSION_RETRY_FENCE_DENIED");
  });

  it("publishes only the exact live tenant/project/job/attempt/version/epoch/token", () => {
    const leased = claimLease(resource, leaseInput);
    const claim = leaseClaim(leased);
    expect(() => {
      assertPublicationFence(leased, claim, 1_050);
    }).not.toThrow();
    for (const [attackedResource, attackedClaim, now] of [
      [leased, { ...claim, tenantId: "tenant-attacker" }, 1_050],
      [leased, { ...claim, projectId: "project-attacker" }, 1_050],
      [leased, { ...claim, jobId: "job-attacker" }, 1_050],
      [leased, { ...claim, attempt: 2 }, 1_050],
      [leased, { ...claim, version: claim.version - 1 }, 1_050],
      [leased, { ...claim, epoch: claim.epoch + 1 }, 1_050],
      [leased, { ...claim, leaseToken: "wrong-token" }, 1_050],
      [leased, claim, 1_100],
      [{ ...leased, rightsActive: false }, claim, 1_050],
      [{ ...leased, cancelled: true }, claim, 1_050],
      [{ ...leased, state: "proposed" }, claim, 1_050],
    ] as const) {
      expect(() => {
        assertPublicationFence(attackedResource, attackedClaim, now);
      }).toThrow("FUSION_STALE_PUBLICATION");
    }
  });
});
