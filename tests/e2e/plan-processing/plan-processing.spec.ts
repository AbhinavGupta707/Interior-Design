import { expect, test, type Page } from "@playwright/test";

interface PageHealth {
  readonly consoleProblems: string[];
  readonly externalRequests: string[];
  readonly failedRequests: string[];
  readonly unexpectedResponses: string[];
}

test("@desktop valid plan calibrates, corrects, excludes, previews and commits through C5", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "valid");
  await page.getByRole("button", { name: "Start plan processing" }).click();
  await expect(page.getByText(/Proposal ready/u)).toBeVisible();
  await page.getByRole("button", { name: "Toggle source" }).click();
  await expect(page.getByRole("button", { name: "Toggle source" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByLabel("Proposal opacity").fill("55");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await calibrate(page);
  await decide(page, "Wall 1 · 94%", "corrected");
  await decide(page, "Door 1 · 87%", "accepted");
  await decide(page, "Space 1 · 68%", "excluded");
  await reviewAndPreview(page);
  await expect(
    page.getByText(/Operations 2 · accepted 1 · corrected 1 · excluded 1 · unresolved 0/u),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit exact C5 preview" }).click();
  await expect(page.getByText(/C5 commit recorded at branch revision 8/u)).toBeVisible();
  await expect(page.getByText(/C5 commit succeeded at revision 8/u)).toBeFocused();
  await assertHealthy(page, health);
});

test("@mobile 390x844 stacks the structured inspector and commits without overflow", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "valid");
  expect(page.viewportSize()).toEqual({ height: 844, width: 390 });
  await page.getByRole("button", { name: "Start plan processing" }).click();
  await calibrate(page);
  await decide(page, "Wall 1 · 94%", "accepted");
  await decide(page, "Door 1 · 87%", "corrected");
  await decide(page, "Space 1 · 68%", "excluded");
  await reviewAndPreview(page);
  await page.getByRole("button", { name: "Commit exact C5 preview" }).click();
  const overlay = await page
    .getByRole("heading", { name: "Source and proposal overlay" })
    .boundingBox();
  const inspector = await page
    .getByRole("heading", { name: "Structured keyboard inspector" })
    .boundingBox();
  expect(overlay).not.toBeNull();
  expect(inspector).not.toBeNull();
  expect((inspector?.y ?? 0) > (overlay?.y ?? 0)).toBe(true);
  await assertHealthy(page, health);
});

test("@keyboard keyboard-only calibration, candidate review and commit has no canvas dependency", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "valid");
  await page.getByRole("button", { name: "Start plan processing" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Known length (mm)").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("5000");
  await page.getByRole("button", { name: "Confirm calibration evidence" }).focus();
  await page.keyboard.press("Enter");
  for (const [candidate, decision] of [
    ["Wall 1 · 94%", "accepted"],
    ["Door 1 · 87%", "corrected"],
    ["Space 1 · 68%", "excluded"],
  ] as const) {
    await page.getByRole("button", { name: candidate }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Candidate decision").selectOption(decision);
    await page.getByRole("button", { name: "Apply candidate decision" }).focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Build operation review" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("I acknowledge the synthetic-source limitation.").check();
  await page.getByRole("button", { name: "Send exact draft to C5 preview" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Commit exact C5 preview" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/C5 commit succeeded/u)).toBeFocused();
  await assertHealthy(page, health);
});

test("@viewer viewer can inspect source, overlay and candidates but has no mutation controls", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "valid");
  await page.getByRole("button", { name: "Start plan processing" }).click();
  await page.getByLabel("Plan workspace persona").selectOption("viewer");
  await expect(page.getByText("Viewer read-only mode.")).toBeFocused();
  await expect(
    page.getByRole("img", { name: "Safe derived synthetic plan overlay" }),
  ).toBeVisible();
  await expect(page.getByLabel("Plan candidates")).toBeVisible();
  await expect(page.locator("[data-mutation]:visible")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Commit exact C5 preview" })).toBeHidden();
  await assertHealthy(page, health);
});

test("@abstention low confidence exposes bounded next actions and manual fallback", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "abstention");
  await page.getByRole("button", { name: "Start plan processing" }).click();
  await expect(page.getByRole("alert")).toContainText("Proposal unavailable · low confidence");
  await expect(page.getByRole("link", { name: "Open the manual C5 editor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source and proposal overlay" })).toBeHidden();
  await assertHealthy(page, health);
});

test("@recovery cancellation remains terminal, replacement failure retries, and refresh preserves status", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "cancel-retry");
  await page.getByRole("button", { name: "Start plan processing" }).click();
  await expect(page.getByText(/Processing attempt 1 of 3/u)).toBeVisible();
  await page.getByRole("button", { name: "Cancel processing" }).click();
  await expect(page.getByText(/Cancelled. No proposal was published/u)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Cancelled. No proposal was published/u)).toBeVisible();
  await page.getByRole("button", { name: "Start replacement job" }).click();
  await expect(page.getByText(/PARSER_UNAVAILABLE/u)).toBeVisible();
  await page.getByRole("button", { name: "Retry failed job" }).click();
  await expect(page.getByText(/Retry attempt 2 of 3 produced one proposal/u)).toBeFocused();
  await expect(page.getByRole("heading", { name: "Source and proposal overlay" })).toBeVisible();
  await assertHealthy(page, health);
});

