/**
 * Web Search settings round-trip e2e — VS-0.5.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (proxied via /api on the web server)
 *   - web dev server on :5174 (Playwright baseURL override)
 */
import { test, expect, type Page } from "@playwright/test";

// Login goes through Vite proxy (same origin as the page) so the session
// cookie is scoped to localhost:5174 and sent on subsequent PUT /api/* calls.
const WEB_BASE = "http://localhost:5174";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "aman2005";

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${WEB_BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

test.describe("Web Search settings round-trip (VS-0.5)", () => {
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
