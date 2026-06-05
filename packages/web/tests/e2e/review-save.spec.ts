import { test, expect } from "@playwright/test";

test.skip(!process.env.REVIEW_RUN_ID, "REVIEW_RUN_ID not set");

test("save & view archive navigates to /archive/:runId (REQ-151)", async ({
  page,
}) => {
  const runId = process.env.REVIEW_RUN_ID ?? "";
  await page.goto(`/review/${runId}`);
  await expect(page.getByRole("article").first()).toBeVisible({
    timeout: 15_000,
  });
  // Perform a trivial reorder to make save eligible and cause a visible change.
  const firstHandle = page.getByLabel("Drag to reorder").first();
  await firstHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");

  await page
    .getByRole("button", { name: /save & view archive/i })
    .click();
  // Reordering leaves the digest meta stale — confirm the save-anyway dialog.
  await page.getByRole("button", { name: /save anyway/i }).click();
  await expect(page).toHaveURL(new RegExp(`/archive/${runId}$`));
});
