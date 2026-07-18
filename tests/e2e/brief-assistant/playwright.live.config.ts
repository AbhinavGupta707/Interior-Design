import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  outputDir: "/tmp/c11-brief-assistant-live-results",
  projects: [
    {
      grep: /@producer/u,
      name: "chromium-production-desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@viewer/u,
      name: "webkit-production-desktop-1440x960",
      use: { ...devices["Desktop Safari"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@mobile/u,
      name: "chromium-production-mobile-390x844",
      use: { ...devices["Desktop Chrome"], viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "brief-assistant.live.spec.ts",
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:4340",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/brief-assistant/live-api.mjs",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 60_000,
      url: "http://127.0.0.1:4341/health/ready",
    },
    {
      command:
        "HOME_DESIGN_API_BASE_URL=http://127.0.0.1:4341 C11_CONSULTATION_EVIDENCE_CLASSIFICATION=real-backend pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 4340",
      cwd: repositoryRoot,
      reuseExistingServer: false,
      timeout: 90_000,
      url: "http://127.0.0.1:4340/sign-in",
    },
  ],
  workers: 1,
});
