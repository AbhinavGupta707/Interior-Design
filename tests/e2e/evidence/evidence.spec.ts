import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const mockAPI = "http://127.0.0.1:4120";
const screenshotDirectory = "/tmp/c2-playwright-evidence";
const syntheticPlanPath = "/tmp/c2-playwright-evidence/synthetic-plan.pdf";

test.beforeEach(async ({ request }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  await writeFile(syntheticPlanPath, "%PDF-1.4\n% synthetic plan fixture\n", "utf8");
  await request.post(`${mockAPI}/__test/reset`);
});

test("rights-first upload pauses, survives reload, resumes with fresh signed state and becomes ready", async ({
  page,
}, testInfo) => {
  const consoleProblems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      consoleProblems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));

  await signInAndOpenEvidence(page);
  await expect(page.getByText("Local fixture · Synthetic files only")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Denied" })).toBeChecked();
  await page.getByLabel("Choose plan").setInputFiles(syntheticPlanPath);
  await page.getByLabel(/Allow service processing for this project/u).check();

  await page.route("**/__storage/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue().catch(() => undefined);
  });
  await page.getByRole("button", { name: "Hash and upload" }).click();
  await expect(page.getByText("Uploading immutable source")).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("heading", { name: "Upload ready to resume" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Upload ready to resume" })).toBeVisible();
  const storedRecovery = await page.evaluate(() =>
    Object.entries(localStorage)
      .map(([key, value]) => `${key}:${value}`)
      .join("\n"),
  );
  expect(storedRecovery).not.toMatch(/Bearer|X-Amz-Signature|__storage/u);

  await page.unroute("**/__storage/**");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();

  const accessResponse = page.waitForResponse((response) => response.url().includes("/access"));
  await page.getByRole("button", { name: "Open preview" }).click();
  expect((await accessResponse).status()).toBe(200);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/${testInfo.project.name}-ready.png`,
  });
  expect(consoleProblems).toEqual([]);
});

test("validates unsupported files before submission and handles offline inventory recovery", async ({
  page,
}) => {
  await signInAndOpenEvidence(page);
  await page.getByLabel("Choose plan").setInputFiles({
    buffer: Buffer.from("synthetic text"),
    mimeType: "text/plain",
    name: "notes.txt",
  });
  await expect(page.getByText(/This plan file type is not supported/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Hash and upload" })).toBeDisabled();

  await page.route("**/api/c2/projects/*/assets", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await page.unroute("**/api/c2/projects/*/assets");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Project evidence" })).toBeVisible();
});

test("shows safe pending, processing, ready, rejected, quarantined and aborted inventory language", async ({
  page,
  request,
}) => {
  await signInAndOpenEvidence(page);
  await request.post(`${mockAPI}/__test/seed-states`);
  await page.getByRole("button", { name: "Refresh status" }).click();

  for (const label of ["Pending", "Processing", "Ready", "Rejected", "Quarantined", "Aborted"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(/not an antivirus-clean claim/u)).toBeVisible();
  await expect(
    page.getByText(/not spatial understanding or professional verification/u),
  ).toBeVisible();
});

test("viewer can inspect ready inventory but cannot upload", async ({ page, request }) => {
  await request.post(`${mockAPI}/__test/seed-states`);
  await page.goto("/sign-in");
  await page.getByLabel(/Alpha viewer/u).check();
  await page.getByRole("button", { name: "Continue as Alpha viewer" }).click();
  await page.getByRole("link", { name: "Evidence" }).click();

  await expect(page.getByText("Viewer access", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hash and upload" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open preview" })).toBeVisible();
});

async function signInAndOpenEvidence(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue as Alpha homeowner" }).click();
  await expect(page).toHaveURL(/\/projects$/u);
  await page.getByRole("link", { name: "Evidence" }).click();
  await expect(page.getByRole("heading", { name: "Project evidence" })).toBeVisible();
}
