import { expect, test } from "@playwright/test";

const liveUrl = process.env.C6_LIVE_PLAN_URL;
const livePath = process.env.C6_LIVE_PLAN_PATH ?? "/";

test.skip(
  liveUrl === undefined,
  "C6_LIVE_PLAN_URL is unset; producer/live UI evidence is NOT RUN.",
);

test("[producer-live opt-in] renders the plan workspace without console, network or overflow failures", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => problems.push(`request failed: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${String(response.status())} ${response.url()}`);
  });
  await page.goto(livePath);
  await expect(page.getByRole("heading", { name: /plan|proposal|floor/i }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(problems).toEqual([]);
});
