import { expect, test, type Page } from "@playwright/test";

interface PageHealth {
  readonly consoleProblems: string[];
  readonly externalRequests: string[];
  readonly failedRequests: string[];
  readonly httpFailures: string[];
  readonly mockRequestPaths: string[];
}

test("@desktop creates and progresses a proposal without hiding authority", async ({ page }) => {
  const health = watch(page);
  await open(page, "full");
  await createJob(page);
  await expect(page.getByRole("heading", { name: "Registering source graph" })).toBeFocused();
  await page.getByRole("button", { name: "Advance synthetic job" }).click();
  await expect(page.getByRole("heading", { name: "Comparing source claims" })).toBeFocused();
  await page.getByRole("button", { name: "Advance synthetic job" }).click();
  await expect(page.getByRole("heading", { name: "Full-house proposal ready" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Baseline comparison" })).toBeVisible();
  await expect(page.getByText(/zero fused severe errors/iu)).toBeVisible();
  await expect(page.getByText(/Authority/iu)).toBeVisible();
  await expect(page.getByText("Proposal only")).toBeVisible();
  expect(health.mockRequestPaths).toEqual(
    expect.arrayContaining([
      "/mock-api/v1/projects/c9000000-0000-4000-8000-000000000107/fusion-jobs",
      expect.stringContaining("/mock-progress"),
    ]),
  );
  await assertHealthy(page, health);
});

test("@recovery cancel is terminal and retry creates a fenced replacement attempt", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "full");
  await createJob(page);
  await page.getByRole("button", { name: "Cancel attempt" }).click();
  await expect(page.getByRole("heading", { name: "Fusion cancelled" })).toBeFocused();
  await expect(page.getByText(/terminal for attempt 1/iu)).toBeVisible();
  await page.getByRole("button", { name: "Retry with replacement attempt" }).click();
  await expect(page.getByText(/Attempt 2 preserves source transforms/iu)).toBeVisible();
  await finishJob(page);
  await expect(page.getByRole("heading", { name: "Full-house proposal ready" })).toBeVisible();
  expect(health.mockRequestPaths.some((path) => path.endsWith("/cancel"))).toBe(true);
  expect(health.mockRequestPaths.some((path) => path.endsWith("/retry"))).toBe(true);
  await assertHealthy(page, health);
});

test("@states presents full, partial, disconnected and abstained outcomes honestly", async ({
  page,
}) => {
  const health = watch(page);
  for (const scenario of ["full", "partial", "disconnected", "abstained"] as const) {
    await open(page, scenario);
    await createJob(page);
    await finishJob(page);
    if (scenario === "full") {
      await expect(page.getByRole("heading", { name: "Full-house proposal ready" })).toBeVisible();
      await expect(page.getByText("Full-house proposal", { exact: true })).toBeVisible();
    } else if (scenario === "partial") {
      await expect(
        page.getByRole("heading", { name: "Partial full-house proposal" }),
      ).toBeVisible();
      await expect(page.getByText("Synthetic garage behind occlusion")).toBeVisible();
    } else if (scenario === "disconnected") {
      await expect(
        page.getByRole("heading", { name: "Disconnected partial proposal" }),
      ).toBeVisible();
      await expect(page.getByText("2 · disconnected")).toBeVisible();
      await expect(page.getByText(/not silently moved/iu)).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Fusion abstained" })).toBeVisible();
      await expect(page.getByText("DEGENERATE_ANCHORS", { exact: true })).toBeVisible();
      await expect(page.getByText(/no geometry was manufactured/iu)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Source claims and residual review" }),
      ).toBeHidden();
    }
  }
  await assertHealthy(page, health);
});

test("@review reviews claims/residuals, exercises every choice and emits an exact draft", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "full");
  await createJob(page);
  await finishJob(page);
  await expect(
    page.getByRole("heading", { name: "Source claims and residual review" }),
  ).toBeVisible();
  await expect(page.getByText("Living width 5,000 mm")).toBeVisible();
  await expect(page.getByText("Living width 5,075 mm")).toBeVisible();
  await expect(page.getByText("P90 18 mm")).toBeVisible();
  await chooseAllDecisions(page);
  await page.getByRole("button", { name: "Record five decisions" }).click();
  await expect(page.getByRole("heading", { name: "Five decisions recorded" })).toBeFocused();
  await page.getByRole("button", { name: "Create exact operation draft" }).click();
  await expect(page.getByRole("heading", { name: "Exact operation draft ready" })).toBeFocused();
  const draft = JSON.parse(await page.locator("#draft-output").innerText()) as Record<
    string,
    unknown
  >;
  expect(draft).toMatchObject({
    authority: "draft only — zero canonical mutation",
    branchId: "c9000000-0000-4000-8000-000000000102",
    expectedBranchRevision: 7,
    schemaVersion: "c9-operation-draft-v1",
  });
  expect(draft.expectedHeadSnapshotSha256).toBe("d".repeat(64));
  expect(draft.baseSnapshotSha256).toBe("a".repeat(64));
  expect(draft.decisions).toEqual([
    "accept-candidate",
    "keep-base",
    "correct",
    "mark-unknown",
    "defer",
  ]);
  await expect(page.getByRole("button", { name: /preview|commit|advance branch/iu })).toHaveCount(
    0,
  );
  expect(
    health.mockRequestPaths.some((path) => /model-operations|\/commit|\/preview/u.test(path)),
  ).toBe(false);
  await assertHealthy(page, health);
});

