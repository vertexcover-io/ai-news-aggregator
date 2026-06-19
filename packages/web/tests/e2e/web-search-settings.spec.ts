/**
 * Web Search settings round-trip e2e — VS-0.5.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (proxied via /api on the web server)
 *   - web dev server on :5174 (Playwright baseURL override)
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeDbClient } from "./_infra";

// The settings form requires non-empty ranking/shortlist prompts to save. Seed
// a valid singleton row so Save fires a PUT regardless of prior DB state.
async function resetSettings(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(`DELETE FROM user_settings WHERE singleton = true`);
    // Email/LinkedIn/Twitter times must differ from the pipeline time or the
    // settings form's superRefine rejects the save before it issues a PUT.
    await client.query(
      `INSERT INTO user_settings (top_n, shortlist_size, ranking_prompt, shortlist_prompt, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time)
       VALUES (5, 50, 'seed ranking prompt', 'seed shortlist prompt', '08:00', 'UTC', '09:00', '10:00', '11:00')`,
    );
  } finally {
    await client.end();
  }
}

// Login goes through the Vite proxy (same origin as the page) so the session
// cookie is scoped to the web origin and sent on subsequent PUT /api/* calls.
// The hermetic runner provisions PLAYWRIGHT_BASE_URL with the ephemeral port.
const WEB_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${WEB_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

test.describe("Web Search settings round-trip (VS-0.5)", () => {
  test.beforeEach(async () => {
    await resetSettings();
  });

  test("enable web search, add a query, save, reload — query persists", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto(`${WEB_BASE}/admin/settings`);

    const card = page.getByTestId("web-search-card");
    await card.waitFor({ state: "visible" });

    // Enable the Web Search source via its switch
    const toggle = card.getByRole("switch", { name: /web search/i });
    const isChecked = await toggle.isChecked();
    if (!isChecked) {
      await toggle.click();
    }

    // Open the edit panel
    await card.getByRole("button", { name: /edit/i }).click();

    // Remove any pre-existing query rows (idempotent teardown)
    const removeButtons = card.getByRole("button", { name: /remove query/i });
    let removeCount = await removeButtons.count();
    while (removeCount > 0) {
      await removeButtons.first().click();
      removeCount = await card.getByRole("button", { name: /remove query/i }).count();
    }

    // Add a single fresh query
    await card.getByRole("button", { name: /add query/i }).click();
    await card.getByRole("textbox", { name: /query 1/i }).fill("agentic AI");
    await card.getByRole("spinbutton", { name: /days back for query 1/i }).fill("7");
    await card.getByRole("spinbutton", { name: /max items for query 1/i }).fill("10");

    // Save settings — intercept the PUT to verify it succeeds
    const settingsPutPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/settings") && resp.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /save changes/i }).click();
    const settingsResp = await settingsPutPromise;
    expect(settingsResp.status()).toBe(200);

    // Confirm success toast (sonner renders in a data-sonner-toaster container)
    await expect(
      page.locator("[data-sonner-toaster]").getByText(/settings saved/i),
    ).toBeVisible({ timeout: 10_000 });

    // Reload and verify persistence
    await page.reload();

    const cardAfter = page.getByTestId("web-search-card");
    await cardAfter.waitFor({ state: "visible" });

    // Open edit panel to see the persisted query
    await cardAfter.getByRole("button", { name: /edit/i }).click();

    await expect(
      cardAfter.getByRole("textbox", { name: /query 1/i }),
    ).toHaveValue("agentic AI", { timeout: 8_000 });
  });
});
