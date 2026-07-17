import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const projectId = "b1000000-0000-4000-8000-000000000007";
const wallId = "b1000000-0000-4000-8000-000000000003";

interface PageHealth {
  readonly consoleProblems: string[];
  readonly failedRequests: string[];
  readonly unexpectedOrigins: string[];
}

test("@canvas Chromium renders the verified GLB and exercises every explicit interaction mode", async ({
  context,
  page,
  request,
}) => {
  await setScenario(request, "succeeded");
  await setPersona(context, "owner");
  const health = watch(page);
  await open(page);
  const hasWebGl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }),
    );
  });
  test.skip(!hasWebGl, "Chromium WebGL unavailable; semantic fallback is covered separately.");
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  await expect(page.getByRole("heading", { name: "Interactive 3D ready" })).toBeVisible();
  const canvas = page.getByLabel("Interactive derived 3D home scene");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("tabindex", "-1");

  await page.getByLabel("Material view").selectOption("status");
  await page.getByLabel("Section plane").check();
  await page.getByLabel("Section height").fill("1350");
  await page.getByLabel("Bounded walk").check();
  await page.keyboard.press("w");
  await page.getByRole("button", { name: "Walk right" }).click();
  await page.getByRole("button", { name: "Reset view" }).click();

  await page.getByRole("button", { name: new RegExp(wallId, "u") }).click();
  await expect(page.getByText(wallId).last()).toBeVisible();
  await expect(page.getByText("Derived visualisation only.")).toBeVisible();
  await canvas.click({ position: { x: 300, y: 220 } });
  await expect(page.getByRole("heading", { name: "wall" })).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/c10-viewer-actual-canvas.png" });
  await assertHealthy(page, health);
});

test("@canvas context loss switches to the honest DOM fallback without presenting canvas success", async ({
  context,
  page,
  request,
}) => {
  await setScenario(request, "succeeded");
  await setPersona(context, "owner");
  const health = watch(page);
  await open(page);
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  const ready = page.getByRole("heading", { name: "Interactive 3D ready" });
  if ((await ready.count()) === 0)
    test.skip(true, "Chromium selected the honest no-WebGL fallback.");
  await expect(ready).toBeVisible();
  await page.getByLabel("Interactive derived 3D home scene").dispatchEvent("webglcontextlost");
  await expect(page.getByTestId("scene-fallback")).toBeVisible();
  await expect(page.getByText(/WebGL context was lost/u)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request fresh access and retry 3D" }),
  ).toBeVisible();
  await assertHealthy(page, health);
});

test("@semantics Firefox/WebKit exercise no-WebGL semantics, canonical inspection and read-only role", async ({
  context,
  page,
  request,
}) => {
  await setScenario(request, "succeeded");
  await setPersona(context, "viewer");
  await forceNoWebGl(page);
  const health = watch(page);
  await open(page);
  await expect(page.getByText(/Viewer role · read-only/u)).toBeVisible();
  await expect(page.getByRole("button", { name: /Compile derived scene/u })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Cancel attempt|Retry as new attempt/u }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  await expect(page.getByTestId("scene-fallback")).toBeVisible();
  await expect(page.getByText(/WebGL is unavailable/u)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(wallId, "u") }).click();
  await expect(page.getByRole("heading", { name: "wall" })).toBeVisible();
  await expect(page.getByText(/not establish surveyed dimensions/u)).toBeVisible();
  await assertHealthy(page, health);
});

test("@semantics Firefox/WebKit expose empty, queued, compiling, publishing, failed and cancelled states", async ({
  context,
  page,
  request,
}) => {
  await setPersona(context, "owner");
  await forceNoWebGl(page);
  const expected = new Map([
    ["empty", "No scene jobs yet"],
    ["queued", "Queued"],
    ["compiling", "Compiling geometry"],
    ["publishing", "Publishing immutable scene"],
    ["failed", "Failed safely"],
    ["cancelled", "Cancelled"],
  ]);
  for (const [scenario, text] of expected) {
    await setScenario(request, scenario);
    await page.goto(`/viewer/${projectId}`);
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("@mobile 390x844 keeps controls usable, avoids overflow and classifies canvas/fallback honestly", async ({
  context,
  page,
  request,
}) => {
  await setScenario(request, "succeeded");
  await setPersona(context, "owner");
  const health = watch(page);
  await open(page);
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  await expect(
    page.getByText(/Interactive 3D ready|Progressive enhancement fallback/u).first(),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const walk = page.getByLabel("Bounded walk");
  if (await walk.count()) {
    await walk.check();
    await expect(page.getByRole("button", { name: "Walk forward" })).toBeVisible();
  }
  await page.evaluate(() => {
    window.scrollTo({ left: 0, top: 0 });
  });
  await page.screenshot({ fullPage: true, path: "/tmp/c10-viewer-mobile.png" });
  await assertHealthy(page, health);
});

async function setScenario(
  request: { get(url: string): Promise<unknown> },
  scenario: string,
): Promise<void> {
  await request.get(`http://127.0.0.1:4321/__scenario?value=${encodeURIComponent(scenario)}`);
}

async function setPersona(context: BrowserContext, role: "owner" | "viewer"): Promise<void> {
  await context.addCookies([
    { domain: "127.0.0.1", name: "hds_c1_session", path: "/", value: `${role}-token` },
  ]);
}

async function forceNoWebGl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return Reflect.apply(original, this, [type, ...args]) as RenderingContext | null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function open(page: Page): Promise<void> {
  await page.goto(`/viewer/${projectId}`);
  await expect(page).toHaveTitle("3D walkthrough · Home Design Studio | Home Design Studio");
  await expect(
    page.getByRole("heading", { name: "Experience the exact committed model" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Fixture presentation evidence");
  await expect(page.getByRole("note")).toContainText("not real-backend evidence");
}

function watch(page: Page): PageHealth {
  const health: PageHealth = { consoleProblems: [], failedRequests: [], unexpectedOrigins: [] };
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) health.consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => health.consoleProblems.push(error.message));
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (!["http://127.0.0.1:4320", "http://127.0.0.1:4321"].includes(origin)) {
      health.unexpectedOrigins.push(request.url());
    }
  });
  page.on("requestfailed", (request) => health.failedRequests.push(request.url()));
  return health;
}

async function assertHealthy(page: Page, health: PageHealth): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(health).toEqual({ consoleProblems: [], failedRequests: [], unexpectedOrigins: [] });
}
