import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: "/tmp/c2-adversarial-playwright-results",
  reporter: [["line"]],
  retries: 0,
  testDir: __dirname,
  timeout: 35_000,
  use: {
    baseURL: process.env.C2_ADVERSARIAL_WEB_URL ?? "http://127.0.0.1:0",
    trace: "retain-on-failure",
  },
  workers: 1,
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { height: 900, width: 1_440 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
