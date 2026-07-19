import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "../../../apps/web/src/app/api/c14/[...segments]/route";
import { safeArtifactUrl } from "../../../apps/web/src/features/render-stills/artifact-verification";
import { ids, job } from "../../../apps/web/test/render-stills/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const context = (segments: string[]) => ({ params: Promise.resolve({ segments }) });

function request(input: {
  readonly authorization?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly key?: string;
  readonly method?: "GET" | "POST";
}) {
  const method = input.method ?? (input.body === undefined ? "GET" : "POST");
  const result = new Request("http://localhost:3000/api/c14/security", {
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    headers: {
      ...(input.authorization ? { authorization: input.authorization } : {}),
      ...(input.cookie ? { cookie: `hds_c1_session=${input.cookie}` } : {}),
      ...(method === "GET"
        ? {}
        : {
            "content-type": "application/json",
            "idempotency-key": input.key ?? "c1400000-0000-4000-8000-000000000099",
          }),
    },
    method,
  });
  Object.defineProperty(result, "cookies", {
    value: {
      get(name: string) {
        return input.cookie && name === "hds_c1_session" ? { value: input.cookie } : undefined;
      },
    },
  });
  return result;
}

describe("C14 independent BFF and artifact security", () => {
  it("does not accept browser Authorization as a server session substitute", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      request({ authorization: "Bearer attacker" }),
      context(["projects", ids.project, "render-jobs"]),
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects caller authority, traversal, extra routes and malformed mutation keys", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const forged = await POST(
      request({
        body: {
          ...job.request,
          authoritativeSceneGlbSha256: "f".repeat(64),
          providerEnabled: true,
          surveyAccurate: true,
        },
        cookie: "private-session",
      }),
      context(["projects", ids.project, "render-jobs"]),
    );
    const traversal = await GET(
      request({ cookie: "private-session" }),
      context(["projects", ids.project, "render-jobs", "..%2Fforeign"]),
    );
    const extra = await GET(
      request({ cookie: "private-session" }),
      context(["projects", ids.project, "render-jobs", ids.job, "result", "raw"]),
    );
    const badKey = await POST(
      request({ body: job.request, cookie: "private-session", key: "weak", method: "POST" }),
      context(["projects", ids.project, "render-jobs"]),
    );
    expect([forged.status, traversal.status, extra.status, badKey.status]).toEqual([
      400, 404, 404, 400,
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redacts hostile upstream details and rejects unsafe signed URL forms", async () => {
    const secret = "PRIVATE_SIGNED_URL_TOKEN_AND_OBJECT_KEY";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "RENDER_FAILED", detail: secret, signedUrl: `https://invalid/${secret}` },
            { status: 503 },
          ),
        ),
    );
    const response = await GET(
      request({ cookie: "private-session" }),
      context(["projects", ids.project, "render-jobs"]),
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(secret);
    for (const url of [
      "http://example.com/private",
      "ftp://example.com/private",
      "https://user:password@example.com/private",
      "https://example.com/private#token",
    ]) {
      expect(() => safeArtifactUrl(url)).toThrow();
    }
  });

  it("does not persist URLs, blobs or private render payloads", () => {
    const root = path.resolve(process.cwd(), "apps/web/src/features/render-stills");
    const source = [
      "render-stills-workspace.tsx",
      "verified-artifact.tsx",
      "artifact-verification.ts",
    ]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/iu);
    expect(source).toContain("URL.revokeObjectURL");
    expect(source).toContain('credentials: "omit"');
    expect(source).toContain('redirect: "error"');
  });
});
