import { test, expect } from "@playwright/test";

// Public Ledger archive flow. The home page (`/`) lists reviewed archives and
// links each one to `/archive/:runId`. This test needs at least one reviewed
// archive in the dev DB; it skips (consistent with the other public e2e specs)
// when none are seeded rather than failing.
test("open an archive from the home listing and view the Ledger detail", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const firstArchiveLink = page.locator('a[href^="/archive/"]').first();
  if ((await firstArchiveLink.count()) === 0) {
    test.skip(true, "no reviewed archives in dev DB — seed before running");
    return;
  }

  await firstArchiveLink.click();

  // URL changed to the archive detail page.
  await expect(page).toHaveURL(/\/archive\//);

  // Ledger header renders the issue headline as the page <h1>.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 10_000,
  });

  // At least one story card rendered (unless it's an empty issue).
  const cards = page.locator("article");
  if ((await cards.count()) > 0) {
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(page.getByText("No stories in this issue.")).toBeVisible();
  }

  // Ledger back link points to the listing.
  const backLink = page.getByRole("link", { name: /back to archive/i }).first();
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveAttribute("href", "/");
});

test("archive page shows not-found for nonexistent run", async ({ page }) => {
  await page.goto("/archive/nonexistent-run-id-xyz");
  await expect(page.getByText("This issue isn't here")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.getByText("It may have been removed or never existed."),
  ).toBeVisible();
});
