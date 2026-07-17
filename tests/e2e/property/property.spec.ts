import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const mockAPI = "http://127.0.0.1:4130";
const projectId = "33333333-3333-4333-8333-333333333333";
const screenshotDirectory = "/tmp/c3-playwright-evidence";

interface PageHealth {
  consoleProblems: string[];
  failedRequests: string[];
}

test.beforeEach(async ({ request }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  await request.post(`${mockAPI}/__test/reset`);
});

test("owner selects an exact fixture and inspects all five labels, boundaries and source rights", async ({
  page,
}, testInfo) => {
  const health = watchPage(page);
  await signInAndOpenProperty(page, "homeowner");

  await expect(page.getByRole("heading", { name: "Property and home dossier" })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "Live address" })).toBeVisible();
  await page.getByLabel("Synthetic address search").fill("Example Mews");
  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("One exact synthetic result")).toBeVisible();
  await expect(page.getByText("UPRN 000000000014")).toBeVisible();
  await expect(page.getByText(/not a boundary or interior/u)).toBeVisible();
  await page.getByRole("button", { name: "Use this property" }).click();

  await expect(
    page.getByRole("heading", { name: "Unknown until supported by explicit evidence" }),
  ).toBeVisible();
  await expect(page.getByText("Not reviewed · no clearance or approval claim")).toBeVisible();
  for (const label of [
    "Source observation",
    "User assertion",
    "Estimate",
    "Inference",
    "Unknown",
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("70% confidence")).toBeVisible();
  await expect(page.getByText("62% confidence")).toBeVisible();
  await expect(page.getByText(/confidence/u)).toHaveCount(2);
  await expect(page.getByText("No interior claim").first()).toBeVisible();
  await expect(
    page.getByText("No-result planning or context data", { exact: false }),
  ).toBeVisible();

  const source = page
    .locator("details")
    .filter({ hasText: "C3 synthetic property catalogue" })
    .first();
  await source.locator("summary").click();
  await expect(source.getByText("Repository synthetic test data")).toBeVisible();
  await expect(source.getByText("Allowed", { exact: true }).first()).toBeVisible();
  await expect(source.getByText("Denied", { exact: true })).toBeVisible();
  await expect(source.getByText("fixture complete", { exact: true })).toBeVisible();
  await expect(
    source.locator("dd").filter({ hasText: "C3 synthetic property catalogue / c3-fixture-1" }),
  ).toBeVisible();

  await assertSemanticsAndOverflow(page);
  expect(unexpectedConsoleProblems(health)).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/${testInfo.project.name}-exact-dossier.png`,
  });
});

test("ambiguity requires keyboard choice and an expired resolution cannot be selected", async ({
  page,
  request,
}) => {
  const health = watchPage(page);
  await signInAndOpenProperty(page, "homeowner");
  await page.getByLabel("Synthetic address search").fill("Shared point");
  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("Choose one of the matching identities")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Choose this property" })).toBeDisabled();

  await page.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio").first()).toBeChecked();
  await request.post(`${mockAPI}/__test/expire-resolutions`);
  await page.getByRole("button", { name: "Choose this property" }).click();
  await expect(page.getByText("Search results expired")).toBeVisible();
  await expect(page.getByText(/expired after 15 minutes/u)).toBeVisible();

  await page.getByRole("button", { name: "Search fixtures" }).click();
  const radios = page.getByRole("radio");
  await radios.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(1)).toBeChecked();
  await page.getByRole("button", { name: "Choose this property" }).click();
  await expect(
    page.getByRole("heading", { name: "2B Shared Point Court, Testford, ZZ2 2ZZ" }),
  ).toBeVisible();

  await assertSemanticsAndOverflow(page);
  expect(unexpectedConsoleProblems(health, ["409 (Conflict)"])).toEqual([]);
  expect(health.failedRequests).toEqual([]);
});

test("no-match keeps the gap visible and manual fallback invents no identifier or point", async ({
  page,
}) => {
  const health = watchPage(page);
  await signInAndOpenProperty(page, "homeowner");
  await page.getByLabel("Synthetic address search").fill("Missing fixture");
  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("No synthetic match")).toBeVisible();
  await expect(page.getByText("No identity was selected")).toBeVisible();

  await page.getByRole("button", { name: "Enter manually" }).click();
  await expect(
    page.getByText("Do not enter a real address, customer data or provider output."),
  ).toBeVisible();
  await page.getByLabel("Address line 1").fill("9 Manual Fixture Row");
  await page.getByLabel("Locality optional").fill("Synthetic Borough");
  await page.getByRole("button", { name: "Save manual identity" }).click();
  await expect(page.locator(".success-note")).toContainText(
    /saved without an invented UPRN or coordinate/u,
  );
  await expect(
    page.getByRole("heading", { name: "9 Manual Fixture Row, Synthetic Borough" }),
  ).toBeVisible();
  await expect(page.getByText("Not supplied", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Manual property identity", { exact: true }).first()).toBeVisible();

  await assertSemanticsAndOverflow(page);
  expect(unexpectedConsoleProblems(health)).toEqual([]);
  expect(health.failedRequests).toEqual([]);
});

test("disabled, outage and offline searches remain distinct and recover without invented success", async ({
  page,
}) => {
  const health = watchPage(page);
  await signInAndOpenProperty(page, "homeowner");
  const search = page.getByLabel("Synthetic address search");

  await search.fill("Disabled provider");
  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("Property provider disabled")).toBeVisible();
  await expect(page.getByText("No live or fixture result was substituted.")).toBeVisible();

  await search.fill("Outage fixture");
  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("Property search temporarily unavailable")).toBeVisible();
  await expect(page.getByText("The deterministic adapter reported an outage.")).toBeVisible();

  await page.route("**/api/c3/projects/*/property/resolutions", (route) =>
    route.abort("internetdisconnected"),
  );
  await search.fill("Example Mews");
  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("You’re offline")).toBeVisible();
  await expect(page.getByText("No live or fixture result was substituted.")).toHaveCount(0);
  await page.unroute("**/api/c3/projects/*/property/resolutions");

  await page.getByRole("button", { name: "Search fixtures" }).click();
  await expect(page.getByText("One exact synthetic result")).toBeVisible();
  await assertSemanticsAndOverflow(page);
  expect(unexpectedConsoleProblems(health, ["ERR_INTERNET_DISCONNECTED"])).toEqual([]);
  expect(health.failedRequests).toHaveLength(1);
  expect(health.failedRequests[0]).toContain("/property/resolutions");
});

test("refresh conflict preserves the current dossier and reloads before retry", async ({
  page,
  request,
}) => {
  const health = watchPage(page);
  await request.post(`${mockAPI}/__test/seed-selected`);
  await signInAndOpenProperty(page, "homeowner");
  await expect(page.getByText("Dossier version").locator("..")).toContainText("1");

  await request.post(`${mockAPI}/__test/bump-dossier`);
  await page.getByRole("button", { name: "Refresh dossier" }).click();
  await expect(page.getByText("A newer dossier version exists.")).toBeVisible();
  await expect(page.getByText("Your refresh was not applied.")).toBeVisible();
  await page.getByRole("button", { name: "Reload current dossier" }).click();
  await expect(page.getByText("Dossier version").locator("..")).toContainText("2");
  await page.getByRole("button", { name: "Refresh dossier" }).click();
  await expect(page.locator(".success-note")).toHaveText("Dossier refreshed to version 3.");

  await assertSemanticsAndOverflow(page);
  expect(unexpectedConsoleProblems(health, ["409 (Conflict)"])).toEqual([]);
  expect(health.failedRequests).toEqual([]);
});

test("viewer is read only and unknown project IDs remain non-disclosing", async ({
  page,
  request,
}) => {
  const health = watchPage(page);
  await request.post(`${mockAPI}/__test/seed-selected`);
  await signInAndOpenProperty(page, "viewer");
  await expect(page.getByText("Viewer access", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search fixtures" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh dossier" })).toHaveCount(0);
  await expect(page.getByText("Viewer · read only")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Inspect provenance and permissions" }),
  ).toBeVisible();

  await page.goto("/property/99999999-9999-4999-8999-999999999999");
  await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();
  await expect(page.getByText(/not disclosed/u)).toBeVisible();
  await assertSemanticsAndOverflow(page);
  expect(unexpectedConsoleProblems(health, ["404 (Not Found)"])).toEqual([]);
  expect(health.failedRequests).toEqual([]);
});

function watchPage(page: import("@playwright/test").Page): PageHealth {
  const health: PageHealth = { consoleProblems: [], failedRequests: [] };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      health.consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => health.consoleProblems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => health.failedRequests.push(request.url()));
  return health;
}

async function signInAndOpenProperty(
  page: import("@playwright/test").Page,
  persona: "homeowner" | "viewer",
) {
  await page.goto("/sign-in");
  if (persona === "viewer") await page.getByLabel(/Alpha viewer/u).check();
  await page.getByRole("button", { name: `Continue as Alpha ${persona}` }).click();
  await expect(page).toHaveURL(/\/projects$/u);
  await page.getByRole("link", { name: "Property dossier" }).click();
  await expect(page.getByRole("heading", { name: "Property and home dossier" })).toBeVisible();
}

function unexpectedConsoleProblems(health: PageHealth, allowedFragments: string[] = []) {
  return health.consoleProblems.filter(
    (problem) => !allowedFragments.some((fragment) => problem.includes(fragment)),
  );
}

async function assertSemanticsAndOverflow(page: import("@playwright/test").Page) {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
