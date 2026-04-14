import { test, expect } from "@playwright/test";

test.skip(!process.env.REVIEW_RUN_ID, "REVIEW_RUN_ID not set");

test("add a post via HN URL and see it appended (REQ-131, REQ-132, REQ-133)", async ({
  page,
}) => {
  const runId = process.env.REVIEW_RUN_ID ?? "";
  const url =
    process.env.REVIEW_ADD_URL ?? "https://news.ycombinator.com/item?id=1";
  await page.goto(`/review/${runId}`);
  await expect(page.getByText("Add a post")).toBeVisible();
  await page.getByLabel("URL").fill(url);
  await page.getByRole("button", { name: /fetch/i }).click();
  // Pending card appears, then resolves.
  await expect(page.locator('[data-pending="true"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-pending="true"]')).toHaveCount(0, {
    timeout: 30_000,
  });
});
