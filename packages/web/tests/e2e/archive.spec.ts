import { test, expect, type Page } from "@playwright/test";

async function waitForRunComplete(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: "View Archive" })
  ).toBeVisible({ timeout: 300_000 });
}

test("submit run and view archive page", async ({ page }) => {
  await page.goto("/run");

  // Wait for form to load
  await page.waitForLoadState("networkidle");

  // Reduce HN count to minimum to make the run fast
  await page.fill('input[type="number"][name="hn.count"]', "20");

  // Click the Run button to submit
  await page.getByRole("button", { name: /^run$/i }).click();

  // Wait for run to complete (View Archive button appears)
  await waitForRunComplete(page);

  // Verify View Archive button and click it
  const viewArchiveBtn = page.getByRole("button", { name: "View Archive" });
  await expect(viewArchiveBtn).toBeVisible();
  await viewArchiveBtn.click();

  // Verify URL changed to archive page
  await expect(page).toHaveURL(/\/archive\//);

  // Verify header
  await expect(page.getByRole("heading", { name: "AI Newsletter" })).toBeVisible();

  // Verify at least 1 story card rendered
  const cards = page.locator("article");
  await expect(cards.first()).toBeVisible({ timeout: 10_000 });

  // Verify card structure
  await expect(cards.first().getByText("The Recap:")).toBeVisible();
  await expect(cards.first().getByText("Read more →")).toBeVisible();

  // Verify back link
  await expect(page.getByText("← Back to Run")).toBeVisible();
});

test("archive page shows not-found for nonexistent run", async ({ page }) => {
  await page.goto("/archive/nonexistent-run-id-xyz");
  await expect(
    page.getByText("Run not found — it may have expired.")
  ).toBeVisible({ timeout: 10_000 });
});
