import { expect, test, type Page } from "@playwright/test";

interface PageHealth {
  consoleProblems: string[];
  externalRequests: string[];
  failedRequests: string[];
}

test("@desktop completes with consent and keeps geometry separate from appearance", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "completed");
  await page.getByLabel("Ten generated room frames · public-domain fixture").check();
  await page.getByLabel("Allow service processing for this reconstruction").check();
  await expect(page.getByLabel("Training use denied")).toBeChecked();
  await page.getByRole("button", { name: "Start reconstruction" }).click();
  await expect(page.getByRole("heading", { name: "Reconstruction completed" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Geometry proposal" })).toBeVisible();
  await expect(page.getByText(/Proposal only · explicit scale/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Optional appearance" })).toBeVisible();
  await expect(page.getByText(/Non-dimensional Nerfstudio\/gsplat/u)).toBeVisible();
  await expect(page.getByRole("button", { name: /commit|confirm geometry/iu })).toHaveCount(0);
  await assertHealthy(page, health);
});

test("@states surfaces partial, disconnected, unknown-scale, error and offline states", async ({
  page,
}) => {
  const health = watch(page);
  for (const scenario of ["partial", "disconnected", "unknown-scale", "error", "offline"]) {
    await open(page, scenario);
    await page.getByLabel("Ten generated room frames · public-domain fixture").check();
    await page.getByLabel("Allow service processing for this reconstruction").check();
    await page.getByRole("button", { name: "Start reconstruction" }).click();
    if (scenario === "partial" || scenario === "disconnected") {
      await expect(page.getByRole("heading", { name: "Partial reconstruction" })).toBeVisible();
      await expect(page.getByText("2 · disconnected")).toBeVisible();
      await expect(page.getByText("DISCONNECTED_COMPONENTS")).toBeVisible();
    } else if (scenario === "unknown-scale") {
      await expect(
        page.getByRole("heading", { name: "Completed with unknown scale" }),
      ).toBeVisible();
      await expect(page.getByText("Unknown · arbitrary units")).toBeVisible();
    } else {
      await expect(
        page.getByRole("button", { name: "Retry with replacement attempt" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Retry with replacement attempt" }).click();
      await expect(page.getByRole("heading", { name: "Reconstruction completed" })).toBeFocused();
    }
  }
  await assertHealthy(page, health);
});

test("@viewer viewer remains read-only while inspecting completed diagnostics", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "unknown-scale", "viewer");
  await expect(page.getByText("Viewer read-only mode.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Completed with unknown scale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start reconstruction" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /cancel|retry/iu })).toHaveCount(0);
  await assertHealthy(page, health);
});

test("@mobile has no horizontal overflow and stacks result controls", async ({ page }) => {
  const health = watch(page);
  await open(page, "completed");
  await page.getByLabel("Ten generated room frames · public-domain fixture").check();
  await page.getByLabel("Allow service processing for this reconstruction").check();
  await page.getByRole("button", { name: "Start reconstruction" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const geometry = await page.getByRole("heading", { name: "Geometry proposal" }).boundingBox();
  const appearance = await page.getByRole("heading", { name: "Optional appearance" }).boundingBox();
  expect(geometry).not.toBeNull();
  expect(appearance).not.toBeNull();
  expect((appearance?.y ?? 0) > (geometry?.y ?? 0)).toBe(true);
  await assertHealthy(page, health);
});

test("@keyboard keyboard-only consent and start has an observable focus result", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "completed");
  await page.getByLabel("Ten generated room frames · public-domain fixture").focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Allow service processing for this reconstruction").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Start reconstruction" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Reconstruction completed" })).toBeFocused();
  await assertHealthy(page, health);
});

test("@recovery cancellation is terminal for the attempt and replacement is explicit", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "cancel");
  await page.getByLabel("Ten generated room frames · public-domain fixture").check();
  await page.getByLabel("Allow service processing for this reconstruction").check();
  await page.getByRole("button", { name: "Start reconstruction" }).click();
  await expect(page.getByText(/diagnostics are in progress/u)).toBeVisible();
  await page.getByRole("button", { name: "Cancel attempt" }).click();
  await expect(page.getByText(/Cancellation is terminal for attempt 1/u)).toBeVisible();
  await page.getByRole("button", { name: "Retry with replacement attempt" }).click();
  await expect(page.getByText(/Attempt 2 is fenced/u)).toBeVisible();
  await assertHealthy(page, health);
});

async function open(page: Page, scenario: string, persona = "owner"): Promise<void> {
  await page.goto(`/reconstruction?scenario=${scenario}&persona=${persona}`);
  await expect(page).toHaveTitle("C8 synthetic reconstruction acceptance");
  await expect(page.getByRole("note")).toContainText("Visibly synthetic");
  await expect(page.getByRole("note")).toContainText("No live API, worker, camera");
}

function watch(page: Page): PageHealth {
  const health: PageHealth = { consoleProblems: [], externalRequests: [], failedRequests: [] };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) health.consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => health.consoleProblems.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4318") {
      health.externalRequests.push(request.url());
    }
  });
  page.on("requestfailed", (request) => health.failedRequests.push(request.url()));
  return health;
}

async function assertHealthy(page: Page, health: PageHealth): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(health).toEqual({ consoleProblems: [], externalRequests: [], failedRequests: [] });
}
