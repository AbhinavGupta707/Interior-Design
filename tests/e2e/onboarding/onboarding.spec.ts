import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const mockAPI = "http://127.0.0.1:4110";
const screenshotDirectory = "/tmp/c1-playwright-evidence";

test.beforeEach(async ({ request }) => {
  await request.post(`${mockAPI}/__test/reset`);
});

test("signs in, creates a project, saves, edits and resumes structured intake", async ({
  page,
}, testInfo) => {
  const consoleProblems: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.method() === "GET" && request.failure()?.errorText === "net::ERR_ABORTED") {
      return;
    }
    failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });

  await page.goto("/sign-in");
  await expect(page).toHaveTitle(/Local fixture sign in/u);
  await expect(page.getByRole("heading", { name: "Continue with a local fixture" })).toBeVisible();

  if (testInfo.project.name === "desktop-chromium") {
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("Skip to main content");
  }
  const avery = page.getByRole("radio", { name: /Avery Morgan/u });
  await avery.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /Morgan Lee/u })).toBeChecked();
  await avery.check();
  await page.getByRole("button", { name: "Continue as Avery Morgan" }).click();

  await expect(page).toHaveURL(/\/projects$/u);
  await expect(page.getByText("Local fixture · Synthetic data")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();

  await page.getByLabel("New project name").fill("Sample terrace refresh");
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/onboarding\/33333333-3333-4333-8333-000000000001$/u);
  await expect(page.getByRole("heading", { name: "Tell us about your home" })).toBeVisible();
  await expect(page.getByText("native capture is not implemented in C1")).toBeVisible();

  await page.getByLabel("Bedrooms Optional").fill("3");
  await page.getByLabel("Goals *").fill("Improve daylight\nAdd better storage");
  await page.getByLabel("Style words").fill("Calm\nNatural materials");
  await page.getByLabel("Plans").check();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved · version 1")).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sample terrace refresh" })).toBeVisible();
  await page.getByRole("link", { name: "Resume intake" }).click();
  await expect(page.getByLabel("Goals *")).toHaveValue("Improve daylight\nAdd better storage");

  await page
    .getByLabel("Goals *")
    .fill("Improve daylight\nAdd better storage\nCreate a quiet reading corner");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved · version 2")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    fullPage: false,
    path: `${screenshotDirectory}/${testInfo.project.name}-intake.png`,
  });
  expect(consoleProblems).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("surfaces stale intake without overwriting and reloads the current version", async ({
  page,
  request,
}) => {
  await signInAndCreateProject(page);
  await page.getByLabel("Goals *").fill("Keep the existing floor");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved · version 1")).toBeVisible();

  await request.post(`${mockAPI}/__test/bump-intake/33333333-3333-4333-8333-000000000001`);
  await page.getByLabel("Goals *").fill("Replace the floor without review");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByText("A newer intake was saved elsewhere.")).toBeVisible();
  await expect(page.getByText("Your edits were not overwritten.")).toBeVisible();
  await expect(page.getByLabel("Goals *")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
  await page.getByRole("button", { name: "Load latest saved version" }).click();
  await expect(page.getByLabel("Goals *")).toHaveValue("Keep the existing floor");
  await expect(page.getByText("Saved version 2")).toBeVisible();
});

test("shows expired, forbidden, offline and retry recovery states", async ({ page }) => {
  await page.goto("/sign-in");

  await page.route("**/api/c1/projects", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ detail: "Fixture session expired.", status: 401 }),
      contentType: "application/problem+json",
      status: 401,
    });
  });
  await page.getByRole("button", { name: "Continue as Avery Morgan" }).click();
  await expect(page.getByRole("heading", { name: "Your session has expired" })).toBeVisible();

  await page.unroute("**/api/c1/projects");
  await page.goto("/sign-in");
  await page.route("**/api/c1/projects", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ detail: "Forbidden fixture project list.", status: 403 }),
      contentType: "application/problem+json",
      status: 403,
    });
  });
  await page.getByRole("button", { name: "Continue as Avery Morgan" }).click();
  await expect(page.getByRole("heading", { name: "Projects are unavailable" })).toBeVisible();

  await page.unroute("**/api/c1/projects");
  await page.route("**/api/c1/projects", async (route) => {
    await route.abort("internetdisconnected");
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();

  await page.unroute("**/api/c1/projects");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();
});

async function signInAndCreateProject(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Avery Morgan" }).click();
  await page.getByLabel("New project name").fill("Sample terrace refresh");
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("heading", { name: "Tell us about your home" })).toBeVisible();
}
