import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "/tmp/c3-playwright-results",
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3300",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/property/mock-c3-api.mjs",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 30_000,
      url: "http://127.0.0.1:4130/health",
    },
    {
      command:
        "HOME_DESIGN_API_BASE_URL=http://127.0.0.1:4130 pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 3300",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 60_000,
      url: "http://127.0.0.1:3300/sign-in",
    },
  ],
  workers: 1,
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      name: "mobile-390-chromium",
      use: { ...devices["iPhone 13"], viewport: { height: 844, width: 390 } },
    },
  ],
});
