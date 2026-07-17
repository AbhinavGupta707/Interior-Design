import { createHash, randomUUID } from "node:crypto";

const baseUrl = process.env.C2_LIVE_STACK_API_URL ?? "http://127.0.0.1:4100";
const syntheticPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const sourceSha256 = createHash("sha256").update(syntheticPng).digest("hex");
const partChecksum = createHash("sha256").update(syntheticPng).digest("base64");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}: ${body?.code}`,
    );
  }
  return { body, response };
}

async function signIn(persona) {
  const { body } = await request("/v1/auth/local/session", {
    body: JSON.stringify({ persona }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return body.accessToken;
}

function bearer(token, idempotencyKey) {
  return {
    authorization: `Bearer ${token}`,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

const ownerToken = await signIn("homeowner-alpha");
const viewerToken = await signIn("viewer-alpha");
const runId = randomUUID();
const { body: project } = await request("/v1/projects", {
  body: JSON.stringify({ name: `C2 live synthetic ${runId.slice(0, 8)}` }),
  headers: {
    ...bearer(ownerToken, `c2-live-project-${runId}`),
    "content-type": "application/json",
  },
  method: "POST",
});

const { body: uploadSession } = await request(`/v1/projects/${project.id}/assets/upload-sessions`, {
  body: JSON.stringify({
    byteSize: syntheticPng.byteLength,
    declaredMimeType: "image/png",
    fileName: "synthetic-live-pixel.png",
    kind: "photograph",
    rights: { basis: "owned-by-user", serviceProcessingConsent: true },
    sha256: sourceSha256,
  }),
  headers: {
    ...bearer(ownerToken, `c2-live-session-${runId}`),
    "content-type": "application/json",
  },
  method: "POST",
});

const { body: signedPart } = await request(
  `/v1/projects/${project.id}/assets/upload-sessions/${uploadSession.sessionId}/parts`,
  {
    body: JSON.stringify({
      byteSize: syntheticPng.byteLength,
      checksumSha256: partChecksum,
      partNumber: 1,
    }),
    headers: {
      ...bearer(ownerToken, `c2-live-part-${runId}`),
      "content-type": "application/json",
    },
    method: "POST",
  },
);

const storageResponse = await fetch(signedPart.url, {
  body: syntheticPng,
  headers: signedPart.requiredHeaders,
  method: "PUT",
});
if (!storageResponse.ok) {
  throw new Error(`Signed storage PUT returned ${storageResponse.status}.`);
}
const etag = storageResponse.headers.get("etag");
if (etag === null) throw new Error("Signed storage PUT returned no ETag.");

await request(
  `/v1/projects/${project.id}/assets/upload-sessions/${uploadSession.sessionId}/complete`,
  {
    body: JSON.stringify({
      parts: [{ checksumSha256: partChecksum, etag, partNumber: 1 }],
      sha256: sourceSha256,
    }),
    headers: {
      ...bearer(ownerToken, `c2-live-complete-${runId}`),
      "content-type": "application/json",
    },
    method: "POST",
  },
);

let asset;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  const { body: assets } = await request(`/v1/projects/${project.id}/assets`, {
    headers: bearer(ownerToken),
  });
  asset = assets.find((candidate) => candidate.id === uploadSession.asset.id);
  if (["ready", "quarantined", "rejected"].includes(asset?.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (asset?.status !== "ready") {
  throw new Error(`Worker did not produce a ready asset; final status was ${asset?.status}.`);
}

const { body: previewAccess } = await request(
  `/v1/projects/${project.id}/assets/${asset.id}/access`,
  {
    body: JSON.stringify({ representation: "preview" }),
    headers: {
      ...bearer(viewerToken, `c2-live-viewer-preview-${runId}`),
      "content-type": "application/json",
    },
    method: "POST",
  },
);
const previewResponse = await fetch(previewAccess.url);
if (!previewResponse.ok || !previewResponse.headers.get("content-type")?.startsWith("image/")) {
  throw new Error("Ready preview was not fetchable as an image.");
}

const originalDenied = await fetch(
  `${baseUrl}/v1/projects/${project.id}/assets/${asset.id}/access`,
  {
    body: JSON.stringify({ representation: "original" }),
    headers: {
      ...bearer(viewerToken, `c2-live-viewer-original-${runId}`),
      "content-type": "application/json",
    },
    method: "POST",
  },
);
if (originalDenied.status !== 403) {
  throw new Error(`Viewer original access returned ${originalDenied.status}, expected 403.`);
}

process.stdout.write(
  `${JSON.stringify({
    assetId: asset.id,
    finalStatus: asset.status,
    previewContentType: previewResponse.headers.get("content-type"),
    projectId: project.id,
    viewerOriginalStatus: originalDenied.status,
  })}\n`,
);
