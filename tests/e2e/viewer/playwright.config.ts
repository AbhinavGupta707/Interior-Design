import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "/tmp/c10-viewer-playwright-results",
  projects: [
    {
      grep: /@canvas/u,
      name: "chromium-canvas-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@mobile/u,
      name: "chromium-mobile-390x844",
      use: { ...devices["Desktop Chrome"], viewport: { height: 844, width: 390 } },
    },
    {
      grep: /@semantics/u,
      name: "firefox-semantics",
      use: { ...devices["Desktop Firefox"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@semantics/u,
      name: "webkit-semantics",
      use: { ...devices["Desktop Safari"], viewport: { height: 960, width: 1440 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "viewer.spec.ts",
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4320",
    trace: "retain-on-failure",
  },
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
