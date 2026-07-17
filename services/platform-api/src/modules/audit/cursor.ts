import { modelBranchIdSchema } from "@interior-design/contracts";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { ModelAuditCursorPosition, ModelAuditScope } from "./types.js";

const cursorPayloadSchema = z
  .object({
    eventId: modelBranchIdSchema,
    expiresAtEpochSeconds: z.int().positive(),
    occurredAt: z.iso.datetime({ offset: true }),
    scopeFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    version: z.literal(1),
  })
  .strict();

export class ModelAuditCursorError extends Error {
  readonly code = "INVALID_AUDIT_CURSOR";

  constructor() {
    super("The audit cursor is invalid, expired, or belongs to a different resource.");
    this.name = "ModelAuditCursorError";
  }
}

function fingerprint(scope: ModelAuditScope): string {
  return createHash("sha256")
    .update(
      [scope.tenantId, scope.projectId, scope.modelId, scope.profile, scope.branchId].join("\n"),
      "utf8",
    )
    .digest("hex");
}

function canonicalPayload(payload: z.infer<typeof cursorPayloadSchema>): string {
  return JSON.stringify({
    eventId: payload.eventId,
    expiresAtEpochSeconds: payload.expiresAtEpochSeconds,
    occurredAt: payload.occurredAt,
    scopeFingerprint: payload.scopeFingerprint,
    version: payload.version,
  });
}

function decodeBase64Url(value: string): Buffer {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) {
      throw new ModelAuditCursorError();
    }
    return decoded;
  } catch {
    throw new ModelAuditCursorError();
  }
}

export class ModelAuditCursorCodec {
  readonly #clock: () => Date;
  readonly #secret: Buffer;
  readonly #ttlSeconds: number;

  constructor(
    secret: string | Uint8Array,
    options: { readonly clock?: () => Date; readonly ttlSeconds?: number } = {},
  ) {
    const secretBytes =
      typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
    if (secretBytes.byteLength < 32) {
      throw new Error("The audit cursor secret must contain at least 32 bytes.");
    }
    const ttlSeconds = options.ttlSeconds ?? 900;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3_600) {
      throw new Error("The audit cursor TTL must be an integer from 60 to 3600 seconds.");
    }
    this.#secret = Buffer.from(secretBytes);
    this.#ttlSeconds = ttlSeconds;
    this.#clock = options.clock ?? (() => new Date());
  }

  encode(scope: ModelAuditScope, position: ModelAuditCursorPosition): string {
    const now = this.#clock();
    if (Number.isNaN(now.valueOf())) {
      throw new Error("The audit cursor clock returned an invalid date.");
    }
    const payload = cursorPayloadSchema.parse({
      eventId: position.eventId,
      expiresAtEpochSeconds: Math.floor(now.valueOf() / 1000) + this.#ttlSeconds,
      occurredAt: position.occurredAt,
      scopeFingerprint: fingerprint(scope),
      version: 1,
    });
    const body = Buffer.from(canonicalPayload(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#secret).update(body, "utf8").digest("base64url");
    const cursor = `${body}.${signature}`;
    if (cursor.length > 500) {
      throw new Error("The generated audit cursor exceeds the public contract ceiling.");
    }
    return cursor;
  }

  decode(scope: ModelAuditScope, cursor: string): ModelAuditCursorPosition {
    if (cursor.length < 3 || cursor.length > 500) {
      throw new ModelAuditCursorError();
    }
    const segments = cursor.split(".");
    const body = segments[0];
    const suppliedSignature = segments[1];
    if (segments.length !== 2 || body === undefined || suppliedSignature === undefined) {
      throw new ModelAuditCursorError();
    }
    const expectedSignature = createHmac("sha256", this.#secret).update(body, "utf8").digest();
    const suppliedSignatureBytes = decodeBase64Url(suppliedSignature);
    if (
      expectedSignature.byteLength !== suppliedSignatureBytes.byteLength ||
      !timingSafeEqual(expectedSignature, suppliedSignatureBytes)
    ) {
      throw new ModelAuditCursorError();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeBase64Url(body).toString("utf8")) as unknown;
    } catch {
      throw new ModelAuditCursorError();
    }
    const result = cursorPayloadSchema.safeParse(decoded);
    const now = this.#clock();
    if (
      !result.success ||
      Number.isNaN(now.valueOf()) ||
      result.data.expiresAtEpochSeconds <= Math.floor(now.valueOf() / 1000) ||
      result.data.scopeFingerprint !== fingerprint(scope)
    ) {
      throw new ModelAuditCursorError();
    }
    return { eventId: result.data.eventId, occurredAt: result.data.occurredAt };
  }
}
