import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 10_000 },
  outputDir: "/tmp/c9-model-fusion-live-results",
  projects: [
    {
      grep: /@desktop/u,
      name: "live-desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      grep: /@mobile/u,
      name: "live-mobile-390x844",
      use: { ...devices["iPhone 13"], viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "model-fusion.live.spec.ts",
  timeout: 90_000,
  use: {
    baseURL: process.env.C9_LIVE_FUSION_URL ?? "http://localhost:3019",
    trace: "retain-on-failure",
  },
  workers: 1,
});
