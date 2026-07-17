import { describe, expect, it } from "vitest";

const environment = Object.freeze({
  baseUrl: process.env.C7_LIVE_API_BASE_URL,
  captureSessionId: process.env.C7_LIVE_CAPTURE_SESSION_ID,
  foreignProjectId: process.env.C7_LIVE_FOREIGN_PROJECT_ID,
  foreignToken: process.env.C7_LIVE_FOREIGN_TOKEN,
  ownerProjectId: process.env.C7_LIVE_OWNER_PROJECT_ID,
  ownerToken: process.env.C7_LIVE_OWNER_TOKEN,
  viewerToken: process.env.C7_LIVE_VIEWER_TOKEN,
});
const enabled = Object.values(environment).every(
  (value): value is string => typeof value === "string" && value.length > 0,
);
const liveDescribe = enabled ? describe : describe.skip;

liveDescribe("C7 live API disclosure-order probes", () => {
  it("returns 401 before revealing capture-session existence", async () => {
    const response = await request(
      `/v1/projects/${required(environment.ownerProjectId)}/capture-sessions/${required(environment.captureSessionId)}`,
    );
    expect(response.status).toBe(401);
  });

  it("returns one 404 shape for owner-to-foreign and foreign-to-owner IDOR", async () => {
    const ownerToForeign = await request(
      `/v1/projects/${required(environment.foreignProjectId)}/capture-sessions/${required(environment.captureSessionId)}`,
      required(environment.ownerToken),
    );
    const foreignToOwner = await request(
      `/v1/projects/${required(environment.ownerProjectId)}/capture-sessions/${required(environment.captureSessionId)}`,
      required(environment.foreignToken),
    );
    expect(ownerToForeign.status).toBe(404);
    expect(foreignToOwner.status).toBe(404);
    expect(await boundedErrorCode(ownerToForeign)).toBe(await boundedErrorCode(foreignToOwner));
  });

  it("allows a viewer to read but denies cancel without state disclosure", async () => {
    const path = `/v1/projects/${required(environment.ownerProjectId)}/capture-sessions/${required(environment.captureSessionId)}`;
    expect((await request(path, required(environment.viewerToken))).status).toBe(200);
    const cancel = await request(`${path}/cancel`, required(environment.viewerToken), {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c7-live-viewer-denial" },
      method: "POST",
    });
    expect(cancel.status).toBe(403);
  });

  it("rejects public object keys and signed URLs on an in-scope upload request", async () => {
    const response = await request(
      `/v1/projects/${required(environment.ownerProjectId)}/capture-sessions/${required(environment.captureSessionId)}/artifact-upload-sessions`,
      required(environment.ownerToken),
      {
        body: JSON.stringify({
          byteSize: 64,
          contentType: "application/json",
          kind: "roomplan-normalized-json",
          objectKey: "../../foreign/source",
          sha256: "a".repeat(64),
          signedUrl: "file:///private/source",
        }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "c7-live-confusion" },
        method: "POST",
      },
    );
    expect([400, 422]).toContain(response.status);
  });
});

async function request(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  return fetch(new URL(path, required(environment.baseUrl)), {
    ...init,
    headers,
    redirect: "error",
  });
}

async function boundedErrorCode(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.byteLength).toBeLessThanOrEqual(16_384);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { code?: unknown };
  expect(typeof parsed.code).toBe("string");
  return String(parsed.code);
}

function required(value: string | undefined): string {
  if (value === undefined || value.length === 0) throw new Error("C7_LIVE_ENVIRONMENT_INCOMPLETE");
  return value;
}
