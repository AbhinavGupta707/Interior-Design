import { expect, test, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:4342";

interface BrowserHealth {
  readonly consoleProblems: string[];
  readonly failedRequests: string[];
  readonly unexpectedOrigins: string[];
}

interface BackendState {
  readonly asset: {
    readonly rights: {
      readonly basis: string;
      readonly serviceProcessingConsent: boolean;
      readonly trainingUseConsent: string;
    };
    readonly status: string;
  };
  readonly branch: {
    readonly headSnapshotId: string;
    readonly revision: number;
    readonly sourceSnapshotId: string;
  };
  readonly c8V2Invocations: readonly string[];
  readonly calibration: {
    readonly createdBy: string;
    readonly residualMillimetres: number;
  };
  readonly currentSnapshotId: string;
  readonly dossier: {
    readonly interiorKnowledgeStatus: string;
    readonly property: {
      readonly interiorKnowledgeStatus: string;
      readonly mode: string;
    };
  };
  readonly draft: {
    readonly createdBy: string;
    readonly metrics: { readonly acceptedCount: number; readonly unresolvedCount: number };
    readonly operations: readonly unknown[];
  };
  readonly intake: {
    readonly intake: {
      readonly evidenceAvailable: { readonly plans: boolean };
      readonly goals: readonly string[];
    };
    readonly updatedBy: string;
  };
  readonly mutationOrder: readonly string[];
  readonly preview: { readonly operations: readonly unknown[] };
  readonly sceneJob: {
    readonly request: {
      readonly sourceSnapshot: {
        readonly profile: string;
        readonly snapshotId: string;
        readonly snapshotSha256: string;
      };
    };
    readonly state: string;
  };
  readonly setup: {
    readonly actorUserId: string;
    readonly coordinateSystem: { readonly globalAnchor: { readonly status: string } };
    readonly elements: Record<string, readonly unknown[]> & {
      readonly levels: readonly [
        {
          readonly elevationMm: { readonly knowledge: string };
          readonly name: { readonly knowledge: string };
          readonly origin: {
            readonly actorUserId: string;
            readonly evidenceIds: readonly string[];
          };
          readonly storeyHeightMm: { readonly knowledge: string };
        },
      ];
    };
    readonly expectedCurrentSnapshotSha256: null;
    readonly projectId: string;
    readonly propertyId: string;
  };
}

test("empty-state rendered homeowner journey persists acknowledgement, C6/C5 correction and exact C10 view", async ({
  page,
  request,
}) => {
  await request.post(`${backend}/__test/reset`);
  await forceNoWebGl(page);
  const health = watch(page);
  const setupBodies: unknown[] = [];
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      browserRequest.url().includes("/api/c5/projects/") &&
      browserRequest.url().endsWith("/models/existing/home-workspace")
    ) {
      setupBodies.push(browserRequest.postDataJSON());
    }
  });

  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Continue with a local fixture" })).toBeVisible();
  await page.getByRole("radio", { name: /Alpha homeowner/u }).check();
  await page.getByRole("button", { name: "Continue as Alpha homeowner" }).click();
  await expect(page.getByRole("heading", { name: "Choose a project" })).toBeVisible();
  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByLabel("New project name").fill("Persisted synthetic homeowner journey");
  await page.getByRole("button", { name: "New project" }).click();

  await expect(
    page.getByRole("heading", { name: "Build an honest model of your home" }),
  ).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  expect(projectId).toBeTruthy();
  await expect(page.locator("#journey-stages > li")).toHaveCount(7);
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("region", { name: "Confirm property context" })
    .getByRole("link", { name: "Confirm property" })
    .click();
  await expect(page.getByRole("heading", { name: "Property and home dossier" })).toBeVisible();
  await page.getByRole("button", { name: "Enter manually" }).click();
  await page.getByLabel("Address line 1").fill("9 Synthetic Acceptance Row");
  await page.getByLabel("Locality optional").fill("Fixture Borough");
  await page.getByLabel("Jurisdiction").selectOption("england");
  await page.getByRole("button", { name: "Save manual identity" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Manual property identity saved/u }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Home journey/u }).click();
  await page.waitForLoadState("networkidle");

  await page.locator("#journey-stages").getByRole("link", { name: "Add goals" }).click();
  await expect(page.getByRole("heading", { name: "Tell us about your home" })).toBeVisible();
  await page
    .getByLabel("Goals *")
    .fill("Correct this creator-owned synthetic plan without inventing hidden geometry");
  await page.getByLabel("Plans").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForLoadState("networkidle");

  await page.locator("#journey-stages").getByRole("link", { name: "Supply evidence" }).click();
  await expect(page.getByRole("heading", { name: "Project evidence" })).toBeVisible();
  await page.getByLabel("Choose plan").setInputFiles({
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><path d="M100 100H900V700H100Z" fill="none" stroke="black"/></svg>',
      "utf8",
    ),
    mimeType: "image/svg+xml",
    name: "creator-owned-synthetic-plan.svg",
  });
  await page.getByLabel(/Allow service processing for this project/u).check();
  await expect(page.getByRole("radio", { name: "Denied" })).toBeChecked();
  await page.getByRole("button", { name: "Hash and upload" }).click();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: /Home journey/u }).click();
  await page.waitForLoadState("networkidle");

  await page
    .locator("#journey-stages")
    .getByRole("link", { name: "Set up unmeasured workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Set up an unmeasured starting point" }),
  ).toBeVisible();
  await page.getByLabel("I confirm this home has at least one level.").check();
  await page
    .getByLabel(
      "I understand that its name, elevation, storey height and all interior measurements are unknown.",
    )
    .check();
  await page.getByRole("button", { name: "Set up unmeasured workspace" }).click();
  await expect(page.getByText(/Unmeasured workspace created/u)).toBeVisible();
  expect(setupBodies).toEqual([{ confirmUnmeasuredInterior: true }]);

  const initialized = await backendState(request);
  expect(initialized.currentSnapshotId).toBe(initialized.branch.headSnapshotId);
  expect(initialized.branch).toMatchObject({
    headSnapshotId: initialized.branch.sourceSnapshotId,
    revision: 1,
  });
  await page.getByRole("link", { name: /Home journey/u }).click();
  await page.waitForLoadState("networkidle");

  await page.locator("#journey-stages").getByRole("link", { name: "Correct ready plan" }).click();
  await expect(page.getByRole("heading", { name: "Floor-plan correction" })).toBeVisible();
  await expect(page.getByLabel("Parser")).toHaveValue("auto");
  await page.getByRole("button", { name: "Start proposal job" }).click();
  const candidates = page.locator("section.plan-candidates li > button");
  await expect(candidates).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) {
    await candidates.nth(index).click();
    await page.getByRole("radio", { name: "accepted" }).check();
  }
  await page.getByLabel("Known length · integer mm").fill("7000");
  await page.getByRole("checkbox", { name: /Confirm this scale evidence/u }).check();
  await page.getByRole("button", { name: "Save calibration evidence" }).click();
  await expect(page.getByText("Residual 0 mm")).toBeVisible();
  await page
    .getByRole("group", { name: "Acknowledge proposal warnings" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Create immutable operation draft" }).click();
  await expect(page.getByText("7 operations", { exact: true })).toBeVisible();

  const drafted = await backendState(request);
  expect(drafted.currentSnapshotId).toBe(initialized.currentSnapshotId);
  expect(drafted.branch.revision).toBe(1);
  await page.getByRole("button", { name: "Preview exact operations in C5" }).click();
  await expect(page.getByText("Valid to commit")).toBeVisible();
  const previewed = await backendState(request);
  expect(previewed.currentSnapshotId).toBe(initialized.currentSnapshotId);
  expect(previewed.branch.revision).toBe(1);
  await page.getByRole("button", { name: "Commit reviewed operations through C5" }).click();
  await expect(page.getByText("Committed through C5", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Return to home journey" }).click();
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("confirmed", { exact: true })).toBeVisible();
  await page
    .locator("#journey-stages")
    .getByRole("link", { name: "Compile committed twin" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Experience the exact committed model" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("not real-backend evidence");
  await page.getByRole("button", { name: "Compile derived scene" }).click();
  await expect(page.getByText("Published scene is available")).toBeVisible();
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  await expect(page.getByTestId("scene-fallback")).toBeVisible();
  await expect(page.getByText(/WebGL is unavailable/u)).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/c14-2-persisted-viewer.png" });
  await page.getByRole("link", { name: /Home journey/u }).click();
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator("#journey-stages").getByRole("link", { name: "Explore exact viewer job" }),
  ).toBeVisible();
  await page.screenshot({ fullPage: true, path: "/tmp/c14-2-persisted-home.png" });

  const final = await backendState(request);
  expect(final.mutationOrder).toEqual([
    "project.create",
    "property.manual",
    "intake.persist",
    "evidence.upload-start",
    "evidence.ready",
    "model.acknowledged-setup",
    "c6.proposal",
    "c6.calibration",
    "c6.draft",
    "c5.preview",
    "c5.commit",
    "c10.scene",
  ]);
  expect(final.dossier).toMatchObject({
    interiorKnowledgeStatus: "unknown-without-evidence",
    property: { interiorKnowledgeStatus: "unknown-without-evidence", mode: "manual" },
  });
  expect(final.intake.intake.goals).toHaveLength(1);
  expect(final.intake.intake.evidenceAvailable.plans).toBe(true);
  expect(final.asset).toMatchObject({
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    status: "ready",
  });
  expect(final.setup.expectedCurrentSnapshotSha256).toBeNull();
  expect(final.setup.coordinateSystem.globalAnchor.status).toBe("not-established");
  expect(final.setup.elements.levels).toHaveLength(1);
  expect(final.setup.elements.levels[0]).toMatchObject({
    elevationMm: { knowledge: "unknown" },
    name: { knowledge: "unknown" },
    origin: { actorUserId: final.setup.actorUserId, evidenceIds: [] },
    storeyHeightMm: { knowledge: "unknown" },
  });
  for (const [kind, values] of Object.entries(final.setup.elements)) {
    if (kind !== "levels") expect(values).toEqual([]);
  }
  expect(final.calibration).toMatchObject({
    createdBy: final.setup.actorUserId,
    residualMillimetres: 0,
  });
  expect(final.draft.createdBy).toBe(final.setup.actorUserId);
  expect(final.draft.metrics).toMatchObject({ acceptedCount: 7, unresolvedCount: 0 });
  expect(final.preview.operations).toEqual(final.draft.operations);
  expect(final.branch).toMatchObject({
    headSnapshotId: final.currentSnapshotId,
    revision: 2,
    sourceSnapshotId: initialized.currentSnapshotId,
  });
  expect(final.sceneJob).toMatchObject({
    request: {
      sourceSnapshot: {
        profile: "existing",
        snapshotId: final.currentSnapshotId,
        snapshotSha256: "2".repeat(64),
      },
    },
    state: "succeeded",
  });
  expect(final.c8V2Invocations).toEqual([]);
  await assertHealthy(page, health);
});

async function backendState(request: {
  get(url: string): Promise<{ json(): Promise<unknown> }>;
}): Promise<BackendState> {
  const response = await request.get(`${backend}/__test/state`);
  return (await response.json()) as BackendState;
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

function watch(page: Page): BrowserHealth {
  const health: BrowserHealth = { consoleProblems: [], failedRequests: [], unexpectedOrigins: [] };
  const expected404Message =
    "Failed to load resource: the server responded with a status of 404 (Not Found)";
  page.on("console", (message) => {
    if (message.type() === "error" && message.text() === expected404Message) {
      return;
    }
    if (message.type() === "error") health.consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => health.consoleProblems.push(error.message));
  page.on("response", (browserResponse) => {
    const url = browserResponse.url();
    const status = browserResponse.status();
    const expectedUnavailable =
      status === 404 &&
      /^\/api\/c5\/projects\/[^/]+\/models\/existing\/source$/u.test(new URL(url).pathname);
    if (status >= 400 && !expectedUnavailable) {
      health.failedRequests.push(`${String(status)} ${url}`);
    }
  });
  page.on("request", (browserRequest) => {
    const origin = new URL(browserRequest.url()).origin;
    if (!["http://127.0.0.1:4341", "http://127.0.0.1:4342"].includes(origin)) {
      health.unexpectedOrigins.push(browserRequest.url());
    }
  });
  page.on("requestfailed", (browserRequest) => {
    const url = browserRequest.url();
    const path = new URL(url).pathname;
    const expectedAbort =
      browserRequest.failure()?.errorText === "net::ERR_ABORTED" &&
      ((url.startsWith("http://127.0.0.1:4341") &&
        /\/api\/c(?:1\/projects\/[^/]+\/intake|3\/projects\/[^/]+\/property\/dossier)$/u.test(
          path,
        )) ||
        /^\/__storage\/[^/]+\/\d+$/u.test(path));
    if (!expectedAbort) health.failedRequests.push(url);
  });
  return health;
}

async function assertHealthy(page: Page, health: BrowserHealth): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(health).toEqual({ consoleProblems: [], failedRequests: [], unexpectedOrigins: [] });
}
