import { expect, test } from "@playwright/test";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { ids } from "../../../apps/web/test/materials-products/fixtures";

const backend = "http://127.0.0.1:4351";
const route = `/materials-products/${ids.project}?confirmationId=${ids.confirmation}`;
let applicationPrimed = false;

async function session(context: BrowserContext, value: string) {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "hds_c1_session",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value,
    },
  ]);
}

async function primeApplicationRoutes(request: APIRequestContext) {
  const headers = { cookie: "hds_c1_session=owner-token" };
  const responses = await Promise.all([
    request.get("/api/c1/session", { headers }),
    request.get(`/api/c1/projects/${ids.project}`, { headers }),
    request.get(`/api/c13/projects/${ids.project}/catalog/releases`, { headers }),
    request.get(`/api/c13/projects/${ids.project}/specifications`, { headers }),
  ]);

  for (const response of responses) await expect(response).toBeOK();
}

test.beforeEach(async ({ context, request }) => {
  await request.get(`${backend}/__scenario?value=ready`);
  if (!applicationPrimed) {
    await primeApplicationRoutes(request);
    applicationPrimed = true;
  }
  await session(context, "owner-token");
});

async function confirmSofaCandidate(page: Page) {
  const sofa = page.locator("li").filter({ hasText: "Generic compact sofa" });
  await sofa.getByRole("button", { name: /^Use Generic compact sofa version/iu }).click();
  await page.getByRole("button", { name: "Prepare bounded preview" }).click();
  await expect(page.getByText("Bounded catalog preview prepared", { exact: true })).toBeVisible();
  await page
    .getByLabel(/I understand confirmation creates an immutable specification revision/iu)
    .check();
  await page.getByRole("button", { name: "Confirm exact substitution" }).click();
}

