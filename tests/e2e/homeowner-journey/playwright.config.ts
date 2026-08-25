import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "/tmp/c14-1-homeowner-journey-playwright-results",
  projects: [
    {
      grep: /@(desktop|roles|states)/u,
      name: "desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@mobile/u,
      name: "mobile-390x844",
      use: { ...devices["Desktop Chrome"], viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "homeowner-journey.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4335",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm exec tsx --conditions=development tests/e2e/homeowner-journey/mock-c14-1-backend.ts",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4336/health",
    },
    {
      command: "pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 4335",
      cwd: repositoryRoot,
      env: {
        C10_VIEWER_EVIDENCE_CLASSIFICATION: "fixture-presentation",
        HOME_DESIGN_API_BASE_URL: "http://127.0.0.1:4336",
        NODE_OPTIONS: "--conditions=development",
      },
      reuseExistingServer: false,
      timeout: 90_000,
      url: "http://127.0.0.1:4335/sign-in",
    },
  ],
  workers: 1,
});
