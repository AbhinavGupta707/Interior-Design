import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  outputDir: "/tmp/c14-2-homeowner-setup-playwright-results",
  projects: [
    {
      name: "chromium-desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "persisted-homeowner-setup.spec.ts",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4341",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm exec tsx --conditions=development tests/e2e/homeowner-setup/mock-c14-2-backend.ts",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4342/health",
    },
    {
      command: "pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 4341",
      cwd: repositoryRoot,
      env: {
        C10_VIEWER_EVIDENCE_CLASSIFICATION: "fixture-presentation",
        HOME_DESIGN_API_BASE_URL: "http://127.0.0.1:4342",
        NODE_OPTIONS: "--conditions=development",
      },
      reuseExistingServer: false,
      timeout: 90_000,
      url: "http://127.0.0.1:4341/sign-in",
    },
  ],
  workers: 1,
});
