import { expect, test } from "@playwright/test";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { ids } from "../../../apps/web/test/render-stills/fixtures";

const backend = "http://127.0.0.1:4353";
const route = `/render-stills/${ids.project}?jobId=${ids.job}`;
const screenshotDirectory = "/tmp/c14-render-stills-playwright-evidence";
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

async function primeApplication(request: APIRequestContext) {
  const headers = { cookie: "hds_c1_session=owner-token" };
  const responses = await Promise.all([
    request.get("/api/c1/session", { headers }),
    request.get(`/api/c1/projects/${ids.project}`, { headers }),
    request.get(`/api/c14/projects/${ids.project}/render-capabilities`, { headers }),
    request.get(`/api/c14/projects/${ids.project}/render-eligible-sources`, { headers }),
    request.get(`/api/c14/projects/${ids.project}/render-jobs`, { headers }),
  ]);
  for (const response of responses) await expect(response).toBeOK();
}

function collectUnexpectedFailures(page: Page) {
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (
      request.method() === "GET" &&
      request.url().startsWith(`${backend}/artifacts/`) &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    ) {
      // Chromium can report an intentional image-stream cancellation while the exact job switches.
      return;
    }
    requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    );
  });
  return { consoleErrors, requestFailures };
}

test.beforeEach(async ({ context, request }) => {
  await request.get(`${backend}/__scenario?value=ready`);
  if (!applicationPrimed) {
    await primeApplication(request);
    applicationPrimed = true;
  }
  await session(context, "owner-token");
});

