import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: "/tmp/c1-playwright-results",
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  timeout: 35_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/onboarding/mock-c1-api.mjs",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4110/health",
    },
    {
      command:
        "HOME_DESIGN_API_BASE_URL=http://127.0.0.1:4110 pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 3100",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 60_000,
      url: "http://127.0.0.1:3100/sign-in",
    },
  ],
  workers: 1,
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 900, width: 1440 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
