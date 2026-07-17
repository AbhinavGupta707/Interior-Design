import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseUrl = "http://127.0.0.1:4315";
const screenshotDirectory = "/tmp/c5-editor-playwright-evidence";

interface PageHealth {
  readonly consoleProblems: string[];
  readonly failedRequests: string[];
  readonly unexpectedResponses: string[];
}

test.beforeEach(async ({ request }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const reset = await request.post(`${baseUrl}/__test/reset`);
  expect(reset.status()).toBe(204);
});

test("@desktop branch, edit, undo/redo, warning/error, commit, compare and restore journey", async ({
  page,
}, testInfo) => {
  const health = watchPage(page);
  await openEditor(page);
  await createBranch(page);

  await page.getByRole("button", { name: "Ground partition wall" }).click();
  await page.getByLabel("X translation (mm)").fill("50");
  await page.getByLabel("Y translation (mm)").fill("-25");
  await page.getByRole("button", { name: "Add wall move" }).click();
  await page.getByLabel("Offset along wall (mm)").fill("3500");
  await page.getByLabel("Opening width (mm)").fill("800");
  await page.getByRole("button", { name: "Add opening insertion" }).click();
  await page.getByLabel("Room name").fill("Living and dining room");
  await page.getByRole("button", { name: "Add room rename" }).click();
  await expect(page.getByText("Pending commands (3)")).toBeVisible();

  await page.getByRole("button", { name: "Undo pending command" }).click();
  await expect(page.getByText("Pending commands (2)")).toBeVisible();
  await page.getByRole("button", { name: "Redo pending command" }).click();
  await expect(page.getByText("Pending commands (3)")).toBeVisible();

  await page.getByLabel("Evaluation finding scenario").selectOption("warning");
  await page.getByRole("button", { name: "Preview pending commands" }).click();
  await expect(page.getByText(/ROOM_BOUNDARY_MISMATCH/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit exact preview" })).toBeDisabled();
  await page.getByLabel(/acknowledge the warning/u).check();
  await page.getByRole("button", { name: "Commit exact preview" }).click();
  await expect(page.getByText(/revision 1/u).first()).toBeVisible();
  await expect(page.getByText("Pending commands (0)")).toBeVisible();

  await page.getByLabel("Room name").fill("Unsafe preview name");
  await page.getByRole("button", { name: "Add room rename" }).click();
  await page.getByLabel("Evaluation finding scenario").selectOption("error");
  await page.getByRole("button", { name: "Preview pending commands" }).click();
  await expect(page.getByText(/WALL_PATH_SELF_INTERSECTION/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit exact preview" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard pending commands" }).click();

  await page.getByRole("button", { name: "Compare branch head" }).click();
  await expect(page.getByText(/Comparison · 1 modified/u)).toBeVisible();
  await page.getByRole("button", { name: "Restore source as new history" }).click();
  await expect(page.getByText(/snapshot\.restore\.v1/u)).toBeVisible();
  await expect(page.getByText(/revision 2/u).first()).toBeVisible();

  await assertSemanticsAndOverflow(page);
  expect(health.consoleProblems).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  expect(health.unexpectedResponses).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/${testInfo.project.name}-complete-journey.png`,
  });
});

test("@desktop viewer and two-session conflict recovery preserve intent", async ({ page }) => {
  const health = watchPage(page, [409]);
  await openEditor(page);
  await createBranch(page);

  await page.getByLabel("Room name").fill("Conflict-safe pending name");
  await page.getByRole("button", { name: "Add room rename" }).click();
  await page.getByRole("button", { name: "Preview pending commands" }).click();
  await page.getByRole("button", { name: "Simulate second-session commit" }).click();
  await expect(page.getByText(/remains pinned to revision 0/u)).toBeVisible();
  await page.getByRole("button", { name: "Commit exact preview" }).click();
  await expect(page.getByRole("alert")).toContainText("Branch revision conflict");
  await expect(page.getByRole("alert")).toContainText("pending typed intent is preserved");
  await expect(page.getByText("Pending commands (1)")).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByText(/Comparison · 1 modified/u)).toBeVisible();
  await page.getByRole("button", { name: "Reapply and repreview" }).click();
  await expect(page.getByText(/rebuilt and repreviewed on revision 1/u)).toBeVisible();
  await page.getByRole("button", { name: "Commit exact preview" }).click();
  await expect(page.getByText(/revision 2/u).first()).toBeVisible();

  await page.getByLabel("Editor persona").selectOption("viewer");
  await expect(page.getByText("Viewer · read only.")).toBeVisible();
  await expect(page.locator("#edit-region")).toBeHidden();
  await expect(page.getByRole("button", { name: "Commit exact preview" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Restore source as new history" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Compare branch head" })).toBeVisible();

  await assertSemanticsAndOverflow(page);
  expect(health.consoleProblems).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  expect(health.unexpectedResponses).toEqual([]);
});

test("@mobile 390x844 stacks the inspector and completes a safe opening and rename commit", async ({
  page,
}, testInfo) => {
  const health = watchPage(page);
  await openEditor(page);
  expect(page.viewportSize()).toEqual({ height: 844, width: 390 });
  await createBranch(page);
  await page.getByLabel("Opening width (mm)").fill("900");
  await page.getByRole("button", { name: "Add opening insertion" }).click();
  await page.getByLabel("Room name").fill("Mobile living room");
  await page.getByRole("button", { name: "Add room rename" }).click();
  await page.getByRole("button", { name: "Preview pending commands" }).click();
  await expect(page.getByText("No blocking findings.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Commit exact preview" }).click();
  await expect(page.getByText(/revision 1/u).first()).toBeVisible();

  const plan = await page
    .locator("section")
    .filter({ hasText: "Canonical SVG plan" })
    .boundingBox();
  const inspector = await page.locator("aside").boundingBox();
  expect(plan).not.toBeNull();
  expect(inspector).not.toBeNull();
  expect((inspector?.y ?? 0) > (plan?.y ?? 0)).toBe(true);
  await assertSemanticsAndOverflow(page);
  expect(health.consoleProblems).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  expect(health.unexpectedResponses).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/${testInfo.project.name}-mobile-commit.png`,
  });
});

