import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  outputDir: "/tmp/c14-3-homeowner-design-studio-results",
  projects: [
    {
      name: "chromium-desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "homeowner-design-studio.spec.ts",
  timeout: 120_000,
  use: {
    actionTimeout: 15_000,
    baseURL: "http://127.0.0.1:4363",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 4363",
    cwd: repositoryRoot,
    env: {
      C10_VIEWER_EVIDENCE_CLASSIFICATION: "fixture-presentation",
      C11_CONSULTATION_EVIDENCE_CLASSIFICATION: "fixture-presentation",
      C12_OPTION_EVIDENCE_CLASSIFICATION: "synthetic-fixture",
      C13_CATALOG_EVIDENCE_CLASSIFICATION: "synthetic-fixture",
      C14_RENDER_EVIDENCE_CLASSIFICATION: "synthetic-fixture",
      NODE_OPTIONS: "--conditions=development",
    },
    reuseExistingServer: false,
    timeout: 90_000,
    url: "http://127.0.0.1:4363/projects",
  },
  workers: 1,
});
