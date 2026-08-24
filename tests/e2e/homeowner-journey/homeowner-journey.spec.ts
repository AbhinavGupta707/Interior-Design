import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { c10DefaultCompileConfiguration } from "../../../packages/contracts/src/index";
import { mkdir } from "node:fs/promises";

import {
  branch,
  decision,
  draft,
  job,
  project,
  proposal,
  snapshotRecord,
} from "../../../apps/web/test/model-fusion/fixtures";

const mockAPI = "http://127.0.0.1:4336";
const createdProjectId = "e1400000-0000-4000-8000-000000000001";
const committedSnapshotId = "e1400000-0000-4000-8000-000000000002";
const committedSnapshotSha256 = "e".repeat(64);
const evidenceDirectory = "/tmp/c14-1-homeowner-journey-evidence";

type Scenario =
  | "commit-conflict"
  | "commit-expired"
  | "commit-forbidden"
  | "commit-unavailable"
  | "current-unavailable"
  | "normal"
  | "preview-blocked"
  | "preview-expired"
  | "preview-forbidden"
  | "preview-unavailable";

interface MutationLog {
  readonly c5Commit: Array<{ readonly body: unknown; readonly persona: string }>;
  readonly c5Preview: Array<{ readonly body: unknown; readonly persona: string }>;
  readonly c9Draft: Array<{ readonly body: unknown; readonly persona: string }>;
  readonly c9Review: Array<{ readonly body: unknown; readonly persona: string }>;
  readonly c10Create: Array<{ readonly body: unknown; readonly persona: string }>;
}

interface FixtureState {
  readonly accepted: MutationLog;
  readonly attempts: MutationLog;
  readonly currentBranchRevision: number;
  readonly currentSnapshotId: string;
  readonly currentSnapshotSha256: string;
  readonly scenario: Scenario;
}

test.beforeEach(async ({ request }) => {
  await request.post(`${mockAPI}/__test/reset`);
});

