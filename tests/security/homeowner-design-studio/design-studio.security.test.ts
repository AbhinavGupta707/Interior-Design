import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { renderLaunchContextSchema } from "../../../apps/web/src/features/render-stills/launch-context";
import {
  readDesignOptionRecovery,
  saveDesignOptionRecovery,
} from "../../../apps/web/src/features/design-options/recovery";
import { confirmationA, ids } from "../../../apps/web/test/design-options/fixtures";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("C14.3 product-integration security boundary", () => {
  it("keeps C8-v2 acceptance-only while the production worker imports the accepted registry", () => {
    const exposure = readFileSync(
      path.join(
        process.cwd(),
        "services/inference-worker/src/inference_worker/reconstruction/blackwell_v2/exposure.py",
      ),
      "utf8",
    );
    const productionWorker = readFileSync(
      path.join(
        process.cwd(),
        "services/inference-worker/src/inference_worker/reconstruction/worker_protocol.py",
      ),
      "utf8",
    );

    expect(exposure).toContain('CAPABILITY_STATUS: Final = "acceptance-only"');
    expect(exposure).toContain("PRODUCTION_ROUTING_ENABLED: Final = False");
    expect(exposure).toContain('raise RuntimeError("C8_V2_ACCEPTANCE_ONLY")');
    expect(productionWorker).toContain("from .registry import discover_reconstruction_adapters");
    expect(productionWorker).not.toMatch(/blackwell_v2|require_production_routing/iu);
  });

  it("adds no C8-v2 invocation, reconstruction promotion, secret field or unsafe logging", () => {
    const root = path.join(process.cwd(), "apps/web/src/features");
    const files = [
      "design-consultation/consultation-workspace.tsx",
      "design-consultation/twin-gate.ts",
      "design-options/contracts.ts",
      "design-options/design-options-workspace.tsx",
      "design-options/recovery.ts",
      "homeowner-journey/homeowner-journey.tsx",
      "homeowner-journey/journey-loader.ts",
      "homeowner-journey/journey-state.ts",
      "materials-products/materials-products-workspace.tsx",
      "render-stills/launch-context.ts",
      "render-stills/render-stills-workspace.tsx",
      "viewer-3d/viewer-workspace.tsx",
    ];
    const source = files.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");

    expect(source).not.toMatch(/c8[-_/ ]?v2|windows-nvidia-v2|blackwell/iu);
    expect(source).not.toMatch(/reconstruction.{0,40}(?:commit|canonical|promot)/iu);
    expect(source).not.toMatch(
      /signedUrl|storageLocator|objectKey|bearerToken|authorizationHeader|rawAddress/iu,
    );
    expect(source).not.toMatch(/console\.(?:debug|error|info|log|warn)/u);
  });

  it("keeps same-browser selection bounded and leaves confirmation authority on the server", () => {
    const local = storage();
    saveDesignOptionRecovery(local, {
      projectId: ids.project,
      savedAt: "2026-08-25T20:00:00.000Z",
      schemaVersion: "c12-design-options-recovery-v2",
      selectedJobId: ids.job,
    });

    const serialized = [...local.values.values()].join("");
    expect(serialized.length).toBeLessThanOrEqual(8_000);
    expect(serialized).not.toMatch(/sourceBytes|signedUrl|token|credential|rawAddress/iu);
    expect(serialized).not.toContain(confirmationA.id);
    expect(readDesignOptionRecovery(local, "c1200000-0000-4000-8000-000000000099")).toBeUndefined();
  });

  it("rejects a C14 specification handoff unless identity and revision are paired", () => {
    expect(
      renderLaunchContextSchema.safeParse({
        sourceSceneJobId: "c1000000-0000-4000-8000-000000000001",
        specificationId: "c1300000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
    expect(
      renderLaunchContextSchema.safeParse({
        sourceSceneJobId: "c1000000-0000-4000-8000-000000000001",
        specificationId: "c1300000-0000-4000-8000-000000000001",
        specificationRevision: 2,
      }).success,
    ).toBe(true);
  });
});
