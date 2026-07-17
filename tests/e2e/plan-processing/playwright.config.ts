import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "/tmp/c6-plan-playwright-results",
  projects: [
    {
      grep: /@(abstention|conflict|desktop|recovery|viewer)/u,
      name: "desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@mobile/u,
      name: "mobile-390x844",
      use: { ...devices["iPhone 13"], viewport: { height: 844, width: 390 } },
    },
    {
      grep: /@keyboard/u,
      name: "keyboard-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "plan-processing.spec.ts",
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4316",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/plan-processing/mock-c6-plan-workspace.mjs",
    cwd: repositoryRoot,
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4316/health",
  },
  workers: 1,
});