test("@keyboard keyboard-only numeric wall/opening edits, rename, undo/redo and commit", async ({
  page,
}) => {
  const health = watchPage(page);
  await openEditor(page);
  await page.getByRole("button", { name: "Create branch" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/revision 0/u)).toBeVisible();

  await page.getByLabel("X translation (mm)").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("100");
  await page.getByRole("button", { name: "Add wall move" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Opening width (mm)").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("750");
  await page.getByRole("button", { name: "Add opening insertion" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Room name").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Keyboard living room");
  await page.getByRole("button", { name: "Add room rename" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Pending commands (3)")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByText("Pending commands (2)")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByText("Pending commands (3)")).toBeVisible();
  await page.getByRole("button", { name: "Preview pending commands" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Commit exact preview" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/revision 1/u).first()).toBeVisible();
  await expect(page.locator("#announcer")).toBeFocused();

  await assertSemanticsAndOverflow(page);
  expect(health.consoleProblems).toEqual([]);
  expect(health.failedRequests).toEqual([]);
  expect(health.unexpectedResponses).toEqual([]);
});

function watchPage(page: Page, allowedStatuses: readonly number[] = []): PageHealth {
  const health: PageHealth = { consoleProblems: [], failedRequests: [], unexpectedResponses: [] };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const expectedConflict =
        allowedStatuses.includes(409) && message.text().includes("409 (Conflict)");
      if (!expectedConflict) health.consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => health.consoleProblems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => health.failedRequests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400 && !allowedStatuses.includes(response.status())) {
      health.unexpectedResponses.push(`${String(response.status())} ${response.url()}`);
    }
  });
  return health;
}

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor");
  await expect(page).toHaveTitle("C5 reference editor acceptance harness");
  await expect(
    page.getByRole("heading", { level: 1, name: "2D model operation editor" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Mock evidence does not count");
  await expect(page.getByRole("img", { name: "Synthetic ground-level plan" })).toBeVisible();
}

async function createBranch(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Create branch" }).click();
  await expect(page.getByText(/Main design · revision 0/u)).toBeVisible();
}

async function assertSemanticsAndOverflow(page: Page): Promise<void> {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByLabel("Focusable model elements")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
