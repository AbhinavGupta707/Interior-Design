import { tenantIdSchema } from "@interior-design/contracts";
import {
  createHmac,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";

import { ApiError } from "../../errors.js";

export type SessionAuthMode = "local-fixture" | "oidc";

export interface VerifiedSessionPrincipal {
  readonly authMode: SessionAuthMode;
  readonly expiresAt: string;
  readonly subject: string;
  readonly tenantId: string;
}

export interface LocalTokenSubject {
  readonly subject: string;
  readonly tenantId: string;
}

export interface SessionTokenProvider {
  readonly available: boolean;
  issueLocal?(subject: LocalTokenSubject): {
    readonly accessToken: string;
    readonly expiresAt: string;
  };
  verify(accessToken: string): Promise<VerifiedSessionPrincipal>;
}

interface ParsedJwt {
  readonly header: unknown;
  readonly payload: unknown;
  readonly signature: Buffer;
  readonly signingInput: string;
}

interface JwtProviderOptions {
  readonly audience: string;
  readonly clock?: () => number;
  readonly issuer: string;
  readonly maxLifetimeSeconds?: number;
}

export const LOCAL_SESSION_AUDIENCE = "urn:interior-design:platform-api";
export const LOCAL_SESSION_ISSUER = "urn:interior-design:local-fixture";
export const LOCAL_SESSION_TTL_SECONDS = 15 * 60;
const MAX_SESSION_LIFETIME_SECONDS = 60 * 60;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

const jwtHeaderSchema = z
  .object({
    alg: z.string(),
    kid: z.string().optional(),
    typ: z.literal("JWT").optional(),
  })
  .loose();

const jwtPayloadSchema = z
  .object({
    aud: z.union([z.string(), z.array(z.string()).min(1)]),
    exp: z.int().positive(),
    iat: z.int().nonnegative(),
    iss: z.string().min(1),
    nbf: z.int().nonnegative().optional(),
    sub: z.string().trim().min(3).max(200),
    tenant_id: tenantIdSchema,
  })
  .loose();

function invalidSession(): ApiError {
  return new ApiError({
    code: "UNAUTHENTICATED",
    detail: "A valid bearer session is required.",
    statusCode: 401,
    title: "Unauthenticated",
  });
}

function providerUnavailable(): ApiError {
  return new ApiError({
    code: "IDENTITY_PROVIDER_UNAVAILABLE",
    detail: "The configured identity provider is unavailable.",
    statusCode: 503,
    title: "Identity Provider Unavailable",
  });
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(segment: string): unknown {
  if (!JWT_SEGMENT_PATTERN.test(segment)) {
    throw invalidSession();
  }
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
  } catch {
    throw invalidSession();
  }
}

function parseJwt(accessToken: string): ParsedJwt {
  const segments = accessToken.split(".");
  if (segments.length !== 3) {
    throw invalidSession();
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    !JWT_SEGMENT_PATTERN.test(signatureSegment)
  ) {
    throw invalidSession();
  }
  return {
    header: decodeJson(headerSegment),
    payload: decodeJson(payloadSegment),
    signature: Buffer.from(signatureSegment, "base64url"),
    signingInput: `${headerSegment}.${payloadSegment}`,
  };
}

function validateClaims(
  payload: unknown,
  options: JwtProviderOptions,
  authMode: SessionAuthMode,
): VerifiedSessionPrincipal {
  const result = jwtPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw invalidSession();
  }
  const claims = result.data;
  const nowSeconds = Math.floor((options.clock?.() ?? Date.now()) / 1000);
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  const maxLifetime = options.maxLifetimeSeconds ?? MAX_SESSION_LIFETIME_SECONDS;

  if (
    claims.iss !== options.issuer ||
    !audiences.includes(options.audience) ||
    claims.exp <= nowSeconds ||
    claims.exp <= claims.iat ||
    claims.iat > nowSeconds + 30 ||
    claims.exp - claims.iat > maxLifetime ||
    (claims.nbf !== undefined && claims.nbf > nowSeconds + 30)
  ) {
    throw invalidSession();
  }

  return {
    authMode,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    subject: claims.sub,
    tenantId: claims.tenant_id,
  };
}

