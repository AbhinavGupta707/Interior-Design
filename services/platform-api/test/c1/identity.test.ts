import type { Actor } from "@interior-design/contracts";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { ApiError } from "../../src/errors.js";
import { LocalFixtureTokenProvider, OidcTokenProvider } from "../../src/modules/identity/jwt.js";
import { IdentityService } from "../../src/modules/identity/service.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";

const actor: Actor = {
  displayName: "Alpha homeowner",
  role: "owner",
  subject: "fixture|homeowner-alpha",
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
};

class MemoryIdentityStore implements IdentityStore {
  findFixtureActor(): Promise<Actor> {
    return Promise.resolve(actor);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    return Promise.resolve(
      tenantId === actor.tenantId && subject === actor.subject ? actor : undefined,
    );
  }
}

function rs256Token(privateKey: KeyObject, payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(privateKey)
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

describe("provider-neutral session verification", () => {
  it("issues a short-lived fixture token and reloads actor authority from the store", async () => {
    const now = Date.parse("2026-07-17T10:00:00.000Z");
    const identity = new IdentityService(
      "test",
      new MemoryIdentityStore(),
      new LocalFixtureTokenProvider(
        "test-session-secret-with-at-least-thirty-two-bytes",
        () => now,
      ),
    );

    const created = await identity.createLocalSession("homeowner-alpha");
    const session = await identity.authenticate(`Bearer ${created.accessToken}`);

    expect(session.actor).toEqual(actor);
    expect(session.authMode).toBe("local-fixture");
    expect(Date.parse(session.expiresAt) - now).toBe(15 * 60 * 1000);
    expect(created.accessToken).not.toContain(actor.role);
    expect(created.accessToken).not.toContain(actor.userId);
  });

  it("rejects expired, malformed, and signature-tampered bearer tokens", async () => {
    let now = Date.parse("2026-07-17T10:00:00.000Z");
    const provider = new LocalFixtureTokenProvider(
      "test-session-secret-with-at-least-thirty-two-bytes",
      () => now,
    );
    const identity = new IdentityService("test", new MemoryIdentityStore(), provider);
    const created = await identity.createLocalSession("homeowner-alpha");

    now += 16 * 60 * 1000;
    await expect(identity.authenticate(`Bearer ${created.accessToken}`)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    } satisfies Partial<ApiError>);
    await expect(identity.authenticate("Bearer not-a-jwt")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    } satisfies Partial<ApiError>);
    const tampered = `${created.accessToken.slice(0, -1)}x`;
    await expect(identity.authenticate(`Bearer ${tampered}`)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    } satisfies Partial<ApiError>);
  });

  it("refuses both fixture sign-in and fixture bearer use in production", async () => {
    const provider = new LocalFixtureTokenProvider(
      "test-session-secret-with-at-least-thirty-two-bytes",
    );
    const identity = new IdentityService("production", new MemoryIdentityStore(), provider);
    const token = provider.issueLocal({ subject: actor.subject, tenantId: actor.tenantId });

    await expect(identity.createLocalSession("homeowner-alpha")).rejects.toMatchObject({
      code: "LOCAL_AUTH_UNAVAILABLE",
      statusCode: 503,
    } satisfies Partial<ApiError>);
    await expect(identity.authenticate(`Bearer ${token.accessToken}`)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    } satisfies Partial<ApiError>);
  });

  it("validates OIDC signature, issuer, audience, expiry, and signed tenant", async () => {
    const now = Date.parse("2026-07-17T10:00:00.000Z");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const provider = new OidcTokenProvider({
      audience: "home-design-api",
      clock: () => now,
      issuer: "https://identity.example.test/",
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    });
    const baseClaims = {
      aud: "home-design-api",
      exp: Math.floor(now / 1000) + 900,
      iat: Math.floor(now / 1000),
      iss: "https://identity.example.test/",
      role: "forged-role-is-not-authority",
      sub: actor.subject,
      tenant_id: actor.tenantId,
      user_id: "forged-user-is-not-authority",
    };

    await expect(provider.verify(rs256Token(privateKey, baseClaims))).resolves.toEqual({
      authMode: "oidc",
      expiresAt: "2026-07-17T10:15:00.000Z",
      subject: actor.subject,
      tenantId: actor.tenantId,
    });
    await expect(
      provider.verify(rs256Token(privateKey, { ...baseClaims, aud: "wrong-audience" })),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    await expect(
      provider.verify(rs256Token(privateKey, { ...baseClaims, iss: "https://wrong.example/" })),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    await expect(provider.verify(rs256Token(otherKey, baseClaims))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      statusCode: 401,
    });
    await expect(
      provider.verify(rs256Token(privateKey, { ...baseClaims, exp: Math.floor(now / 1000) - 1 })),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
  });
});