test("@stale blocks stale decisions until the current proposal is reloaded", async ({ page }) => {
  const health = watch(page);
  await open(page, "stale");
  await createJob(page);
  await finishJob(page);
  await chooseAllDecisions(page);
  await page.getByRole("button", { name: "Record five decisions" }).click();
  await expect(page.getByRole("heading", { name: "Proposal changed before review" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Stale proposal conflict" })).toBeVisible();
  await page.getByRole("button", { name: "Reload current proposal" }).click();
  await expect(page.getByRole("heading", { name: "Proposal version 2 loaded" })).toBeFocused();
  await page.getByRole("button", { name: "Record five decisions" }).click();
  await page.getByRole("button", { name: "Create exact operation draft" }).click();
  await expect(page.getByText(/Expected proposal version 1 is stale/iu)).toBeHidden();
  await expect(page.locator("#draft-output")).toContainText(
    '"schemaVersion": "c9-operation-draft-v1"',
  );
  await assertHealthy(page, health);
});

test("@resilience recovers from explicit offline and safe error states without fixture laundering", async ({
  page,
}) => {
  const health = watch(page);
  for (const scenario of ["offline", "error"] as const) {
    await open(page, scenario);
    await createJob(page);
    if (scenario === "offline") {
      await expect(
        page.getByRole("heading", { name: "Offline — fusion not submitted" }),
      ).toBeFocused();
      await expect(page.getByText(/No fixture success replaced/iu)).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Fusion failed safely" })).toBeFocused();
      await expect(page.getByText("FUSION_WORKER_UNAVAILABLE", { exact: false })).toBeVisible();
    }
    await page.getByRole("button", { name: "Retry with replacement attempt" }).click();
    await expect(page.getByText(/Attempt 2 preserves source transforms/iu)).toBeVisible();
    await finishJob(page);
    await expect(page.getByRole("heading", { name: "Full-house proposal ready" })).toBeVisible();
  }
  await assertHealthy(page, health);
});

test("@viewer viewer can inspect but cannot mutate", async ({ page }) => {
  const health = watch(page);
  await open(page, "disconnected", "viewer");
  await expect(page.getByText("Viewer read-only mode.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Disconnected partial proposal" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Source claims and residual review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /create|cancel|retry|record|draft/iu }),
  ).toHaveCount(0);
  await expect(page.locator("select[data-decision]")).toHaveCount(0);
  await assertHealthy(page, health);
});

test("@mobile stacks controls and contains wide claims without horizontal page overflow", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "partial");
  await createJob(page);
  await finishJob(page);
  expect(await hasNoOverflow(page)).toBe(true);
  const result = await page.getByRole("heading", { name: "Fusion result" }).boundingBox();
  const claims = await page
    .getByRole("heading", { name: "Source claims and residual review" })
    .boundingBox();
  expect(result).not.toBeNull();
  expect(claims).not.toBeNull();
  expect((claims?.y ?? 0) > (result?.y ?? 0)).toBe(true);
  await assertHealthy(page, health);
});

