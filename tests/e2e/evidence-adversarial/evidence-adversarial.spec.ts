import { expect, test } from "@playwright/test";

import { createAdversarialFixture } from "../../fixtures/c2/adversarial/factory.js";

const requiredEnvironment = [
  "C2_ADVERSARIAL_WEB_URL",
  "C2_ADVERSARIAL_EVIDENCE_PATH",
  "C2_ADVERSARIAL_OWNER_STORAGE_STATE",
  "C2_ADVERSARIAL_VIEWER_STORAGE_STATE",
  "C2_ADVERSARIAL_READY_ASSET_NAME",
] as const;
const missing = requiredEnvironment.filter((name) => (process.env[name] ?? "").length === 0);
test.skip(missing.length > 0, `Missing live C2 E2E environment: ${missing.join(", ")}`);

const evidencePath = process.env.C2_ADVERSARIAL_EVIDENCE_PATH ?? "/evidence";
const readyAssetName = process.env.C2_ADVERSARIAL_READY_ASSET_NAME ?? "synthetic-ready.png";
const ownerStorageState = process.env.C2_ADVERSARIAL_OWNER_STORAGE_STATE ?? "";
const viewerStorageState = process.env.C2_ADVERSARIAL_VIEWER_STORAGE_STATE ?? "";

test("keeps rights consent ahead of upload and renders a hostile filename as inert text", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();
  await page.goto(evidencePath);
  await expect(
    page.getByRole("heading", { name: /evidence|plans.*photos.*documents/iu }),
  ).toBeVisible();

  const consent = page
    .getByRole("checkbox", { name: /right|permission|service processing/iu })
    .first();
  const upload = page.getByRole("button", { name: /upload|start transfer/iu }).first();
  await expect(consent).not.toBeChecked();
  await expect(upload).toBeDisabled();

  const hostileName = "--output=$(synthetic-never-run);plan.png";
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      buffer: createAdversarialFixture("shell-metacharacter-name"),
      mimeType: "image/png",
      name: hostileName,
    });
  await expect(page.getByText(hostileName, { exact: true })).toBeVisible();
  expect(await page.locator('[data-synthetic="must-not-execute"]').count()).toBe(0);
  await consent.check();
  await expect(upload).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await context.close();
});

test("gives a viewer inventory/preview visibility without any enabled write or original control", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: viewerStorageState });
  const page = await context.newPage();
  await page.goto(evidencePath);
  await expect(page.getByText(readyAssetName, { exact: true })).toBeVisible();

  const writeControls = page.getByRole("button", {
    name: /abort|cancel upload|complete upload|delete|download original|new upload|upload/iu,
  });
  for (let index = 0; index < (await writeControls.count()); index += 1) {
    await expect(writeControls.nth(index)).toBeDisabled();
  }
  await expect(page.getByText(/ready/iu).first()).toBeVisible();
  await context.close();
});

test("never embeds raw SVG/XML or original active content in the evidence viewer", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();
  await page.goto(evidencePath);
  await expect(page.getByText(readyAssetName, { exact: true })).toBeVisible();
  expect(await page.locator("object, embed, iframe[srcdoc]").count()).toBe(0);
  const imageSources = await page
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
  expect(imageSources.some((source) => source.startsWith("data:image/svg+xml"))).toBe(false);
  const markup = await page.locator("main").innerHTML();
  expect(markup).not.toContain("media-fetch.invalid");
  expect(markup).not.toContain("file:///synthetic/nonexistent");
  expect(markup).not.toContain("must-not-execute");
  await context.close();
});
