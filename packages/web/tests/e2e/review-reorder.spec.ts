import { test, expect } from "@playwright/test";

// Requires: full stack up (pnpm infra:up + api + pipeline + web dev) and a completed, unreviewed run seeded in the DB.
// Use the REVIEW_RUN_ID env var to point at a known run.
test.skip(!process.env.REVIEW_RUN_ID, "REVIEW_RUN_ID not set");

test("drag reorder updates the rendered order (REQ-121, REQ-122)", async ({
  page,
}) => {
  const runId = process.env.REVIEW_RUN_ID ?? "";
  await page.goto(`/review/${runId}`);

  // Wait for cards to render
  const articles = page.locator("article");
  await expect(articles.first()).toBeVisible({ timeout: 15_000 });
  const before = await articles.allTextContents();
  expect(before.length).toBeGreaterThanOrEqual(2);

  // Keyboard-only reorder: focus first handle, Space, ArrowDown, Space.
  const firstHandle = page.getByLabel("Drag to reorder").first();
  await firstHandle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");

  const after = await articles.allTextContents();
  expect(after[0]).not.toBe(before[0]);
});
