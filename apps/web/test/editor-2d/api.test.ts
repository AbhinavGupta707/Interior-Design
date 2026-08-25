import { describe, expect, it, vi } from "vitest";

import { createEditorClient } from "../../src/features/editor-2d/api";
import { snapshotRecord, uuid } from "./fixtures";

describe("C14.2 editor browser client", () => {
  it("sends only the strict acknowledgement and caller-held idempotency key", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(snapshotRecord));
    const key = "persisted-home-workspace-key";
    await createEditorClient(transport).initializeExistingHomeWorkspace(uuid(5), key);

    expect(transport).toHaveBeenCalledExactlyOnceWith(
      `/api/c5/projects/${uuid(5)}/models/existing/home-workspace`,
      expect.objectContaining({ cache: "no-store", method: "POST" }),
    );
    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    if (typeof init.body !== "string") throw new Error("Expected a JSON request body.");
    const body: unknown = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    expect(body).toEqual({ confirmUnmeasuredInterior: true });
    expect(headers.get("idempotency-key")).toBe(key);
    expect(JSON.stringify(body)).not.toMatch(
      /snapshot|actor|property|address|dimension|geometry/iu,
    );
  });

  it("maps preview expiry before generic 409 conflict", async () => {
    for (const code of ["PREVIEW_EXPIRED", "FUSION_PREVIEW_EXPIRED"]) {
      const client = createEditorClient(
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ code, detail: "Reload and create a fresh preview." }, { status: 409 }),
          ),
      );
      await expect(
        client.initializeExistingHomeWorkspace(uuid(5), "persisted-home-workspace-key"),
      ).rejects.toMatchObject({ code, kind: "expired" });
    }

    const conflict = createEditorClient(
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "BRANCH_REVISION_CONFLICT", detail: "Reload exact server state." },
            { status: 409 },
          ),
        ),
    );
    await expect(
      conflict.initializeExistingHomeWorkspace(uuid(5), "persisted-home-workspace-key"),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("distinguishes an already-initialized profile and fails offline closed", async () => {
    const initialized = createEditorClient(
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "TYPED_OPERATION_REQUIRED", detail: "Use typed C5 operations." },
            { status: 409 },
          ),
        ),
    );
    await expect(
      initialized.initializeExistingHomeWorkspace(uuid(5), "persisted-home-workspace-key"),
    ).rejects.toMatchObject({ kind: "already-initialized" });

    const offline = createEditorClient(vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(
      offline.initializeExistingHomeWorkspace(uuid(5), "persisted-home-workspace-key"),
    ).rejects.toMatchObject({ kind: "offline" });
  });
});
