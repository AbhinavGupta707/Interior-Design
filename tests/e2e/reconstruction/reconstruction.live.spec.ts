import { expect, test } from "@playwright/test";

const liveUrl = process.env.C8_LIVE_RECONSTRUCTION_URL;
const livePath = process.env.C8_LIVE_RECONSTRUCTION_PATH;

test.skip(
  liveUrl === undefined,
  "C8 integrated BFF/API journey is NOT RUN unless a live loopback URL is provided.",
);

test("[producer-live opt-in] integrated reconstruction renders without disclosure or overflow", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/c8/")) {
      problems.push(`request failed: ${request.url()}`);
    }
  });
  if (livePath === undefined) {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Continue as Alpha homeowner" }).click();
    await expect(page).toHaveURL(/\/projects$/u);
    await page.getByLabel("New project name").fill("C8 integrated browser acceptance");
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page).toHaveURL(/\/onboarding\/[a-f0-9-]+$/u);
    const projectId = new URL(page.url()).pathname.split("/").at(-1);
    expect(projectId).toMatch(/^[a-f0-9-]+$/u);
    await page.goto(`/reconstruction/${projectId ?? "invalid"}`);
  } else {
    await page.goto(livePath);
  }
  await expect(
    page.getByRole("heading", { name: "Reconstruct what the evidence supports" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Capability status" })).toBeVisible();
  await expect(page.getByText("No eligible media yet")).toBeVisible();
  await expect(page.getByText("Canonical model unchanged")).toBeVisible();
  await expect(page.locator(".runtime-status strong", { hasText: "unavailable" })).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.locator("body").innerText()).not.toMatch(
    /X-Amz-Signature|Bearer\s|file:\/\/|object[- ]?key/iu,
  );
  expect(problems).toEqual([]);
});
