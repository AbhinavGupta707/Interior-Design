import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const projectId = "b1000000-0000-4000-8000-000000000007";

interface Metrics {
  readonly frameCount: number;
  readonly frameTimestamps: readonly number[];
  readonly maximumRendererCalls: number;
  readonly readyAt?: number;
}

test("compact fixture meets interactive, renderer-call, animation and demand-idle instrumentation budgets", async ({
  context,
  page,
  request,
}, testInfo) => {
  await request.get("http://127.0.0.1:4321/__scenario?value=succeeded");
  await persona(context);
  await page.goto(`/viewer/${projectId}`);
  await expect(page.getByRole("note")).toContainText("Fixture presentation evidence");
  const hasWebGl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }),
    );
  });
  test.skip(
    !hasWebGl,
    "WebGL unavailable; this run is semantic fallback evidence, not performance evidence.",
  );

  const startedAt = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Request access and inspect" }).click();
  await expect(page.getByRole("heading", { name: "Interactive 3D ready" })).toBeVisible();
  const interactiveMilliseconds = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  const mobile = testInfo.project.name.includes("mobile");
  expect(interactiveMilliseconds).toBeLessThanOrEqual(mobile ? 7_000 : 5_000);

  const canvas = page.getByLabel("Interactive derived 3D home scene");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.evaluate(() => window.__C10_VIEWER_METRICS__?.resetInteractionSample());
  if (box) {
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.42, { steps: 45 });
    await page.mouse.up();
  }
  await page.waitForTimeout(350);
  const interaction = await metrics(page);
  expect(interaction.maximumRendererCalls).toBeLessThanOrEqual(500);
  expect(interaction.frameCount).toBeGreaterThan(10);
  const medianFps = framesPerSecond(interaction.frameTimestamps);
  expect(medianFps).toBeGreaterThanOrEqual(30);

  const beforeIdle = interaction.frameCount;
  await page.waitForTimeout(750);
  const afterIdle = (await metrics(page)).frameCount;
  expect(afterIdle - beforeIdle).toBeLessThanOrEqual(1);

  await testInfo.attach("c10-fixture-performance.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          classification: "synthetic fixture / Chromium actual canvas",
          idleFrameDelta: afterIdle - beforeIdle,
          interactiveMilliseconds: Math.round(interactiveMilliseconds),
          maximumRendererCalls: interaction.maximumRendererCalls,
          medianFps: Number(medianFps.toFixed(1)),
          viewport: testInfo.project.name,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});

async function persona(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { domain: "127.0.0.1", name: "hds_c1_session", path: "/", value: "owner-token" },
  ]);
}

async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const snapshot = window.__C10_VIEWER_METRICS__?.snapshot();
    if (!snapshot) throw new Error("Frozen C10 viewer metrics are unavailable.");
    return snapshot;
  });
}

function framesPerSecond(timestamps: readonly number[]): number {
  const intervals = timestamps
    .slice(1)
    .map((value, index) => value - (timestamps[index] ?? value))
    .filter((value) => value > 0 && value <= 100)
    .sort((left, right) => left - right);
  if (intervals.length === 0) return 0;
  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2 === 0
      ? ((intervals[middle - 1] ?? 0) + (intervals[middle] ?? 0)) / 2
      : (intervals[middle] ?? 0);
  return median === 0 ? 0 : 1_000 / median;
}

declare global {
  interface Window {
    __C10_VIEWER_METRICS__?: {
      readonly resetInteractionSample: () => void;
      readonly snapshot: () => Metrics;
    };
  }
}
