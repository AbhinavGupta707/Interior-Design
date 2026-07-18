import { expect, test } from "@playwright/test";

import { ids } from "../../../apps/web/test/design-options/fixtures";

const backend = "http://127.0.0.1:4341";
const route = `/design-options/${ids.project}`;

test.beforeEach(async ({ context, request }) => {
  await request.get(`${backend}/__scenario?value=ready`);
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "hds_c1_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "owner-token",
    },
  ]);
});

test("@workflow @keyboard owner compares real differences and confirms one isolated branch", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(route);
  await expect(
    page.getByRole("heading", { level: 1, name: "Compare what actually changes" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic fixture presentation")).toBeVisible();
  await expect(page.getByText("Asset inventory: different")).toBeVisible();
  await expect(page.getByText("wool and walnut")).toBeVisible();
  const acknowledgement = page.getByLabel(/I reviewed this option’s exact pins/iu).first();
  await acknowledgement.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Confirm this option" }).first().click();
  await expect(page.getByText("Confirmed into an isolated proposed branch")).toBeVisible();
  await expect(page.getByText(ids.branchA, { exact: true })).toBeVisible();
  const state = await request.get(`${backend}/__state`);
  await expect(state).toBeOK();
  await expect(state.json()).resolves.toMatchObject({
    asBuiltProfileMutations: 0,
    confirmations: 1,
    existingProfileMutations: 0,
  });
  expect(consoleErrors).toEqual([]);
});

test("@cross-browser comparison remains canvas-independent and exposes exact scope", async ({
  page,
}) => {
  await page.goto(route);
  await expect(
    page.getByText("Computationally valid within the frozen scope").first(),
  ).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.getByText(/not structural, regulatory/iu).first()).toBeVisible();
});

test("@status viewer, stale confirmation, abstention, and safe recovery remain explicit", async ({
  context,
  page,
  request,
}) => {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "hds_c1_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "viewer-token",
    },
  ]);
  await page.goto(route);
  await expect(page.getByText("Viewer access is read-only.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm this option" }).first()).toBeDisabled();

  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "hds_c1_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: "owner-token",
    },
  ]);
  await request.get(`${backend}/__scenario?value=stale-confirm`);
  await page.reload();
  await page
    .getByLabel(/I reviewed this option’s exact pins/iu)
    .first()
    .check();
  await page.getByRole("button", { name: "Confirm this option" }).first().click();
  await expect(page.getByText(/source model, job, option, or branch changed/iu)).toBeVisible();

  await request.get(`${backend}/__scenario?value=abstained`);
  await page.reload();
  await expect(page.getByText("The engine abstained")).toBeVisible();
  await expect(page.getByText(/No partial option set or proposed branch/iu)).toBeVisible();
});

test("@mobile 390px layout has no page-level horizontal overflow", async ({ page }) => {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByLabel("Option A")).toBeVisible();
  await expect(page.getByLabel("Option B")).toBeVisible();
});

test("@status empty, offline-safe, cancel, and retry states are recoverable", async ({
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=empty`);
  await page.goto(route);
  await expect(page.getByText("No option jobs yet")).toBeVisible();

  await request.get(`${backend}/__scenario?value=service-error`);
  await page.reload();
  await expect(page.getByText("Pinned state stayed safe")).toBeVisible();

  await request.get(`${backend}/__scenario?value=running`);
  await page.reload();
  await page.getByRole("button", { name: "Cancel safely" }).click();
  await expect(page.getByText("Generation cancelled")).toBeVisible();
  await page.getByRole("button", { name: "Retry from exact pins" }).click();
  await expect(page.getByText("Generating bounded candidates").first()).toBeVisible();
});
