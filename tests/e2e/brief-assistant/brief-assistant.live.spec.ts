import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const projectName = "C11 producer-live whole-home consultation";
const screenshotDirectory = "/tmp/c11-brief-assistant-live-evidence";

interface PageHealth {
  readonly consoleProblems: string[];
  readonly failedRequests: string[];
  readonly unexpectedOrigins: string[];
}

test("@producer creates intake, initializes a brief, confirms a local proposal and accepts it through the real BFF and API", async ({
  page,
}) => {
  const health = watch(page);
  await signIn(page, "Alpha homeowner");
  await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();

  await page.getByLabel("New project name").fill(projectName);
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("heading", { name: "Tell us about your home" })).toBeVisible();
  await page.getByLabel("Dwelling type").selectOption("terraced-house");
  await page.getByLabel("Bedrooms Optional").fill("3");
  await page.getByLabel("Bathrooms Optional").fill("2");
  await page.getByLabel("Levels Optional").fill("2");
  await page.getByLabel("Address summary Optional").fill("Synthetic north-facing sample terrace");
  await page.getByLabel("Adults").fill("2");
  await page.getByLabel("Pets").fill("1");
  await page
    .getByLabel("Goals *")
    .fill("Create a coherent whole-home direction\nImprove evening warmth");
  await page.getByLabel("Must keep").fill("Existing oak dining table");
  await page.getByLabel("Must change").fill("Dark hallway");
  await page.getByLabel("Style words").fill("Warm\nCalm\nNatural materials");
  await page.getByLabel("Accessibility needs").fill("Step-free circulation where evidence permits");
  await page.getByLabel("Photographs").check();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page).toHaveURL(/\/projects$/u);
  const project = page.getByRole("article").filter({ hasText: projectName });
  await project.getByRole("link", { name: "Design consultation" }).click();
  await expect(
    page.getByRole("heading", { name: "Create the first attributable design brief" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic north-facing sample terrace")).toHaveCount(0);
  await page
    .getByLabel(
      "I reviewed these selected saved intake facts and want to create design brief revision 1.",
    )
    .check();
  await page.getByRole("button", { name: "Create design brief revision 1" }).click();

  await expect(
    page.getByRole("heading", { name: "Shape a brief that can stand up to scrutiny" }),
  ).toBeVisible();
  await expect(page.getByText("Backend-composed workspace")).toBeVisible();
  await expect(page.getByText("External providers disabled")).toBeVisible();
  await expect(page.getByTestId("design-consultation-workspace")).toHaveAttribute(
    "data-canonical-mutation-count",
    "0",
  );
  await page.getByRole("button", { name: "Start local consultation" }).click();
  await page
    .getByLabel("Household message or question")
    .fill("Prefer warm oak at the retained dining table; keep final placement unresolved.");
  await page.getByRole("button", { name: "Send for structured review" }).click();
  await expect(page.getByRole("heading", { name: "Inspect every suggested change" })).toBeVisible();
  await expect(page.getByText("External network", { exact: true })).toBeVisible();
  await expect(page.getByText("Not used", { exact: true })).toBeVisible();
  await page.getByLabel(/I reviewed the included changes/u).check();
  await page.getByRole("button", { name: "Confirm exact proposal" }).click();
  await expect(page.getByRole("status")).toContainText("Proposal confirmed");
  await page.getByLabel(/I reviewed this exact revision, including conflicts, unknowns/u).check();
  await page.getByRole("button", { name: /Accept revision/u }).click();
  await expect(page.getByRole("heading", { name: "Brief accepted" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("accepted with accountable attribution");

  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/producer-live-owner-accepted.png`,
  });
  await assertHealthy(page, health);
});

test("@viewer reads the accepted production-backed brief without mutation controls", async ({
  page,
}) => {
  const health = watch(page);
  await signIn(page, "Alpha viewer");
  const project = page.getByRole("article").filter({ hasText: projectName });
  await project.getByRole("link", { name: "Design consultation" }).click();
  await expect(page.getByText("Viewer access is read-only.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Brief accepted" })).toBeVisible();
  await expect(page.getByText("Backend-composed workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: /consultation|Accept revision/u })).toHaveCount(0);
  await assertHealthy(page, health);
});

test("@mobile preserves the production-backed viewer journey at 390x844", async ({ page }) => {
  const health = watch(page);
  await signIn(page, "Alpha viewer");
  const project = page.getByRole("article").filter({ hasText: projectName });
  await project.getByRole("link", { name: "Design consultation" }).click();
  await expect(page.getByText("Viewer access is read-only.")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/producer-live-viewer-mobile.png`,
  });
  await assertHealthy(page, health);
});

async function signIn(page: Page, persona: "Alpha homeowner" | "Alpha viewer"): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: new RegExp(persona, "u") }).check();
  await page.getByRole("button", { name: `Continue as ${persona}` }).click();
  await expect(page).toHaveURL(/\/projects$/u);
}

async function noOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

function watch(page: Page): PageHealth {
  const health: PageHealth = { consoleProblems: [], failedRequests: [], unexpectedOrigins: [] };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) health.consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => health.consoleProblems.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4340") {
      health.unexpectedOrigins.push(request.url());
    }
  });
  page.on("requestfailed", (request) => {
    if (request.method() === "GET" && request.failure()?.errorText === "net::ERR_ABORTED") return;
    health.failedRequests.push(`${request.method()} ${request.url()}`);
  });
  return health;
}

async function assertHealthy(page: Page, health: PageHealth): Promise<void> {
  expect(await noOverflow(page)).toBe(true);
  expect(health).toEqual({ consoleProblems: [], failedRequests: [], unexpectedOrigins: [] });
}
