import { describe, expect, it } from "vitest";

import { ReferenceIdempotencyLedger, ReferenceJobMachine } from "./reference-job-machine.js";

describe("C6 cancellation, retry, lease and idempotency races", () => {
  it("fences a publish that loses a monotonic cancellation race", () => {
    const machine = new ReferenceJobMachine();
    machine.lease("lease-token-0001");
    machine.requestCancel();
    expect(machine.current().state).toBe("cancel-requested");
    expect(() => {
      machine.publish("lease-token-0001", "proposed");
    }).toThrow("STALE_LEASE_PUBLICATION_DENIED");
    machine.finishCancellation("lease-token-0001");
    expect(machine.current().state).toBe("cancelled");
    machine.requestCancel();
    expect(machine.current().state).toBe("cancelled");
  });

  it("rejects stale lease tokens and preserves completed proposal history", () => {
    const machine = new ReferenceJobMachine();
    machine.lease("lease-token-0002");
    expect(() => {
      machine.publish("lease-token-stale", "proposed");
    }).toThrow("LEASE_FENCE_MISMATCH");
    machine.publish("lease-token-0002", "proposed");
    const terminal = machine.current();
    expect(terminal.resultHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => {
      machine.requestCancel();
    }).toThrow("TERMINAL_CANCELLATION_DENIED");
    expect(() => {
      machine.retry();
    }).toThrow("RETRY_DENIED");
    expect(machine.current()).toEqual(terminal);
  });

  it("appends at most three retry attempts without rewriting prior terminals", () => {
    const machine = new ReferenceJobMachine();
    machine.lease("lease-token-0003");
    machine.publish("lease-token-0003", "failed", true);
    const first = machine.current();
    machine.retry();
    machine.lease("lease-token-0004");
    machine.publish("lease-token-0004", "abstained", true);
    const second = machine.current();
    machine.retry();
    machine.lease("lease-token-0005");
    machine.publish("lease-token-0005", "failed", true);
    expect(() => {
      machine.retry();
    }).toThrow("RETRY_DENIED");
    expect(machine.attempts).toHaveLength(3);
    expect(machine.attempts[0]).toMatchObject(first);
    expect(machine.attempts[1]).toMatchObject(second);
  });

  it("replays one exact mutation and conflicts on actor, action or body changes", () => {
    const ledger = new ReferenceIdempotencyLedger();
    const input = {
      action: "plan-job.create",
      actorId: "actor-1",
      body: { assetId: "asset-1", pageIndex: 0 },
      key: "idempotency-key-0001",
    };
    const first = ledger.execute(input);
    expect(first.replayed).toBe(false);
    expect(ledger.execute(input)).toEqual({ replayed: true, resultId: first.resultId });
    expect(() => ledger.execute({ ...input, actorId: "actor-2" })).toThrow("IDEMPOTENCY_CONFLICT");
    expect(() => ledger.execute({ ...input, action: "plan-job.retry" })).toThrow(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(() => ledger.execute({ ...input, body: { assetId: "asset-2", pageIndex: 0 } })).toThrow(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(ledger.records).toHaveLength(1);
  });
});
