import type { ModelCommit } from "../../../packages/contracts/src/index";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createSceneFromCommittedCurrent } from "../../../apps/web/src/features/homeowner-journey/canonical-handoff";
import { draft, project, snapshotRecord } from "../../../apps/web/test/model-fusion/fixtures";

describe("C14.1 homeowner journey security boundary", () => {
  it("defines viewer rendering without preview, commit or scene mutation controls", async () => {
    const panel = await readFile(
      path.join(
        process.cwd(),
        "apps",
        "web",
        "src",
        "features",
        "homeowner-journey",
        "canonical-handoff-panel.tsx",
      ),
      "utf8",
    );
    const viewerStart = panel.indexOf("{!editable ? (");
    const viewerEnd = panel.indexOf(") : (", viewerStart);
    expect(viewerStart).toBeGreaterThan(-1);
    expect(viewerEnd).toBeGreaterThan(viewerStart);
    const viewerBoundary = panel.slice(viewerStart, viewerEnd);

    expect(viewerBoundary).toContain("Viewer access is read-only");
    expect(viewerBoundary).not.toContain("<button");
    expect(viewerBoundary).not.toContain("Preview typed corrections");
    expect(viewerBoundary).not.toContain("Confirm corrections and commit");
    expect(viewerBoundary).not.toContain("Create scene from current committed profile");
  });

  it("fails a viewer scene handoff before invoking the server-facing create client", async () => {
    const createJob = vi.fn();
    const client = {
      createJob,
      loadWorkspace: vi.fn().mockResolvedValue({
        jobs: [],
        project,
        session: { actor: { role: "viewer" } },
        snapshots: [
          {
            modelId: snapshotRecord.modelId,
            profile: "existing",
            projectId: project.id,
            schemaVersion: "c4-canonical-home-v1",
            snapshotId: snapshotRecord.id,
            snapshotSha256: snapshotRecord.snapshotSha256,
          },
        ],
      }),
    } as unknown as Parameters<typeof createSceneFromCommittedCurrent>[0];
    const commit = {
      branchId: draft.branchId,
      snapshotId: snapshotRecord.id,
      snapshotSha256: snapshotRecord.snapshotSha256,
    } as ModelCommit;

    await expect(createSceneFromCommittedCurrent(client, project.id, commit)).rejects.toMatchObject(
      {
        code: "VIEWER_CANNOT_COMPILE",
      },
    );
    expect(createJob).not.toHaveBeenCalled();
  });

  it("introduces no C8 v2 execution import or raw locator/credential field in the bridge source", async () => {
    const root = path.join(process.cwd(), "apps", "web", "src", "features", "homeowner-journey");
    const files = [
      "canonical-handoff-panel.tsx",
      "canonical-handoff.ts",
      "homeowner-journey.tsx",
      "journey-loader.ts",
      "journey-state.ts",
      "navigation.ts",
    ];
    const source = (
      await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")))
    ).join("\n");
    expect(source).not.toMatch(/c8[-_/ ]?v2|blackwell/iu);
    expect(source).not.toMatch(
      /signedUrl|storageLocator|objectKey|bearerToken|authorizationHeader/iu,
    );
    expect(source).not.toMatch(/console\.(?:debug|error|info|log|warn)/u);
    expect(source).toContain('workspace.session.actor.role === "viewer"');
    expect(source).toContain("snapshot.snapshotSha256 === commit.snapshotSha256");
  });
});