test("@keyboard completes create, progress, every decision and exact draft using keyboard input", async ({
  page,
}) => {
  const health = watch(page);
  await open(page, "full");
  await page.getByLabel("Synthetic plan proposal · exact hash").focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Synthetic RoomPlan proposal · exact hash").focus();
  await page.keyboard.press("Space");
  await page.getByLabel("Allow service processing for this fusion").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Create fusion job" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Advance synthetic job" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Advance synthetic job" }).focus();
  await page.keyboard.press("Enter");
  const decisions = [
    ["Decision for dimension conflict", "a", "accept-candidate"],
    ["Decision for topology conflict", "k", "keep-base"],
    ["Decision for classification conflict", "c", "correct"],
    ["Decision for occluded region", "m", "mark-unknown"],
    ["Decision for scale conflict", "d", "defer"],
  ] as const;
  for (const [label, key, value] of decisions) {
    const select = page.getByLabel(label);
    await select.focus();
    await page.keyboard.press(key);
    await expect(select).toHaveValue(value);
  }
  await page.getByRole("button", { name: "Record five decisions" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Create exact operation draft" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Exact operation draft ready" })).toBeFocused();
  await assertHealthy(page, health);
});

async function open(page: Page, scenario: string, persona = "owner"): Promise<void> {
  await page.goto(`/fusion?scenario=${scenario}&persona=${persona}`);
  await expect(page).toHaveTitle("C9 synthetic fusion acceptance");
  await expect(page.getByRole("note")).toContainText("Visibly synthetic");
  await expect(page.getByRole("note")).toContainText("No live C9 producer");
}

async function createJob(page: Page): Promise<void> {
  await page.getByLabel("Synthetic plan proposal · exact hash").check();
  await page.getByLabel("Synthetic RoomPlan proposal · exact hash").check();
  await page.getByLabel("Allow service processing for this fusion").check();
  await expect(page.getByLabel("Training use denied")).toBeChecked();
  await page.getByRole("button", { name: "Create fusion job" }).click();
}

async function finishJob(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Advance synthetic job" }).click();
  await page.getByRole("button", { name: "Advance synthetic job" }).click();
}

async function chooseAllDecisions(page: Page): Promise<void> {
  await page.getByLabel("Decision for dimension conflict").selectOption("accept-candidate");
  await page.getByLabel("Decision for topology conflict").selectOption("keep-base");
  await page.getByLabel("Decision for classification conflict").selectOption("correct");
  await page.getByLabel("Decision for occluded region").selectOption("mark-unknown");
  await page.getByLabel("Decision for scale conflict").selectOption("defer");
}

function watch(page: Page): PageHealth {
  const health: PageHealth = {
    consoleProblems: [],
    externalRequests: [],
    failedRequests: [],
    httpFailures: [],
    mockRequestPaths: [],
  };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) health.consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => health.consoleProblems.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4319") health.externalRequests.push(request.url());
    if (url.pathname.startsWith("/mock-api/")) health.mockRequestPaths.push(url.pathname);
  });
  page.on("requestfailed", (request) => health.failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400)
      health.httpFailures.push(`${String(response.status())}:${response.url()}`);
  });
  return health;
}

async function assertHealthy(page: Page, health: PageHealth): Promise<void> {
  expect(await hasNoOverflow(page)).toBe(true);
  expect(health.consoleProblems).toEqual([]);
  expect(health.externalRequests).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  expect(health.httpFailures).toEqual([]);
}

async function hasNoOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}
