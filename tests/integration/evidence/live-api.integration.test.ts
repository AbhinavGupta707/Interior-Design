import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  assetAccessResponseSchema,
  assetSchema,
  assetUploadSessionSchema,
  c2IngestionPolicy,
  signedAssetUploadPartSchema,
  type Asset,
  type AssetUploadSession,
} from "../../../packages/contracts/src/index.js";
import {
  adversarialFixtureDefinitions,
  createAdversarialFixture,
  fixtureDefinition,
  fixtureSha256,
  type AdversarialFixtureId,
} from "../../fixtures/c2/adversarial/factory.js";

interface Persona {
  readonly projectId: string;
  readonly token: string;
}

const requiredEnvironment = [
  "C2_ADVERSARIAL_API_URL",
  "C2_ADVERSARIAL_ALPHA_PROJECT_ID",
  "C2_ADVERSARIAL_BETA_PROJECT_ID",
  "C2_ADVERSARIAL_ALPHA_OWNER_TOKEN",
  "C2_ADVERSARIAL_BETA_OWNER_TOKEN",
  "C2_ADVERSARIAL_ALPHA_VIEWER_TOKEN",
] as const;
const missingEnvironment = requiredEnvironment.filter(
  (name) => (process.env[name] ?? "").length === 0,
);
const liveEnabled = missingEnvironment.length === 0;
const mediaEnabled = liveEnabled && process.env.C2_ADVERSARIAL_MEDIA === "1";
const baseUrl = (process.env.C2_ADVERSARIAL_API_URL ?? "http://127.0.0.1:0").replace(/\/$/u, "");
const alpha: Persona = {
  projectId: process.env.C2_ADVERSARIAL_ALPHA_PROJECT_ID ?? randomUUID(),
  token: process.env.C2_ADVERSARIAL_ALPHA_OWNER_TOKEN ?? "disabled",
};
const beta: Persona = {
  projectId: process.env.C2_ADVERSARIAL_BETA_PROJECT_ID ?? randomUUID(),
  token: process.env.C2_ADVERSARIAL_BETA_OWNER_TOKEN ?? "disabled",
};
const viewer: Persona = {
  projectId: alpha.projectId,
  token: process.env.C2_ADVERSARIAL_ALPHA_VIEWER_TOKEN ?? "disabled",
};

function sha256Base64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

function apiUrl(pathname: string): string {
  return `${baseUrl}${pathname}`;
}

