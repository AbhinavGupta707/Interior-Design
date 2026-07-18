import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../../..");
const reuseExistingServer = process.env.C12_REUSE_EXISTING_SERVERS === "1";

export default defineConfig({
  expect: { timeout: 20_000 },
  fullyParallel: false,
  outputDir: "/tmp/c12-design-options-playwright-results",
  projects: [
    {
      grep: /@workflow|@keyboard|@status/u,
      name: "chromium-desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@cross-browser|@status/u,
      name: "firefox-desktop-1440x960",
      use: { ...devices["Desktop Firefox"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@cross-browser|@status/u,
      name: "webkit-desktop-1440x960",
      use: { ...devices["Desktop Safari"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@mobile/u,
      name: "chromium-mobile-390x844",
      use: { ...devices["Desktop Chrome"], viewport: { height: 844, width: 390 } },
    },
    {
      grep: /@mobile/u,
      name: "firefox-mobile-390x844",
      use: { ...devices["Desktop Firefox"], viewport: { height: 844, width: 390 } },
    },
    {
      grep: /@mobile/u,
      name: "webkit-mobile-390x844",
      use: { ...devices["Desktop Safari"], viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "design-options.spec.ts",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:4340", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node --experimental-strip-types tests/e2e/design-options/mock-c12-backend.mjs",
      cwd: repositoryRoot,
      reuseExistingServer,
      timeout: 60_000,
      url: "http://127.0.0.1:4341/health",
    },
    {
      command:
        "HOME_DESIGN_API_BASE_URL=http://127.0.0.1:4341 C12_OPTION_EVIDENCE_CLASSIFICATION=synthetic-fixture pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 4340",
      cwd: repositoryRoot,
      reuseExistingServer,
      timeout: 60_000,
      url: "http://127.0.0.1:4340",
    },
  ],
  workers: 1,
});
