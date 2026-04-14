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

  // Drag the first card down past the second card using mouse drag.
  const firstHandle = page.getByLabel("Drag to reorder").first();
  const secondHandle = page.getByLabel("Drag to reorder").nth(1);
  const firstBox = await firstHandle.boundingBox();
  const secondBox = await secondHandle.boundingBox();
  if (!firstBox || !secondBox) throw new Error("Could not get bounding boxes");

  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  // Slow move to give dnd-kit time to activate the pointer sensor.
  await page.mouse.move(firstBox.x + firstBox.width / 2, secondBox.y + secondBox.height, { steps: 20 });
  await page.mouse.up();

  // Wait for dnd-kit to commit the drop and re-render.
  await expect(page.locator("article.opacity-70")).toHaveCount(0, { timeout: 3_000 });
  const after = await articles.allTextContents();
  expect(after[0]).not.toBe(before[0]);
});