export class LocalFixtureTokenProvider implements SessionTokenProvider {
  readonly available = true;
  readonly #clock: () => number;
  readonly #secret: Buffer;

  constructor(secret: string, clock: () => number = Date.now) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("The local session secret must be at least 32 bytes.");
    }
    this.#secret = Buffer.from(secret, "utf8");
    this.#clock = clock;
  }

  issueLocal(subject: LocalTokenSubject): {
    readonly accessToken: string;
    readonly expiresAt: string;
  } {
    const issuedAt = Math.floor(this.#clock() / 1000);
    const expiresAt = issuedAt + LOCAL_SESSION_TTL_SECONDS;
    const header = encodeJson({ alg: "HS256", kid: "local-fixture-v1", typ: "JWT" });
    const payload = encodeJson({
      aud: LOCAL_SESSION_AUDIENCE,
      exp: expiresAt,
      iat: issuedAt,
      iss: LOCAL_SESSION_ISSUER,
      jti: randomUUID(),
      sub: subject.subject,
      tenant_id: subject.tenantId,
    });
    const signingInput = `${header}.${payload}`;
    const signature = createHmac("sha256", this.#secret)
      .update(signingInput)
      .digest()
      .toString("base64url");
    return {
      accessToken: `${signingInput}.${signature}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  verify(accessToken: string): Promise<VerifiedSessionPrincipal> {
    try {
      const token = parseJwt(accessToken);
      const header = jwtHeaderSchema.safeParse(token.header);
      if (
        !header.success ||
        header.data.alg !== "HS256" ||
        header.data.kid !== "local-fixture-v1"
      ) {
        throw invalidSession();
      }
      const expected = createHmac("sha256", this.#secret).update(token.signingInput).digest();
      if (
        expected.length !== token.signature.length ||
        !timingSafeEqual(expected, token.signature)
      ) {
        throw invalidSession();
      }
      return Promise.resolve(
        validateClaims(
          token.payload,
          {
            audience: LOCAL_SESSION_AUDIENCE,
            clock: this.#clock,
            issuer: LOCAL_SESSION_ISSUER,
            maxLifetimeSeconds: LOCAL_SESSION_TTL_SECONDS,
          },
          "local-fixture",
        ),
      );
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : invalidSession());
    }
  }
}

export interface OidcTokenProviderOptions extends JwtProviderOptions {
  readonly publicKeyPem: string;
}

export class OidcTokenProvider implements SessionTokenProvider {
  readonly available = true;
  readonly #options: OidcTokenProviderOptions;
  readonly #publicKey: KeyObject;

  constructor(options: OidcTokenProviderOptions) {
    this.#options = options;
    this.#publicKey = createPublicKey(options.publicKeyPem);
  }

  verify(accessToken: string): Promise<VerifiedSessionPrincipal> {
    try {
      const token = parseJwt(accessToken);
      const header = jwtHeaderSchema.safeParse(token.header);
      if (!header.success || header.data.alg !== "RS256") {
        throw invalidSession();
      }
      const valid = verifySignature(
        "RSA-SHA256",
        Buffer.from(token.signingInput, "ascii"),
        this.#publicKey,
        token.signature,
      );
      if (!valid) {
        throw invalidSession();
      }
      return Promise.resolve(validateClaims(token.payload, this.#options, "oidc"));
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : invalidSession());
    }
  }
}

export class UnavailableTokenProvider implements SessionTokenProvider {
  readonly available = false;

  verify(): Promise<VerifiedSessionPrincipal> {
    return Promise.reject(providerUnavailable());
  }
}
