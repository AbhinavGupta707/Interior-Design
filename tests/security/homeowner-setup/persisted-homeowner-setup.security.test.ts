import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readyPlanAssetSchema } from "../../../apps/web/src/features/plan-import/contracts";
import { asset } from "../../../apps/web/test/plan-import/fixtures";
import {
  buildUnmeasuredHomeWorkspaceRequest,
  homeWorkspaceAcknowledgementSchema,
} from "../../../apps/web/src/app/api/c5/_shared/home-workspace";

describe("C14.2 persisted homeowner setup security", () => {
  it("rejects browser authority and interior/model payloads at the acknowledgement boundary", () => {
    const forbiddenBodies = [
      { actorUserId: "e1420000-0000-4000-8000-000000000099" },
      { projectId: asset.projectId },
      { propertyId: "e1420000-0000-4000-8000-000000000012" },
      { snapshot: {} },
      { rooms: [{ name: "Invented room" }] },
    ];
    for (const body of forbiddenBodies) {
      expect(
        homeWorkspaceAcknowledgementSchema.safeParse({
          confirmUnmeasuredInterior: true,
          ...body,
        }).success,
      ).toBe(false);
    }
    expect(homeWorkspaceAcknowledgementSchema.safeParse({ confirmUnmeasuredInterior: true }).success)
      .toBe(true);
  });

  it("binds all setup provenance to the authenticated actor with no property evidence promotion", () => {
    const actorUserId = "e1420000-0000-4000-8000-000000000098";
    const request = buildUnmeasuredHomeWorkspaceRequest({
      actorUserId,
      idempotencyKey: "security-actor-binding-key",
      projectId: asset.projectId,
      propertyId: "e1420000-0000-4000-8000-000000000012",
    });
    const level = request.snapshot.elements.levels[0];
    expect(level?.origin.actorUserId).toBe(actorUserId);
    expect(level?.origin.evidenceIds).toEqual([]);
    expect(level?.name.attribution.evidenceIds).toEqual([]);
    expect(level?.elevationMm.attribution.evidenceIds).toEqual([]);
    expect(level?.storeyHeightMm.attribution.evidenceIds).toEqual([]);
    expect(request.snapshot.coordinateSystem.globalAnchor.status).toBe("not-established");
    expect(request.snapshot.knownLimitations).toContainEqual(
      expect.objectContaining({ code: "PROPERTY_CONTEXT_PROVES_NO_INTERIOR" }),
    );
  });

  it("requires service consent and training denied for a C6-ready source", () => {
    expect(readyPlanAssetSchema.safeParse(asset).success).toBe(true);
    expect(
      readyPlanAssetSchema.safeParse({
        ...asset,
        rights: { ...asset.rights, serviceProcessingConsent: false },
      }).success,
    ).toBe(false);
    expect(
      readyPlanAssetSchema.safeParse({
        ...asset,
        rights: { ...asset.rights, trainingUseConsent: "granted" },
      }).success,
    ).toBe(false);
  });

  it("contains no C8 v2 invocation or hidden model-setup authority in the accepted public path", async () => {
    const files = [
      "apps/web/src/app/api/c5/_shared/home-workspace.ts",
      "apps/web/src/app/api/c5/[...segments]/route.ts",
      "apps/web/src/app/api/c6/[...segments]/route.ts",
      "apps/web/src/app/api/c10/[...segments]/route.ts",
      "apps/web/src/features/editor-2d/api.ts",
      "apps/web/src/features/editor-2d/editor-workspace.tsx",
      "apps/web/src/features/homeowner-journey/journey-loader.ts",
      "apps/web/src/features/homeowner-journey/journey-state.ts",
      "apps/web/src/features/plan-import/plan-import-workspace.tsx",
      "apps/web/src/features/viewer-3d/viewer-workspace.tsx",
      "tests/e2e/homeowner-setup/mock-c14-2-backend.ts",
      "tests/e2e/homeowner-setup/persisted-homeowner-setup.spec.ts",
    ];
    const source = (
      await Promise.all(files.map((file) => readFile(path.join(process.cwd(), file), "utf8")))
    ).join("\n");
    expect(source).not.toMatch(/ml\/reconstruction\/windows-nvidia-v2|c8[-_/ ]?v2/iu);
    expect(source).not.toMatch(/signedUrl|storageLocator|objectKey|bearerToken/iu);

    const editorClient = await readFile(
      path.join(process.cwd(), "apps/web/src/features/editor-2d/api.ts"),
      "utf8",
    );
    const setupStart = editorClient.indexOf("initializeExistingHomeWorkspace(");
    const setupEnd = editorClient.indexOf("listBranches(", setupStart);
    const setupSource = editorClient.slice(setupStart, setupEnd);
    expect(setupSource).toContain("{ confirmUnmeasuredInterior: true }");
    expect(setupSource).not.toMatch(/actorUserId|propertyId|snapshot|rooms|walls/iu);
  });
});
