/**
 * Web-search settings round-trip e2e — VS-0.5.
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

async function resetWebSearchSettings(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE user_settings SET web_search_enabled = false, web_search_config = NULL`,
    );
  } finally {
    await client.end();
  }
}

test.describe("Web search settings round-trip (VS-0.5)", () => {
  test.beforeEach(async () => {
    await resetWebSearchSettings();
  });

  test("admin can enable, configure, save, and reload web-search queries", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");

    const card = page.getByTestId("web-search-card");
    await card.waitFor({ state: "visible" });

    // Enable the source via the Switch in the SourceRow.
    await card.getByRole("switch", { name: /web search/i }).click();

    // Open the edit panel.
    await card.getByRole("button", { name: /web search edit/i }).click();

    // Default seeded row should exist with "agentic AI". Update its values to
    // exercise the round-trip — change the query text, sinceDays, maxItems.
    const queryInput = card.getByLabel(/web search query 1/i);
    await expect(queryInput).toBeVisible();
    await queryInput.fill("agentic AI");

    const sinceInput = card.getByLabel(/web search since days 1/i);
    await sinceInput.fill("7");

    const maxInput = card.getByLabel(/web search max items 1/i);
    await maxInput.fill("10");

    // Save the settings form.
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/settings saved/i)).toBeVisible({
      timeout: 10_000,
    });

    // Reload and verify persistence.
    await page.reload();

    const cardAfter = page.getByTestId("web-search-card");
    await cardAfter.waitFor({ state: "visible" });

    // Switch should still be on.
    await expect(
      cardAfter.getByRole("switch", { name: /web search/i }),
    ).toBeChecked();

    // Open the edit panel and assert persisted values.
    await cardAfter.getByRole("button", { name: /web search edit/i }).click();
    await expect(cardAfter.getByLabel(/web search query 1/i)).toHaveValue(
      "agentic AI",
    );
    await expect(
      cardAfter.getByLabel(/web search since days 1/i),
    ).toHaveValue("7");
    await expect(
      cardAfter.getByLabel(/web search max items 1/i),
    ).toHaveValue("10");
  });
});
