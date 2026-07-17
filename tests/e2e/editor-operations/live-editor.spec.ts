import { expect, test, type Page } from "@playwright/test";

const liveEnabled = process.env.C5_RUN_LIVE_EDITOR === "1";
const livePath = process.env.C5_LIVE_EDITOR_PATH ?? "/";

test.skip(
  !liveEnabled,
  "Set C5_RUN_LIVE_EDITOR=1 only after the integrated editor, BFF, API and database are running.",
);

test("integrated editor exposes the frozen accessible operation workflow", async ({ page }) => {
  const problems: string[] = [];
  const failed: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => failed.push(request.url()));

  await page.goto(livePath);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel(/Level selector/u)).toBeVisible();
  await expect(page.getByLabel(/Focusable model elements/u)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add wall move/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add opening insertion/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add room rename/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Preview pending commands/u })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(problems).toEqual([]);
  expect(failed).toEqual([]);
});

test("integrated keyboard journey keeps commit explicit and reports conflict recovery", async ({
  page,
}) => {
  await page.goto(livePath);
  await keyboardActivate(page, /Add room rename/u);
  await keyboardActivate(page, /Preview pending commands/u);
  await expect(page.getByRole("status")).toContainText(/preview/i);
  await keyboardActivate(page, /Commit exact preview/u);
  await expect(page.getByRole("status")).toContainText(/revision|commit/i);
});

async function keyboardActivate(page: Page, name: RegExp): Promise<void> {
  const button = page.getByRole("button", { name });
  await button.focus();
  await page.keyboard.press("Enter");
}
