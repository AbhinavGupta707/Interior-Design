import { expect, test, type Page } from "@playwright/test";

const projectId = "10000000-0000-4000-8000-000000000001";
const planSourceId = "ca000000-0000-4000-8000-000000000205";
const roomPlanSourceId = "90000000-0000-4000-8000-000000000001";

function observe(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/c9/")) {
      problems.push(`request failed: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith("/api/c9/")) {
      problems.push(`HTTP ${String(response.status())}: ${response.url()}`);
    }
  });
  return problems;
}

async function signIn(page: Page, persona: "Alpha homeowner" | "Alpha viewer") {
  await page.goto("/sign-in");
  await page.getByRole("radio", { name: new RegExp(`^${persona}`, "u") }).check();
  await page.getByRole("button", { name: `Continue as ${persona}` }).click();
  await expect(page).toHaveURL(/\/projects$/u);
  await page.goto(`/fusion/${projectId}`);
  await expect(page.getByRole("heading", { name: "Model fusion" })).toBeVisible();
}

async function fillIdentityAnchors(page: Page, sourceId: string) {
  const points = [
    { x: 0, y: 0 },
    { x: 1_000, y: 0 },
    { x: 0, y: 1_000 },
  ] as const;
  for (const [index, point] of points.entries()) {
    const values = {
      projectX: point.x,
      projectY: point.y,
      projectZ: 0,
      sourceX: point.x,
      sourceY: point.y,
      sourceZ: 0,
    } as const;
    for (const [field, value] of Object.entries(values)) {
      await page.getByTestId(`anchor-${sourceId}-${String(index)}-${field}`).fill(String(value));
    }
  }
}

test("@desktop real BFF, API and worker publish a reviewed 25 mm typed draft", async ({ page }) => {
  const problems = observe(page);
  await signIn(page, "Alpha homeowner");
  await expect(page.getByText("Geometry available", { exact: true })).toBeVisible();
  await expect(page.getByText("Semantic available", { exact: true })).toBeVisible();
  await expect(page.getByText("Exact existing-condition base", { exact: true })).toBeVisible();

  await page.getByLabel(/^Plan proposal/u).check();
  await page.getByLabel(/^RoomPlan proposal/u).check();
  await fillIdentityAnchors(page, planSourceId);
  await fillIdentityAnchors(page, roomPlanSourceId);
  await expect(page.getByText("Registration ready", { exact: true })).toBeVisible();
  await page.getByLabel(/I confirm service processing is permitted/u).check();
  await page.getByRole("button", { name: "Start proposal-only fusion" }).click();

  await expect(page.getByRole("heading", { name: /^(Full-house|Partial) proposal$/u })).toBeVisible(
    { timeout: 60_000 },
  );
  await expect(page.getByText("Measured difference: 25 mm", { exact: true })).toBeVisible();
  // The terminal poll and selected-job effect may each complete one immutable proposal read.
  // Let both reads settle before entering a local review draft.
  await page.waitForTimeout(3_000);
  const correction = page.locator(".discrepancy-card", {
    hasText: "Measured difference: 25 mm",
  });
  const correctChoice = correction.getByLabel("Correct", { exact: true });
  await correctChoice.check();
  await expect(correctChoice).toBeChecked();
  const decisionReason = correction.getByLabel("Decision reason");
  const reason = "Measured source alignment confirms 25 mm correction.";
  await decisionReason.fill(reason);
  await expect(decisionReason).toHaveValue(reason);
  const recordDecisions = page.getByRole("button", { name: "Record attributed decisions" });
  await expect(recordDecisions).toBeEnabled();
  await recordDecisions.click();
  await expect(page.getByText("0 pending", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Create operation draft" }).click();
  await expect(page.getByText("Draft ready · not committed", { exact: true })).toBeVisible();
  await expect(page.locator(".operation-draft")).toContainText("wall.translate.v1");
  await expect(page.locator(".operation-draft")).toContainText('"xMm": 25');
  await expect(page.getByRole("button", { name: /preview|commit|advance branch/iu })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.locator("body").innerText()).not.toMatch(
    /X-Amz-Signature|Bearer\s|file:\/\/|object[- ]?key/iu,
  );
  expect(problems).toEqual([]);
});

test("@mobile real viewer sees evidence read-only without horizontal overflow", async ({
  page,
}) => {
  const problems = observe(page);
  await signIn(page, "Alpha viewer");
  await expect(
    page.getByText("Viewer access is read-only. Source claims remain visible."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^(Full-house|Partial) proposal$/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Start proposal-only fusion|Record attributed decisions|Create operation draft|Cancel job|Retry exact request/iu,
    }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(problems).toEqual([]);
});