test("@conflict stale C5 head blocks commit, preserves corrections and requires repreview", async ({
  page,
}) => {
  const health = watchPage(page);
  await openWorkspace(page, "valid");
  await page.getByRole("button", { name: "Start plan processing" }).click();
  await calibrate(page);
  await decide(page, "Wall 1 · 94%", "corrected");
  await decide(page, "Door 1 · 87%", "accepted");
  await decide(page, "Space 1 · 68%", "excluded");
  await reviewAndPreview(page);
  await page.getByRole("button", { name: "Simulate second-session commit" }).click();
  await page.getByRole("button", { name: "Commit exact C5 preview" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Candidate decisions and exact integer corrections are preserved",
  );
  await page.getByRole("button", { name: "Reload head and reapply draft" }).click();
  await expect(page.getByText(/Draft reapplied to revision 8; preview again/u)).toBeFocused();
  await page.getByRole("button", { name: "Send exact draft to C5 preview" }).click();
  await page.getByRole("button", { name: "Commit exact C5 preview" }).click();
  await expect(page.getByText(/branch revision 9/u)).toBeVisible();
  await assertHealthy(page, health);
});

async function openWorkspace(page: Page, scenario: string): Promise<void> {
  await page.goto(`/workspace?scenario=${scenario}`);
  await expect(page).toHaveTitle("C6 reference plan correction harness");
  await expect(
    page.getByRole("heading", { level: 1, name: "Floor-plan proposal and correction" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("does not count as producer");
  await expect(page.getByText("training denied", { exact: false })).toBeVisible();
}

async function calibrate(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Confirm calibration evidence" }).click();
  await expect(page.getByText(/10 mm\/source unit · residual 12 mm/u)).toBeVisible();
}

async function decide(page: Page, candidate: string, decision: string): Promise<void> {
  await page.getByRole("button", { name: candidate }).click();
  await page.getByLabel("Candidate decision").selectOption(decision);
  await page.getByRole("button", { name: "Apply candidate decision" }).click();
}

async function reviewAndPreview(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Build operation review" }).click();
  await page.getByLabel("I acknowledge the synthetic-source limitation.").check();
  await page.getByRole("button", { name: "Send exact draft to C5 preview" }).click();
  await expect(page.getByText(/Exact typed C5 preview ready/u)).toBeFocused();
}

function watchPage(page: Page): PageHealth {
  const health: PageHealth = {
    consoleProblems: [],
    externalRequests: [],
    failedRequests: [],
    unexpectedResponses: [],
  };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      health.consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => health.consoleProblems.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4316") health.externalRequests.push(request.url());
  });
  page.on("requestfailed", (request) => health.failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      health.unexpectedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });
  return health;
}

async function assertHealthy(page: Page, health: PageHealth): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(health.consoleProblems).toEqual([]);
  expect(health.externalRequests).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  expect(health.unexpectedResponses).toEqual([]);
}
