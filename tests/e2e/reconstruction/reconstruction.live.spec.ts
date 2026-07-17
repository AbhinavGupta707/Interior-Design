import { expect, test } from "@playwright/test";

const liveUrl = process.env.C8_LIVE_RECONSTRUCTION_URL;
const livePath = process.env.C8_LIVE_RECONSTRUCTION_PATH ?? "/reconstruction";

test.skip(
  liveUrl === undefined,
  "C8 integrated BFF/API/worker journey is NOT RUN until L1-L3 merge.",
);

test("[producer-live opt-in] integrated reconstruction renders without disclosure or overflow", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));
  await page.goto(livePath);
  await expect(page.getByRole("heading", { name: /reconstruct/iu }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.locator("body").innerText()).not.toMatch(
    /X-Amz-Signature|Bearer\s|file:\/\/|object[- ]?key/iu,
  );
  expect(problems).toEqual([]);
});
