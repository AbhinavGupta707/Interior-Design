import { createHash } from "node:crypto";

export type ReferenceAttemptState =
  "abstained" | "cancel-requested" | "cancelled" | "failed" | "processing" | "proposed" | "queued";

interface Attempt {
  readonly number: number;
  leaseToken?: string;
  resultHash?: string;
  retryable: boolean;
  state: ReferenceAttemptState;
}

export class ReferenceJobMachine {
  readonly attempts: Attempt[] = [{ number: 1, retryable: false, state: "queued" }];

  current(): Readonly<Attempt> {
    const current = this.attempts.at(-1);
    if (current === undefined) throw new Error("MISSING_ATTEMPT");
    return Object.freeze({ ...current });
  }

  lease(token: string): void {
    const attempt = this.mutableCurrent();
    if (attempt.state !== "queued" || token.length < 8 || token.length > 128) {
      throw new Error("LEASE_DENIED");
    }
    attempt.state = "processing";
    attempt.leaseToken = token;
  }

  requestCancel(): void {
    const attempt = this.mutableCurrent();
    if (attempt.state === "queued") {
      attempt.state = "cancelled";
      return;
    }
    if (attempt.state === "processing") {
      attempt.state = "cancel-requested";
      return;
    }
    if (attempt.state === "cancel-requested" || attempt.state === "cancelled") return;
    throw new Error("TERMINAL_CANCELLATION_DENIED");
  }

  finishCancellation(token: string): void {
    const attempt = this.mutableCurrent();
    this.requireLease(attempt, token);
    if (attempt.state !== "cancel-requested") throw new Error("CANCELLATION_NOT_REQUESTED");
    attempt.state = "cancelled";
    delete attempt.leaseToken;
  }

  publish(token: string, result: "abstained" | "failed" | "proposed", retryable = false): void {
    const attempt = this.mutableCurrent();
    this.requireLease(attempt, token);
    if (attempt.state !== "processing") throw new Error("STALE_LEASE_PUBLICATION_DENIED");
    attempt.state = result;
    attempt.retryable = result !== "proposed" && retryable;
    attempt.resultHash = createHash("sha256")
      .update(`${String(attempt.number)}:${result}`)
      .digest("hex");
    delete attempt.leaseToken;
  }

  retry(): void {
    const previous = this.mutableCurrent();
    if (
      !["abstained", "failed"].includes(previous.state) ||
      !previous.retryable ||
      previous.number >= 3
    ) {
      throw new Error("RETRY_DENIED");
    }
    this.attempts.push({ number: previous.number + 1, retryable: false, state: "queued" });
  }

  private mutableCurrent(): Attempt {
    const current = this.attempts.at(-1);
    if (current === undefined) throw new Error("MISSING_ATTEMPT");
    return current;
  }

  private requireLease(attempt: Attempt, token: string): void {
    if (attempt.leaseToken !== token) throw new Error("LEASE_FENCE_MISMATCH");
  }
}

interface IdempotencyRecord {
  readonly action: string;
  readonly actorId: string;
  readonly bodyHash: string;
  readonly resultId: string;
}

export class ReferenceIdempotencyLedger {
  readonly records = new Map<string, IdempotencyRecord>();

  execute(input: {
    readonly action: string;
    readonly actorId: string;
    readonly body: unknown;
    readonly key: string;
  }): { readonly replayed: boolean; readonly resultId: string } {
    if (input.key.length < 8 || input.key.length > 128) throw new Error("IDEMPOTENCY_KEY_INVALID");
    const bodyHash = createHash("sha256").update(canonicalJson(input.body)).digest("hex");
    const existing = this.records.get(input.key);
    if (existing !== undefined) {
      if (
        existing.action !== input.action ||
        existing.actorId !== input.actorId ||
        existing.bodyHash !== bodyHash
      ) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      return { replayed: true, resultId: existing.resultId };
    }
    const resultId = createHash("sha256")
      .update(`${input.actorId}:${input.action}:${input.key}:${bodyHash}`)
      .digest("hex");
    this.records.set(input.key, {
      action: input.action,
      actorId: input.actorId,
      bodyHash,
      resultId,
    });
    return { replayed: false, resultId };
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
