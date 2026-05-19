/**
 * Admin social credentials e2e — VS-11.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const API_BASE = "http://localhost:3000";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "aman2005";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@localhost:5433/newsletter";

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function resetCredentials(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM social_credentials`);
  } finally {
    await client.end();
  }
}

test.describe("Admin social credentials panel (VS-11)", () => {
  test.beforeEach(async () => {
    await resetCredentials();
  });

  test("renders both sections as Not configured, saves and clears LinkedIn + Twitter", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");

    const panel = page.getByTestId("social-credentials-panel");
    await panel.waitFor({ state: "visible" });

    const linkedin = page.getByTestId("linkedin-section");
    const twitter = page.getByTestId("twitter-section");
    await expect(linkedin.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
    await expect(twitter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );

    // Save LinkedIn
    await linkedin.locator("#linkedin-clientId").fill("li-client-id");
    await linkedin.locator("#linkedin-clientSecret").fill("li-client-secret");
    await linkedin.locator("#linkedin-apiVersion").fill("202511");
    await linkedin.getByTestId("linkedin-save").click();

    await expect(linkedin.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // Reload — status persists, fields are empty
    await page.reload();
    const linkedinAfter = page.getByTestId("linkedin-section");
    await linkedinAfter.waitFor({ state: "visible" });
    await expect(linkedinAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );
    await expect(linkedinAfter.locator("#linkedin-clientId")).toHaveValue("");
    await expect(linkedinAfter.locator("#linkedin-clientSecret")).toHaveValue(
      "",
    );

    // Save Twitter
    const twitterAfter = page.getByTestId("twitter-section");
    await twitterAfter.locator("#twitter-apiKey").fill("tw-api-key");
    await twitterAfter.locator("#twitter-apiSecret").fill("tw-api-secret");
    await twitterAfter.locator("#twitter-accessToken").fill("tw-access-token");
    await twitterAfter
      .locator("#twitter-accessTokenSecret")
      .fill("tw-access-token-secret");
    await twitterAfter.getByTestId("twitter-save").click();
    await expect(twitterAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // Clear LinkedIn
    await linkedinAfter.getByTestId("linkedin-clear").click();
    await linkedinAfter.getByTestId("linkedin-clear-confirm").click();
    await expect(linkedinAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
  });
});
