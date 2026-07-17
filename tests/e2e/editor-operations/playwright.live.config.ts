import { defineConfig, devices } from "@playwright/test";

const storageState = process.env.C5_LIVE_EDITOR_STORAGE_STATE;

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "/tmp/c5-live-editor-playwright-results",
  projects: [
    {
      name: "live-desktop-1440x960",
      use: { ...devices["Desktop Chrome"], viewport: { height: 960, width: 1440 } },
    },
    {
      name: "live-mobile-390x844",
      use: { ...devices["iPhone 13"], viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  testMatch: "live-editor.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: process.env.C5_LIVE_EDITOR_URL ?? "http://127.0.0.1:3000",
    ...(storageState === undefined ? {} : { storageState }),
    trace: "retain-on-failure",
  },
  workers: 1,
});