async function fixtureState(request: APIRequestContext): Promise<FixtureState> {
  const response = await request.get(`${mockAPI}/__test/state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FixtureState>;
}

async function setScenario(request: APIRequestContext, value: Scenario): Promise<void> {
  const response = await request.post(`${mockAPI}/__test/scenario`, { data: { value } });
  expect(response.ok()).toBe(true);
}

async function signIn(
  page: Page,
  persona: "editor-alpha" | "homeowner-alpha" | "viewer-alpha" = "homeowner-alpha",
): Promise<void> {
  await page.goto("/sign-in");
  const label =
    persona === "editor-alpha"
      ? "Alpha editor"
      : persona === "viewer-alpha"
        ? "Alpha viewer"
        : "Alpha homeowner";
  await page.getByRole("radio", { name: new RegExp(label, "u") }).check();
  await page.getByRole("button", { name: `Continue as ${label}` }).click();
  await expect(page).toHaveURL(/\/projects$/u);
  await expect(page.getByText("Local fixture · Synthetic data")).toBeVisible();
}

async function resumeBridge(page: Page): Promise<void> {
  const row = page.getByRole("article").filter({ hasText: "Synthetic C14.1 bridge home" });
  await row.getByRole("link", { name: "Resume home journey" }).click();
  await expect(page).toHaveURL(`/home/${project.id}`);
  await expect(
    page.getByRole("heading", { name: "Build an honest model of your home" }),
  ).toBeVisible();
}

async function openPersistedDraft(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Review full-house proposal" }).first().click();
  await expect(page).toHaveURL(`/fusion/${project.id}`);
  await expect(page.getByRole("heading", { name: "Discrepancies" })).toBeVisible();
  await page.getByRole("radio", { name: "Accept candidate" }).check();
  await page.getByLabel("Decision reason").fill("Independent synthetic acceptance decision");
  await page.getByRole("button", { name: "Record attributed decisions" }).click();
  await expect(
    page.getByText("This session’s visible discrepancies have attributed decisions."),
  ).toBeVisible();
  const createDraft = page.getByRole("button", { name: "Create operation draft" });
  await expect(createDraft).toBeEnabled();
  await createDraft.click();
  await expect(page.getByText("Draft ready · not committed")).toBeVisible();
  await expect(page.getByText(draft.branchId, { exact: true })).toBeVisible();
  await expect(page.getByText(String(draft.expectedBranchRevision), { exact: true })).toBeVisible();
  await expect(page.getByText(draft.expectedHeadSnapshotSha256, { exact: true })).toBeVisible();
  await expect(page.locator(".operation-draft pre")).toContainText(draft.operations[0]?.type ?? "");
  await expect(page.locator(".operation-draft pre")).toContainText(
    draft.operations[0]?.clientOperationId ?? "",
  );
}

async function previewDraft(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Preview typed corrections" }).click();
}

test("normal project create/resume reaches the route and owner completes only explicit C9→C5→C10 actions @desktop", async ({
  page,
  request,
}) => {
  const consoleProblems: string[] = [];
  page.on("console", (message) => {
    if (
      (message.type() === "error" || message.type() === "warning") &&
      !message
        .text()
        .startsWith("Failed to load resource: the server responded with a status of 404")
    ) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));

  await signIn(page);
  await page.getByLabel("New project name").fill("New synthetic journey");
  await page.getByRole("button", { name: "New project" }).click();
  await expect(page).toHaveURL(`/home/${createdProjectId}`);
  await expect(
    page.getByRole("heading", { name: "Build an honest model of your home" }),
  ).toBeVisible();
  await page
    .getByLabel("Primary navigation")
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await resumeBridge(page);

  await expect(page.locator("#journey-stages > li")).toHaveCount(7);
  const twinStage = page.locator("#journey-stages > li").filter({
    hasText: "Build and explore the committed twin",
  });
  await expect(twinStage).toHaveAttribute("data-stage-state", "needs-attention");
  await expect(twinStage).not.toContainText("A C10 scene derived from an exact committed");
  expect((await fixtureState(request)).accepted.c10Create).toHaveLength(0);

  await openPersistedDraft(page);
  let state = await fixtureState(request);
  expect(state.accepted.c9Review).toHaveLength(1);
  expect(state.accepted.c9Draft).toHaveLength(1);
  expect(state.accepted.c5Preview).toHaveLength(0);
  expect(state.accepted.c5Commit).toHaveLength(0);
  expect(state.accepted.c10Create).toHaveLength(0);

  await previewDraft(page);
  await expect(page.getByText("Preview ready · not committed")).toBeVisible();
  await expect(page.getByText(`Base revision`)).toBeVisible();
  state = await fixtureState(request);
  expect(state.accepted.c5Preview).toHaveLength(1);
  expect(state.accepted.c5Preview[0]?.body).toEqual({
    expectedHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
    expectedRevision: draft.expectedBranchRevision,
    operations: draft.operations,
  });
  expect(state.accepted.c5Commit).toHaveLength(0);
  expect(state.accepted.c10Create).toHaveLength(0);

  await page.getByRole("button", { name: "Confirm corrections and commit" }).click();
  await expect(page.getByText("Homeowner-confirmed exploration model")).toBeVisible();
  await expect(page.getByText(committedSnapshotId, { exact: true })).toBeVisible();
  await expect(
    page.locator(".canonical-commit").getByText(committedSnapshotSha256, { exact: true }),
  ).toBeVisible();
  state = await fixtureState(request);
  expect(state.accepted.c5Commit).toHaveLength(1);
  expect(state.accepted.c5Commit[0]?.body).toEqual({
    commitMessage: "Homeowner confirmed reviewed reconstruction corrections for exploration",
    expectedHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
    expectedRevision: draft.expectedBranchRevision,
    previewId: "e1400000-0000-4000-8000-000000000003",
  });
  expect(state.accepted.c10Create).toHaveLength(0);

  await page.getByRole("button", { name: "Create scene from current committed profile" }).click();
  await expect(page.getByText("Exact viewer job available")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open exact viewer job" })).toHaveAttribute(
    "href",
    `/viewer/${project.id}?jobId=e1400000-0000-4000-8000-000000000006`,
  );
  state = await fixtureState(request);
  expect(state.accepted.c10Create).toHaveLength(1);
  expect(state.accepted.c10Create[0]?.body).toMatchObject({
    sourceSnapshot: {
      profile: "existing",
      snapshotId: committedSnapshotId,
      snapshotSha256: committedSnapshotSha256,
    },
  });

  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    fullPage: false,
    path: `${evidenceDirectory}/desktop-explicit-handoff.png`,
  });
  expect(consoleProblems).toEqual([]);
});

test("editor controls remain available while viewer controls and direct server mutations are denied @roles", async ({
  page,
  request,
}) => {
  await signIn(page, "editor-alpha");
  await resumeBridge(page);
  await expect(page.getByText("Home journey · editor access")).toBeVisible();
  await page.getByRole("link", { name: "Review full-house proposal" }).first().click();
  await expect(page.getByRole("button", { name: "Record attributed decisions" })).toBeVisible();
  expect((await fixtureState(request)).accepted.c9Review).toHaveLength(0);

  await page.context().clearCookies();
  await signIn(page, "viewer-alpha");
  await resumeBridge(page);
  await expect(page.getByText("Home journey · viewer access")).toBeVisible();
  await page.getByRole("link", { name: "Review full-house proposal" }).first().click();
  await expect(
    page.getByText("Viewer access is read-only. No decisions can be recorded."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Record attributed decisions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create operation draft" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview typed corrections" })).toHaveCount(0);

  const sourceSnapshot = {
    modelId: snapshotRecord.modelId,
    profile: "existing",
    projectId: project.id,
    schemaVersion: "c4-canonical-home-v1",
    snapshotId: snapshotRecord.id,
    snapshotSha256: snapshotRecord.snapshotSha256,
  };
  const statuses = await page.evaluate(
    async ({ branchId, decisionId, draftBody, fusionJobId, previewBody, projectId, sceneBody }) => {
      const post = async (url: string, body: unknown) =>
        fetch(url, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "idempotency-key": "viewer-direct-attempt-0001",
          },
          method: "POST",
        }).then((response) => response.status);
      return Promise.all([
        post(`/api/c9/projects/${projectId}/fusion-jobs/${fusionJobId}/proposal/operation-drafts`, {
          ...draftBody,
          branchId,
          decisionIds: [decisionId],
        }),
        post(
          `/api/c5/projects/${projectId}/models/existing/branches/${branchId}/previews`,
          previewBody,
        ),
        post(`/api/c10/projects/${projectId}/scene-jobs`, sceneBody),
      ]);
    },
    {
      branchId: branch.id,
      decisionId: decision.id,
      draftBody: {
        expectedBranchRevision: draft.expectedBranchRevision,
        expectedHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
        expectedProposalVersion: proposal.version,
      },
      fusionJobId: job.id,
      previewBody: {
        expectedHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
        expectedRevision: draft.expectedBranchRevision,
        operations: draft.operations,
      },
      projectId: project.id,
      sceneBody: {
        configuration: c10DefaultCompileConfiguration,
        label: "Viewer must not create this scene",
        sourceSnapshot,
      },
    },
  );
  expect(statuses).toEqual([403, 403, 403]);
  const state = await fixtureState(request);
  expect(state.attempts.c9Draft).toHaveLength(1);
  expect(state.attempts.c5Preview).toHaveLength(1);
  expect(state.attempts.c10Create).toHaveLength(1);
  expect(state.accepted.c9Draft).toHaveLength(0);
  expect(state.accepted.c5Preview).toHaveLength(0);
  expect(state.accepted.c10Create).toHaveLength(0);
});

test("one unavailable C8 or C9 read degrades only the proposal stage and preserves readable stages @desktop", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/c8/projects/**/workspace", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "C8_UNAVAILABLE", detail: "Synthetic C8 outage", status: 503 }),
      contentType: "application/problem+json",
      status: 503,
    });
  });
  await resumeBridge(page);
  await expect(page.getByText("Partial journey available")).toBeVisible();
  const proposalStage = page.locator("#journey-stages > li").filter({
    hasText: "Reconstruction and fusion proposal",
  });
  await expect(proposalStage).toHaveAttribute("data-stage-state", "proposal-ready");
  await expect(proposalStage).toContainText("One or more proposal sources are unavailable");
  for (const title of [
    "Confirm property context",
    "Renovation goals and available evidence",
    "Rights-cleared source evidence",
  ]) {
    await expect(page.locator("#journey-stages > li").filter({ hasText: title })).toHaveAttribute(
      "data-stage-state",
      "complete",
    );
  }

  await page.unroute("**/api/c8/projects/**/workspace");
  await page.route("**/api/c9/projects/**/workspace", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "C9_UNAVAILABLE", detail: "Synthetic C9 outage", status: 503 }),
      contentType: "application/problem+json",
      status: 503,
    });
  });
  await page.reload();
  await expect(page.getByText("Partial journey available")).toBeVisible();
  await expect(proposalStage).toHaveAttribute("data-stage-state", "needs-attention");
  await expect(proposalStage).toContainText("One or more proposal sources are unavailable");
  await expect(
    page.locator("#journey-stages > li").filter({ hasText: "Confirm property context" }),
  ).toHaveAttribute("data-stage-state", "complete");
});

for (const [scenario, expected, acceptedPreviews] of [
  ["preview-blocked", "Preview blocked", 1],
  ["preview-expired", "Expired", 1],
  ["preview-forbidden", "This role cannot complete the canonical handoff", 0],
  ["preview-unavailable", "The exact preview was not created", 0],
] as const) {
  test(`${scenario} preview fails closed with zero commit @states`, async ({ page, request }) => {
    await signIn(page);
    await resumeBridge(page);
    await openPersistedDraft(page);
    await setScenario(request, scenario);
    await previewDraft(page);
    const message =
      scenario === "preview-expired"
        ? page.getByText("Expired", { exact: true })
        : page.getByText(new RegExp(expected, "iu"));
    await expect(message).toBeVisible();
    if (scenario === "preview-blocked" || scenario === "preview-expired") {
      await expect(
        page.getByRole("button", { name: "Confirm corrections and commit" }),
      ).toBeDisabled();
    } else {
      await expect(
        page.getByRole("button", { name: "Confirm corrections and commit" }),
      ).toHaveCount(0);
    }
    const state = await fixtureState(request);
    expect(state.accepted.c5Preview).toHaveLength(acceptedPreviews);
    expect(state.accepted.c5Commit).toHaveLength(0);
    expect(state.accepted.c10Create).toHaveLength(0);
    expect(state.currentBranchRevision).toBe(0);
  });
}

for (const [scenario, expected] of [
  ["commit-conflict", "branch revision or head changed"],
  ["commit-expired", "preview expired"],
  ["commit-forbidden", "role cannot complete the canonical handoff"],
  ["commit-unavailable", "correction commit was not created"],
] as const) {
  test(`${scenario} commit failure never creates a scene or advances current state @states`, async ({
    page,
    request,
  }) => {
    await signIn(page);
    await resumeBridge(page);
    await openPersistedDraft(page);
    await previewDraft(page);
    await expect(page.getByText("Preview ready · not committed")).toBeVisible();
    await setScenario(request, scenario);
    await page.getByRole("button", { name: "Confirm corrections and commit" }).click();
    await expect(page.getByText(new RegExp(expected, "iu"))).toBeVisible();
    const state = await fixtureState(request);
    expect(state.attempts.c5Commit).toHaveLength(1);
    expect(state.accepted.c5Commit).toHaveLength(0);
    expect(state.accepted.c10Create).toHaveLength(0);
    expect(state.currentBranchRevision).toBe(0);
    expect(state.currentSnapshotId).toBe(snapshotRecord.id);
  });
}

test("offline commit abort leaves the backend untouched and reports no mutation @states", async ({
  page,
  request,
}) => {
  await signIn(page);
  await resumeBridge(page);
  await openPersistedDraft(page);
  await previewDraft(page);
  await expect(page.getByText("Preview ready · not committed")).toBeVisible();
  await page.route("**/api/c5/**/commits", (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Confirm corrections and commit" }).click();
  await expect(page.getByText(/offline.*nothing was committed/iu)).toBeVisible();
  const state = await fixtureState(request);
  expect(state.attempts.c5Commit).toHaveLength(0);
  expect(state.accepted.c10Create).toHaveLength(0);
  expect(state.currentBranchRevision).toBe(0);
});

test("C10 remains unavailable until the exact committed snapshot is exposed by the current profile @states", async ({
  page,
  request,
}) => {
  await signIn(page);
  await resumeBridge(page);
  await openPersistedDraft(page);
  await previewDraft(page);
  await page.getByRole("button", { name: "Confirm corrections and commit" }).click();
  await expect(page.getByText("Homeowner-confirmed exploration model")).toBeVisible();
  await setScenario(request, "current-unavailable");
  await page.getByRole("button", { name: "Create scene from current committed profile" }).click();
  await expect(page.getByText(/committed current profile is not available to C10/iu)).toBeVisible();
  const state = await fixtureState(request);
  expect(state.accepted.c5Commit).toHaveLength(1);
  expect(state.attempts.c10Create).toHaveLength(0);
  expect(state.accepted.c10Create).toHaveLength(0);
});

test("390px mobile project navigation and seven-stage semantics stay readable without horizontal overflow @mobile", async ({
  page,
}) => {
  await signIn(page);
  await resumeBridge(page);
  await expect(page.locator("#journey-stages > li")).toHaveCount(7);
  await expect(
    page.getByRole("link", { name: "Review full-house proposal" }).first(),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  expect(
    await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    })),
  ).toEqual({ body: 390, document: 390, viewport: 390 });
  const boxes = await page.locator("#journey-stages > li").evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    }),
  );
  expect(boxes.every(({ left, right, width }) => left >= 0 && right <= 390 && width > 0)).toBe(
    true,
  );
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${evidenceDirectory}/mobile-390-home-journey.png`,
  });
});
