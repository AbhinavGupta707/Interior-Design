import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "/tmp/c10-viewer-performance-results",
  projects: [
    {
      name: "chromium-desktop-performance",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      name: "chromium-mobile-performance",
      use: { ...devices["Desktop Chrome"], viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "viewer-performance.spec.ts",
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:4320", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node tests/e2e/viewer/mock-c10-backend.mjs",
      cwd: repositoryRoot,
      reuseExistingServer: true,
      timeout: 30_000,
      url: "http://127.0.0.1:4321/health",
    },
    {
      command:
        "HOME_DESIGN_API_BASE_URL=http://127.0.0.1:4321 C10_VIEWER_EVIDENCE_CLASSIFICATION=fixture-presentation pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 4320",
      cwd: repositoryRoot,
      reuseExistingServer: true,
      timeout: 60_000,
      url: "http://127.0.0.1:4320",
    },
  ],
  workers: 1,
});