function authHeaders(persona: Persona, idempotencyKey?: string): Record<string, string> {
  return {
    authorization: `Bearer ${persona.token}`,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

async function apiRequest(
  persona: Persona,
  pathname: string,
  init: RequestInit,
  idempotencyKey?: string,
): Promise<Response> {
  return fetch(apiUrl(pathname), {
    ...init,
    headers: {
      ...authHeaders(persona, idempotencyKey),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
    redirect: "manual",
  });
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

function sessionPath(persona: Persona): string {
  return `/v1/projects/${persona.projectId}/assets/upload-sessions`;
}

function assetPath(persona: Persona, assetId: string): string {
  return `/v1/projects/${persona.projectId}/assets/${assetId}`;
}

async function createUpload(
  persona: Persona,
  fixtureId: AdversarialFixtureId,
  options: { readonly declaredSha256?: string; readonly idempotencyKey?: string } = {},
): Promise<AssetUploadSession> {
  const fixture = fixtureDefinition(fixtureId);
  const bytes = createAdversarialFixture(fixtureId);
  const response = await apiRequest(
    persona,
    sessionPath(persona),
    {
      body: JSON.stringify({
        byteSize: bytes.byteLength,
        declaredMimeType: fixture.declaredMimeType,
        fileName: fixture.fileName,
        kind: fixture.kind,
        rights: { basis: "owned-by-user", serviceProcessingConsent: true },
        sha256: options.declaredSha256 ?? fixtureSha256(fixtureId),
      }),
      method: "POST",
    },
    options.idempotencyKey ?? `c2-create-${randomUUID()}`,
  );
  expect(response.status).toBe(201);
  return assetUploadSessionSchema.passthrough().parse(await responseJson(response));
}

async function signPart(
  persona: Persona,
  session: AssetUploadSession,
  bytes: Uint8Array,
  partNumber = 1,
): Promise<ReturnType<typeof signedAssetUploadPartSchema.parse>> {
  const response = await apiRequest(
    persona,
    `${sessionPath(persona)}/${session.sessionId}/parts`,
    {
      body: JSON.stringify({
        byteSize: bytes.byteLength,
        checksumSha256: sha256Base64(bytes),
        partNumber,
      }),
      method: "POST",
    },
    `c2-sign-${randomUUID()}`,
  );
  expect(response.status).toBe(200);
  return signedAssetUploadPartSchema.parse(await responseJson(response));
}

async function putSignedPart(
  signed: ReturnType<typeof signedAssetUploadPartSchema.parse>,
  bytes: Uint8Array,
): Promise<string> {
  const response = await fetch(signed.url, {
    body: Uint8Array.from(bytes).buffer,
    headers: signed.requiredHeaders,
    method: "PUT",
    redirect: "manual",
  });
  expect(response.ok).toBe(true);
  const etag = response.headers.get("etag");
  expect(etag).not.toBeNull();
  return etag ?? "missing-etag";
}

async function completeUpload(
  persona: Persona,
  session: AssetUploadSession,
  fixtureId: AdversarialFixtureId,
  etag: string,
  sha256 = fixtureSha256(fixtureId),
): Promise<Response> {
  const bytes = createAdversarialFixture(fixtureId);
  return apiRequest(
    persona,
    `${sessionPath(persona)}/${session.sessionId}/complete`,
    {
      body: JSON.stringify({
        parts: [{ checksumSha256: sha256Base64(bytes), etag, partNumber: 1 }],
        sha256,
      }),
      method: "POST",
    },
    `c2-complete-${randomUUID()}`,
  );
}

async function abortUpload(persona: Persona, sessionId: string): Promise<Response> {
  return apiRequest(
    persona,
    `${sessionPath(persona)}/${sessionId}`,
    { method: "DELETE" },
    `c2-abort-${randomUUID()}`,
  );
}

async function getSession(persona: Persona, sessionId: string): Promise<unknown> {
  const response = await apiRequest(persona, `${sessionPath(persona)}/${sessionId}`, {
    method: "GET",
  });
  expect(response.status).toBe(200);
  return responseJson(response);
}

async function pollAsset(persona: Persona, assetId: string): Promise<Asset> {
  const timeout = Number(process.env.C2_ADVERSARIAL_PROCESS_TIMEOUT_MS ?? "60000");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await apiRequest(persona, assetPath(persona, assetId), { method: "GET" });
    expect(response.status).toBe(200);
    const asset = assetSchema.parse(await responseJson(response));
    if (["ready", "rejected", "quarantined"].includes(asset.status)) {
      return asset;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "C2 asset did not reach a processing terminal state within the configured timeout",
  );
}

function normalizedProblem(body: unknown): unknown {
  if (typeof body !== "object" || body === null) {
    return body;
  }
  const {
    instance: _instance,
    requestId: _requestId,
    traceId: _traceId,
    ...stable
  } = body as Record<string, unknown>;
  return stable;
}

const liveSuiteName = liveEnabled
  ? "live C2 API/S3 adversarial acceptance"
  : `live C2 API/S3 adversarial acceptance (skipped: missing ${missingEnvironment.join(", ")})`;

describe.skipIf(!liveEnabled)(liveSuiteName, () => {
  it("rejects path/control filenames, forged authority, and viewer upload writes", async () => {
    for (const fixture of adversarialFixtureDefinitions.filter(
      (candidate) => candidate.edgeExpectation === "reject-request",
    )) {
      const bytes = createAdversarialFixture(fixture.id);
      const response = await apiRequest(
        alpha,
        sessionPath(alpha),
        {
          body: JSON.stringify({
            byteSize: bytes.byteLength,
            declaredMimeType: fixture.declaredMimeType,
            fileName: fixture.fileName,
            kind: fixture.kind,
            rights: { basis: "owned-by-user", serviceProcessingConsent: true },
            sha256: fixtureSha256(fixture.id),
          }),
          method: "POST",
        },
        `c2-invalid-name-${randomUUID()}`,
      );
      expect(response.status).toBe(400);
    }
    const valid = fixtureDefinition("shell-metacharacter-name");
    const bytes = createAdversarialFixture(valid.id);
    const forged = await apiRequest(
      alpha,
      sessionPath(alpha),
      {
        body: JSON.stringify({
          bucket: "source",
          byteSize: bytes.byteLength,
          declaredMimeType: valid.declaredMimeType,
          fileName: valid.fileName,
          kind: valid.kind,
          providerUploadId: "forged-provider-id",
          rights: { basis: "owned-by-user", serviceProcessingConsent: true },
          sha256: fixtureSha256(valid.id),
          tenantId: beta.projectId,
        }),
        method: "POST",
      },
      `c2-forged-${randomUUID()}`,
    );
    expect(forged.status).toBe(400);
    const viewerWrite = await apiRequest(
      viewer,
      sessionPath(viewer),
      {
        body: JSON.stringify({
          byteSize: bytes.byteLength,
          declaredMimeType: valid.declaredMimeType,
          fileName: valid.fileName,
          kind: valid.kind,
          rights: { basis: "owned-by-user", serviceProcessingConsent: true },
          sha256: fixtureSha256(valid.id),
        }),
        method: "POST",
      },
      `c2-viewer-${randomUUID()}`,
    );
    expect(viewerWrite.status).toBe(403);
  });

  it("replays identical creates once and rejects same-key/different-body conflicts", async () => {
    const key = `c2-idempotency-${randomUUID()}`;
    const first = await createUpload(alpha, "shell-metacharacter-name", { idempotencyKey: key });
    const replay = await createUpload(alpha, "shell-metacharacter-name", { idempotencyKey: key });
    expect(replay.sessionId).toBe(first.sessionId);
    const fixture = fixtureDefinition("png-svg-polyglot");
    const bytes = createAdversarialFixture(fixture.id);
    const conflict = await apiRequest(
      alpha,
      sessionPath(alpha),
      {
        body: JSON.stringify({
          byteSize: bytes.byteLength,
          declaredMimeType: fixture.declaredMimeType,
          fileName: fixture.fileName,
          kind: fixture.kind,
          rights: { basis: "owned-by-user", serviceProcessingConsent: true },
          sha256: fixtureSha256(fixture.id),
        }),
        method: "POST",
      },
      key,
    );
    expect(conflict.status).toBe(409);
    await abortUpload(alpha, first.sessionId);
  });

  it("makes foreign session/asset identifiers indistinguishable from unknown identifiers", async () => {
    const foreign = await createUpload(beta, "shell-metacharacter-name");
    const foreignSession = await apiRequest(alpha, `${sessionPath(alpha)}/${foreign.sessionId}`, {
      method: "GET",
    });
    const unknownSession = await apiRequest(alpha, `${sessionPath(alpha)}/${randomUUID()}`, {
      method: "GET",
    });
    expect(foreignSession.status).toBe(404);
    expect(unknownSession.status).toBe(404);
    expect(normalizedProblem(await responseJson(foreignSession))).toEqual(
      normalizedProblem(await responseJson(unknownSession)),
    );
    const foreignAsset = await apiRequest(alpha, assetPath(alpha, foreign.asset.id), {
      method: "GET",
    });
    const unknownAsset = await apiRequest(alpha, assetPath(alpha, randomUUID()), { method: "GET" });
    expect(foreignAsset.status).toBe(404);
    expect(unknownAsset.status).toBe(404);
    expect(normalizedProblem(await responseJson(foreignAsset))).toEqual(
      normalizedProblem(await responseJson(unknownAsset)),
    );
    await abortUpload(beta, foreign.sessionId);
  });

  it("binds signed part URLs to checksum headers and returns resumable part numbers without locators", async () => {
    const fixtureId = "shell-metacharacter-name";
    const session = await createUpload(alpha, fixtureId);
    const bytes = createAdversarialFixture(fixtureId);
    const signed = await signPart(alpha, session, bytes);
    const ttlSeconds = (Date.parse(signed.expiresAt) - Date.now()) / 1_000;
    expect(ttlSeconds).toBeGreaterThan(0);
    expect(ttlSeconds).toBeLessThanOrEqual(c2IngestionPolicy.signedUploadPartTtlSeconds + 5);
    const signedHeaderNames = Object.keys(signed.requiredHeaders).map((name) => name.toLowerCase());
    expect(signedHeaderNames).toContain("x-amz-checksum-sha256");
    expect(signedHeaderNames).not.toContain("authorization");
    expect(signedHeaderNames).not.toContain("cookie");
    await putSignedPart(signed, bytes);
    const resumed = (await getSession(alpha, session.sessionId)) as Record<string, unknown>;
    expect(resumed.recordedPartNumbers).toEqual([1]);
    const serialized = JSON.stringify(resumed);
    expect(serialized).not.toMatch(/providerUploadId|objectKey|bucket|secretAccessKey/iu);
    await abortUpload(alpha, session.sessionId);
  });

  it("rejects duplicate, reordered, gapped, and undersized non-final multipart attempts", async () => {
    const session = await createUpload(alpha, "shell-metacharacter-name");
    const invalidParts = [
      [1, 1],
      [1, 3],
      [2, 1],
    ];
    for (const partNumbers of invalidParts) {
      const response = await apiRequest(
        alpha,
        `${sessionPath(alpha)}/${session.sessionId}/complete`,
        {
          body: JSON.stringify({
            parts: partNumbers.map((partNumber) => ({
              checksumSha256: `${"A".repeat(43)}=`,
              etag: `synthetic-${partNumber}`,
              partNumber,
            })),
            sha256: fixtureSha256("shell-metacharacter-name"),
          }),
          method: "POST",
        },
        `c2-invalid-complete-${randomUUID()}`,
      );
      expect(response.status).toBe(400);
    }
    const oneByte = Buffer.from([0x00]);
    const firstSign = await apiRequest(
      alpha,
      `${sessionPath(alpha)}/${session.sessionId}/parts`,
      {
        body: JSON.stringify({
          byteSize: 1,
          checksumSha256: sha256Base64(oneByte),
          partNumber: 1,
        }),
        method: "POST",
      },
      `c2-undersized-first-${randomUUID()}`,
    );
    if (firstSign.status !== 200) {
      expect([400, 409, 422]).toContain(firstSign.status);
      await abortUpload(alpha, session.sessionId);
      return;
    }
    const first = signedAssetUploadPartSchema.parse(await responseJson(firstSign));
    const firstEtag = await putSignedPart(first, oneByte);
    const secondSign = await apiRequest(
      alpha,
      `${sessionPath(alpha)}/${session.sessionId}/parts`,
      {
        body: JSON.stringify({
          byteSize: 1,
          checksumSha256: sha256Base64(oneByte),
          partNumber: 2,
        }),
        method: "POST",
      },
      `c2-undersized-${randomUUID()}`,
    );
    if (secondSign.status === 200) {
      const second = signedAssetUploadPartSchema.parse(await responseJson(secondSign));
      const secondEtag = await putSignedPart(second, oneByte);
      const complete = await apiRequest(
        alpha,
        `${sessionPath(alpha)}/${session.sessionId}/complete`,
        {
          body: JSON.stringify({
            parts: [
              { checksumSha256: sha256Base64(oneByte), etag: firstEtag, partNumber: 1 },
              { checksumSha256: sha256Base64(oneByte), etag: secondEtag, partNumber: 2 },
            ],
            sha256: createHash("sha256")
              .update(Buffer.concat([oneByte, oneByte]))
              .digest("hex"),
          }),
          method: "POST",
        },
        `c2-undersized-complete-${randomUUID()}`,
      );
      expect([400, 409, 422]).toContain(complete.status);
    } else {
      expect([400, 409, 422]).toContain(secondSign.status);
    }
    await abortUpload(alpha, session.sessionId);
  });

  it("serializes complete/abort races and invalidates replayed part URLs", async () => {
    const fixtureId = "shell-metacharacter-name";
    const session = await createUpload(alpha, fixtureId);
    const bytes = createAdversarialFixture(fixtureId);
    const signed = await signPart(alpha, session, bytes);
    const etag = await putSignedPart(signed, bytes);
    const [complete, abort] = await Promise.all([
      completeUpload(alpha, session, fixtureId, etag),
      abortUpload(alpha, session.sessionId),
    ]);
    expect(complete.status).toBeLessThan(500);
    expect(abort.status).toBeLessThan(500);
    const firstState = (await getSession(alpha, session.sessionId)) as Record<string, unknown>;
    const secondState = (await getSession(alpha, session.sessionId)) as Record<string, unknown>;
    expect(["aborted", "completed"]).toContain(firstState.state);
    expect(secondState.state).toBe(firstState.state);
    const replay = await fetch(signed.url, {
      body: Uint8Array.from(bytes).buffer,
      headers: signed.requiredHeaders,
      method: "PUT",
      redirect: "manual",
    });
    expect(replay.ok).toBe(false);
  });

  it("keeps same-content assets tenant-owned rather than granting deduplicated access", async () => {
    const alphaSession = await createUpload(alpha, "shell-metacharacter-name");
    const betaSession = await createUpload(beta, "shell-metacharacter-name");
    expect(alphaSession.asset.id).not.toBe(betaSession.asset.id);
    const alphaToBeta = await apiRequest(alpha, assetPath(alpha, betaSession.asset.id), {
      method: "GET",
    });
    const betaToAlpha = await apiRequest(beta, assetPath(beta, alphaSession.asset.id), {
      method: "GET",
    });
    expect(alphaToBeta.status).toBe(404);
    expect(betaToAlpha.status).toBe(404);
    await Promise.all([
      abortUpload(alpha, alphaSession.sessionId),
      abortUpload(beta, betaSession.sessionId),
    ]);
  });

  it.skipIf((process.env.C2_ADVERSARIAL_EXPIRED_SESSION_ID ?? "").length === 0)(
    "keeps an orchestrator-seeded expired session terminal and cleanup-eligible",
    async () => {
      const sessionId = process.env.C2_ADVERSARIAL_EXPIRED_SESSION_ID ?? randomUUID();
      const before = (await getSession(alpha, sessionId)) as Record<string, unknown>;
      expect(before.state).toBe("expired");
      const abort = await abortUpload(alpha, sessionId);
      expect(abort.status).toBeLessThan(500);
      const after = (await getSession(alpha, sessionId)) as Record<string, unknown>;
      expect(after.state).toBe("expired");
    },
  );
});

const acceptedProcessingFixtures = adversarialFixtureDefinitions.filter(
  (fixture) => fixture.edgeExpectation === "accept-as-untrusted-hint",
);
const mediaSuiteName = mediaEnabled
  ? "live C2 hostile-media worker acceptance"
  : "live C2 hostile-media worker acceptance (set the live API variables and C2_ADVERSARIAL_MEDIA=1)";

describe.skipIf(!mediaEnabled)(mediaSuiteName, () => {
  it.each(acceptedProcessingFixtures)("processes $id fail-closed", async (fixture) => {
    const session = await createUpload(alpha, fixture.id);
    const bytes = createAdversarialFixture(fixture.id);
    const signed = await signPart(alpha, session, bytes);
    const etag = await putSignedPart(signed, bytes);
    const completed = await completeUpload(alpha, session, fixture.id, etag);
    expect([200, 202]).toContain(completed.status);
    const asset = await pollAsset(alpha, session.asset.id);
    if (fixture.processingExpectation.mode === "reject") {
      expect(["rejected", "quarantined"]).toContain(asset.status);
      expect(fixture.processingExpectation.rejectionCodes).toContain(asset.rejectionCode);
      return;
    }
    if (asset.status !== "ready") {
      expect(["rejected", "quarantined"]).toContain(asset.status);
      expect(fixture.processingExpectation.rejectionCodes).toContain(asset.rejectionCode);
      return;
    }
    const accessResponse = await apiRequest(
      alpha,
      `${assetPath(alpha, asset.id)}/access`,
      { body: JSON.stringify({ representation: "preview" }), method: "POST" },
      `c2-preview-${randomUUID()}`,
    );
    expect(accessResponse.status).toBe(200);
    const access = assetAccessResponseSchema.parse(await responseJson(accessResponse));
    expect(access.contentDisposition).toBe("inline");
    const previewResponse = await fetch(access.url, { redirect: "manual" });
    expect(previewResponse.ok).toBe(true);
    const preview = Buffer.from(await previewResponse.arrayBuffer());
    for (const marker of fixture.processingExpectation.forbiddenPreviewMarkers) {
      expect(
        preview.includes(marker),
        `derived preview retained forbidden marker for ${fixture.id}`,
      ).toBe(false);
    }
  });

  it("recomputes the full source checksum instead of trusting parts or ETags", async () => {
    const wrongSha = "b".repeat(64);
    const session = await createUpload(alpha, "shell-metacharacter-name", {
      declaredSha256: wrongSha,
    });
    const bytes = createAdversarialFixture("shell-metacharacter-name");
    const signed = await signPart(alpha, session, bytes);
    const etag = await putSignedPart(signed, bytes);
    const completed = await completeUpload(
      alpha,
      session,
      "shell-metacharacter-name",
      etag,
      wrongSha,
    );
    expect([200, 202]).toContain(completed.status);
    const asset = await pollAsset(alpha, session.asset.id);
    expect(["rejected", "quarantined"]).toContain(asset.status);
    expect(asset.rejectionCode).toBe("checksum-mismatch");
  });

  it("allows viewer preview but denies viewer original access and keeps originals attachment-only", async () => {
    const fixtureId = "shell-metacharacter-name";
    const session = await createUpload(alpha, fixtureId);
    const bytes = createAdversarialFixture(fixtureId);
    const signed = await signPart(alpha, session, bytes);
    const etag = await putSignedPart(signed, bytes);
    const completed = await completeUpload(alpha, session, fixtureId, etag);
    expect([200, 202]).toContain(completed.status);
    const asset = await pollAsset(alpha, session.asset.id);
    expect(asset.status).toBe("ready");
    const viewerPreview = await apiRequest(
      viewer,
      `${assetPath(viewer, asset.id)}/access`,
      { body: JSON.stringify({ representation: "preview" }), method: "POST" },
      `c2-viewer-preview-${randomUUID()}`,
    );
    expect(viewerPreview.status).toBe(200);
    const viewerOriginal = await apiRequest(
      viewer,
      `${assetPath(viewer, asset.id)}/access`,
      { body: JSON.stringify({ representation: "original" }), method: "POST" },
      `c2-viewer-original-${randomUUID()}`,
    );
    expect(viewerOriginal.status).toBe(403);
    const ownerOriginal = await apiRequest(
      alpha,
      `${assetPath(alpha, asset.id)}/access`,
      { body: JSON.stringify({ representation: "original" }), method: "POST" },
      `c2-owner-original-${randomUUID()}`,
    );
    expect(ownerOriginal.status).toBe(200);
    const access = assetAccessResponseSchema.parse(await responseJson(ownerOriginal));
    expect(access.contentDisposition).toBe("attachment");
    expect((Date.parse(access.expiresAt) - Date.now()) / 1_000).toBeLessThanOrEqual(
      c2IngestionPolicy.signedAccessTtlSeconds + 5,
    );
  });
});

const logPath = process.env.C2_ADVERSARIAL_LOG_PATH ?? "";
describe.skipIf(!liveEnabled || logPath.length === 0)(
  "live C2 log redaction (set C2_ADVERSARIAL_LOG_PATH to the isolated API/worker log)",
  () => {
    it("does not retain tokens, filenames, provider query credentials, or signed URLs", async () => {
      const session = await createUpload(alpha, "shell-metacharacter-name");
      const bytes = createAdversarialFixture("shell-metacharacter-name");
      const signed = await signPart(alpha, session, bytes);
      await abortUpload(alpha, session.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const logs = await readFile(logPath, "utf8");
      expect(logs.includes(alpha.token), "owner bearer token leaked to logs").toBe(false);
      expect(logs.includes(viewer.token), "viewer bearer token leaked to logs").toBe(false);
      expect(logs.includes(signed.url), "signed URL leaked to logs").toBe(false);
      expect(
        logs.includes("--output=$(synthetic-never-run);plan.png"),
        "filename leaked to logs",
      ).toBe(false);
      expect(logs).not.toMatch(/X-Amz-(?:Credential|Signature)|providerUploadId|secretAccessKey/iu);
    });
  },
);