test("@workflow @keyboard owner follows exact pins through verification and a durable lifecycle", async ({
  page,
  request,
}) => {
  const failures = collectUnexpectedFailures(page);
  await page.goto(route);
  await expect(
    page.getByRole("heading", { level: 1, name: "Render with the model held still." }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`jobId=${ids.job}$`, "u"));
  await expect(page.getByText("Synthetic fixture presentation · tests only")).toBeVisible();
  const capability = page.getByRole("region", {
    name: "Render capability on this configured host",
  });
  await expect(capability).toBeVisible();
  await expect(capability.getByText("Hardware gate")).toBeVisible();
  await expect(capability.getByText("deferred", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /Geometry-locked deterministic render.+derived visualisation only/iu,
    }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /Segmentation diagnostic/iu })).toBeVisible();

  const depth = page.getByRole("button", { name: /Depth · EXR container metadata/iu });
  await depth.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Depth · EXR container metadata" })).toBeVisible();
  const depthPanel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Depth · EXR container metadata" }) })
    .last();
  await depthPanel.getByRole("button", { name: "Verify fresh bytes" }).click();
  await expect(depthPanel.getByText("OpenEXR container header")).toBeVisible();

  await page.getByText("Manifest and exact source disclosure").click();
  await expect(page.getByText("same-host-build-script-profile-source")).toBeVisible();

  await page.getByRole("button", { name: /Living room review still Failed safely/iu }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`jobId=${failedJobId()}$`, "u"));
  await expect(page.getByRole("button", { name: "Retry exact job" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry exact job" }).click();
  await expect(
    page.getByText("Retry created a new fenced attempt for the exact durable job."),
  ).toBeAttached();

  await page.getByLabel("Job label").fill("Fixture lifecycle still");
  await page.getByRole("button", { name: "Create geometry-safe still job" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Fixture lifecycle still" }),
  ).toBeFocused();
  await expect(page.getByText("Safe result published").first()).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("heading", { level: 2, name: "Geometry-locked deterministic render" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /Geometry-locked deterministic render for Fixture lifecycle still/iu,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Segmentation diagnostic for Fixture lifecycle still/iu }),
  ).toBeVisible();
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: `${screenshotDirectory}/chromium-desktop-inert-workflow.png`,
  });

  const state = await request.get(`${backend}/__state`);
  await expect(state.json()).resolves.toMatchObject({
    canonicalMutations: 0,
    creates: 1,
    retries: 1,
  });
  const persisted = await page.evaluate(() => ({
    indexedDatabase: "databases" in indexedDB ? indexedDB.databases() : [],
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(persisted)).not.toMatch(
    /artifact|blob:|signature|PRIVATE|sceneGlb|sourceSnapshot/iu,
  );
  expect(failures.consoleErrors).toEqual([]);
  expect(failures.requestFailures).toEqual([]);
});

function failedJobId(): string {
  return "c1400000-0000-4000-8000-000000000023";
}

test("@cross-browser safe output stays primary when the optional provider is disabled", async ({
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=provider-disabled`);
  await page.goto(route);
  await expect(page.getByText("Provider disabled · safe result remains available")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Geometry-locked deterministic render" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Request optional enhancement" })).toBeDisabled();
  await expect(
    page.getByText("“Illustrative optional enhancement” is never canonical."),
  ).toBeVisible();
  await expect(
    page.getByText(
      /No survey, as-built, structural, regulatory, cost, availability or professional certainty/iu,
    ),
  ).toBeVisible();
});

test("@status viewer is inspect-only while editor retains bounded controls", async ({
  context,
  page,
}) => {
  await session(context, "viewer-token");
  await page.goto(route);
  await expect(page.getByText("Viewer access is inspect-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create geometry-safe still job" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Request optional enhancement" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry exact job" })).toBeDisabled();

  await session(context, "editor-token");
  await page.reload();
  await expect(page.getByText("editor · can create")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create geometry-safe still job" })).toBeEnabled();
});

test("@security foreign tenant gets no project, pin, result, or hash disclosure", async ({
  context,
  page,
}) => {
  await session(context, "foreign-token");
  await page.goto(route);
  await expect(
    page.getByRole("heading", { name: "Render details were not disclosed" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic still study")).toHaveCount(0);
  await expect(page.getByText(ids.sceneJob)).toHaveCount(0);
  await expect(page.getByText(ids.result)).toHaveCount(0);
});

test("@status strict malformed and private service responses fail closed", async ({
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=malformed`);
  await page.goto(route);
  await expect(
    page.getByRole("heading", { name: "Render details were not disclosed" }),
  ).toBeVisible();
  await expect(page.getByText(/PRIVATE_TOKEN/iu)).toHaveCount(0);

  await request.get(`${backend}/__scenario?value=service-error`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Render details were not disclosed" }),
  ).toBeVisible();
  await expect(page.getByText(/PRIVATE_RENDER_TOKEN/iu)).toHaveCount(0);
});

test("@status expired session, stale retry, and offline inspection remain recoverable", async ({
  context,
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=stale`);
  await page.goto(`/render-stills/${ids.project}?jobId=${failedJobId()}`);
  await page.getByRole("button", { name: "Retry exact job" }).click();
  await expect(page.getByText(/exact pins became stale/iu)).toBeVisible();
  await expect(page.getByText(/PRIVATE_VERSION/iu)).toHaveCount(0);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("Offline inspection mode", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry exact job" })).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await request.get(`${backend}/__scenario?value=expired`);
  await page.reload();
  await expect(page.getByText("Session expired", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
});

test("@status tampered, expired, and undecodable artifact bytes are withheld", async ({
  page,
  request,
}) => {
  for (const [value, copy] of [
    ["tampered", "Tampered artifact blocked"],
    ["expired-access", "Artifact access expired"],
    ["decode", "Decode failed safely"],
  ] as const) {
    await request.get(`${backend}/__scenario?value=${value}`);
    await page.goto(route);
    await expect(page.getByText(copy).first()).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: /Geometry-locked deterministic render.+derived visualisation only/iu,
      }),
    ).toHaveCount(0);
  }
});

test("@status enhancement failure and geometry rejection never hide the safe result", async ({
  page,
  request,
}) => {
  await request.get(`${backend}/__scenario?value=enhancement-failed`);
  await page.goto(route);
  await expect(page.getByText("Enhancement failed · safe result remains available")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Geometry-locked deterministic render/iu }),
  ).toBeVisible();

  await request.get(`${backend}/__scenario?value=enhancement-rejected`);
  await page.reload();
  await expect(
    page.getByText("Rejected by geometry guard · safe result remains available"),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Geometry-locked deterministic render/iu }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /Illustrative optional enhancement/iu })).toHaveCount(
    0,
  );
});

test("@mobile 390x844 has no horizontal overflow and preserves usable targets", async ({
  page,
}) => {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Geometry-locked deterministic render/iu }),
  ).toBeVisible();
  const layout = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll("button, select, input:not([type=checkbox])"),
    ].filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
    const checkboxLabels = [...document.querySelectorAll("label")].filter(
      (element) =>
        element instanceof HTMLElement &&
        element.offsetParent !== null &&
        element.querySelector("input[type=checkbox]"),
    );
    return {
      checkboxTargetHeights: checkboxLabels.map(
        (element) => element.getBoundingClientRect().height,
      ),
      controls: controls.map((element) => ({
        height: element.getBoundingClientRect().height,
        label:
          element.getAttribute("aria-label") ?? element.getAttribute("name") ?? element.textContent,
        tag: element.tagName,
        type: element.getAttribute("type"),
      })),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.controls.filter(({ height }) => height < 43)).toEqual([]);
  expect(Math.min(...layout.checkboxTargetHeights)).toBeGreaterThanOrEqual(43);
});