test("@workflow @keyboard owner edits the board, previews safely, and opens the exact scene job", async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(route);
  await expect(
    page.getByRole("heading", { level: 1, name: "Specify what belongs in each room" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic fixture presentation")).toBeVisible();
  const firstLine = page.getByRole("button", { name: /01 furnishing/iu });
  await firstLine.focus();
  await page.keyboard.press("Enter");
  const note = page.getByLabel("Decision note");
  await note.fill("Keep near the west window.");
  await page.getByRole("button", { name: "Shortlist" }).click();
  await expect(page.getByText(/Immutable revision 2 created/iu)).toBeAttached();

  await confirmSofaCandidate(page);
  await expect(page.getByText(/not canonical and not C10 scene evidence/iu)).toBeVisible();
  const sceneLink = page.getByRole("link", {
    name: new RegExp(`Open exact C10 scene job ${ids.sceneJob}`),
  });
  await expect(sceneLink).toHaveAttribute("href", `/viewer/${ids.project}?jobId=${ids.sceneJob}`);
  const state = await request.get(`${backend}/__state`);
  await expect(state).toBeOK();
  await expect(state.json()).resolves.toMatchObject({
    asBuiltProfileMutations: 0,
    boardUpdates: 1,
    confirmations: 1,
    existingProfileMutations: 0,
    previewRequests: 1,
  });
  const persisted = await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(persisted)).not.toMatch(
    /Keep near|rights|schedule|preview|artifact|description|PRIVATE/iu,
  );
  expect(await page.locator("[draggable=true]").count()).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test("@scene-retry committed model with retry-required dispatch creates only the exact scene job", async ({
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=retry-required`);
  await page.goto(route);
  await confirmSofaCandidate(page);
  await expect(page.getByText(/Model committed · exact scene unavailable/iu)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open exact C10 scene job/iu })).toHaveCount(0);

  await page.getByRole("button", { name: "Retry exact scene" }).click();
  const sceneLink = page.getByRole("link", {
    name: new RegExp(`Open exact C10 scene job ${ids.sceneJob}`),
  });
  await expect(sceneLink).toHaveAttribute("href", `/viewer/${ids.project}?jobId=${ids.sceneJob}`);
  const state = await request.get(`${backend}/__state`);
  await expect(state.json()).resolves.toMatchObject({
    confirmations: 1,
    sceneJobRetries: 1,
  });
});

test("@scene-retry retry failure preserves the committed model and viewer remains read-only", async ({
  context,
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=retry-failure`);
  await page.goto(route);
  await confirmSofaCandidate(page);
  await page.getByRole("button", { name: "Retry exact scene" }).click();
  await expect(
    page.getByText(
      /exact C5 result remains committed, but exact C10 scene creation is still unavailable/iu,
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Open exact C10 scene job/iu })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry exact scene" })).toBeEnabled();

  await session(context, "viewer-token");
  await page.getByRole("button", { name: "Refresh all pins" }).click();
  await expect(page.getByText("viewer · inspect-only", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry exact scene" })).toBeDisabled();
  const state = await request.get(`${backend}/__state`);
  await expect(state.json()).resolves.toMatchObject({
    confirmations: 1,
    sceneJobRetries: 0,
  });
});

test("@cross-browser catalog and four schedule projections expose honest rights and quantity semantics", async ({
  page,
}) => {
  await page.goto(route);
  await expect(page.getByText("Creator-owned generic asset").first()).toBeVisible();
  await expect(page.getByText("Locally licensed asset")).toBeVisible();
  await expect(page.getByText(/Placement remains a bounded proxy/iu).first()).toBeVisible();
  await expect(page.getByText(/Price not provided/iu).first()).toBeVisible();
  await expect(page.getByText(/Rights withdrawn/iu)).toBeVisible();
  await expect(page.getByText(/Missing model · missing thumbnail/iu)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(4);
  await expect(page.getByText("Unknown — not derived in C13").first()).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2")).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.getByText("Page 1")).toBeVisible();
});

test("@status viewer is inspect-only and cannot edit, select a candidate, preview, or confirm", async ({
  context,
  page,
}) => {
  await session(context, "viewer-token");
  await page.goto(route);
  await expect(page.getByText("Viewer access is inspect-only.").first()).toBeVisible();
  await expect(page.getByLabel("Decision note")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Shortlist" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /^Inspect-only .+ version/iu }).first(),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Prepare bounded preview" })).toBeDisabled();

  await session(context, "editor-token");
  await page.reload();
  await expect(page.getByText(/editor · can edit/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "Shortlist" })).toBeEnabled();
});

test("@security foreign tenant fails before specification disclosure", async ({
  context,
  page,
}) => {
  await session(context, "foreign-token");
  await page.goto(route);
  await expect(page.getByText("Pinned state stayed safe")).toBeVisible();
  await expect(page.getByText("Synthetic room specification")).toHaveCount(0);
  await expect(page.getByText(ids.specification)).toHaveCount(0);
});

test("@status stale rights, malformed missing artifacts, expiry, and service failure recover safely", async ({
  context,
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=stale-preview`);
  await page.goto(route);
  const sofa = page.locator("li").filter({ hasText: "Generic compact sofa" });
  await sofa.getByRole("button", { name: /^Use Generic compact sofa version/iu }).click();
  await page.getByRole("button", { name: "Prepare bounded preview" }).click();
  await expect(page.getByText(/catalog, rights record, or preview became stale/iu)).toBeVisible();

  await request.get(`${backend}/__scenario?value=missing-artifacts`);
  await page.reload();
  await expect(page.getByText(/Missing model · missing thumbnail/iu)).toBeVisible();
  await expect(page.getByText("Action not completed")).toBeVisible();
  await expect(page.getByText(/mismatched or malformed frozen-contract data/iu)).toBeVisible();

  await request.get(`${backend}/__scenario?value=service-error`);
  await page.reload();
  await expect(page.getByText("Pinned state stayed safe")).toBeVisible();
  await expect(page.getByText(/PRIVATE_RIGHTS_AND_TOKEN/iu)).toHaveCount(0);

  await request.get(`${backend}/__scenario?value=expired`);
  await page.reload();
  await expect(page.getByText("Session expired", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  await session(context, "owner-token");
});

test("@status offline and interrupted preview preserve inspectable state without mutation", async ({
  context,
  page,
  request,
}) => {
  await page.goto(route);
  await expect(page.getByRole("button", { name: "Shortlist" })).toBeEnabled();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Offline inspection mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Shortlist" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Prepare bounded preview" })).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Connection restored/iu)).toBeAttached();
  const state = await request.get(`${backend}/__state`);
  await expect(state.json()).resolves.toMatchObject({
    boardUpdates: 0,
    confirmations: 0,
    previewRequests: 0,
  });

  await request.get(`${backend}/__scenario?value=slow-preview`);
  await page.reload();
  const sofa = page.locator("li").filter({ hasText: "Generic compact sofa" });
  await sofa.getByRole("button", { name: /^Use Generic compact sofa version/iu }).click();
  await page.getByRole("button", { name: "Prepare bounded preview" }).click();
  await page.getByRole("button", { name: "Stop preview setup" }).click();
  await expect(page.getByText(/Preview preparation was interrupted/iu)).toBeVisible();
});

test("@mobile 390×844 layout has no page overflow and keeps table overflow local", async ({
  page,
}) => {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const tableScroller = page.getByRole("table").first().locator("..");
  await expect(tableScroller).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("button", { name: /01 furnishing/iu })).toBeVisible();
});
