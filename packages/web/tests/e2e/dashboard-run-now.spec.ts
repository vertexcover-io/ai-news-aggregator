/**
 * Dashboard Run Now e2e — VS-5, REQ-W1.
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

async function seedSettings(page: Page): Promise<void> {
  const res = await page.request.put(`${API_BASE}/api/settings`, {
    data: {
      topN: 10,
      halfLifeHours: null,
      hnEnabled: true,
      hnConfig: { sinceDays: 1, pointsThreshold: 50 },
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: false,
      webSearchConfig: null,
      pipelineTime: "08:00",
      scheduleTimezone: "UTC",
      scheduleEnabled: false,
    },
  });
  expect(res.ok()).toBe(true);
}

async function truncate(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM email_sends`);
    await client.query(`DELETE FROM run_archives`);
    await client.query(`DELETE FROM user_settings`);
  } finally {
    await client.end();
  }
}

test.describe("Dashboard Run Now (VS-5)", () => {
  test.beforeEach(async () => {
    await truncate();
  });

  test.afterEach(async () => {
    await truncate();
  });

  test("REQ-W1: Run now click adds a running row to the table", async ({
    page,
  }) => {
    await adminLogin(page);
    await seedSettings(page);

    await page.goto("/admin");

    const runNowBtn = page
      .getByRole("button", { name: /^run now$/i })
      .first();
    await runNowBtn.waitFor({ state: "visible" });
    await runNowBtn.click();

    // Within 5 seconds (polling interval is 2s), a running/cancelling row appears.
    const row = page.locator("tr[data-run-id]").first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row).toContainText(/Running|Cancelling/i, { timeout: 5000 });
  });
});
