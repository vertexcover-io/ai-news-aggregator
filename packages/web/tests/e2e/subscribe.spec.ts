import { test, expect } from "@playwright/test";

test("subscribe widget visible on homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("privacy page renders", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText(/privacy policy/i)).toBeVisible();
});

test("terms page renders", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByText(/terms/i)).toBeVisible();
});
