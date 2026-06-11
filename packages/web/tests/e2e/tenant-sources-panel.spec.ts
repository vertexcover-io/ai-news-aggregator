/**
 * Phase 8 e2e: Settings sources panel (REQ-070/072/074).
 *
 * test_REQ_074_sources_panel_in_settings_no_standalone_route:
 *   source management lives INSIDE /admin/settings — there is no standalone
 *   admin sources management route (/admin/sources renders the 404 page; the
 *   pre-existing public /sources page and the run-scoped
 *   /admin/sources/:runId preview are different surfaces and stay).
 *
 * Plus the panel's manual add → list → toggle → remove loop against the live
 * API + DB (REQ-072), with per-source rows persisted across reloads (REQ-070).
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeDbClient } from "./_infra";

const WEB_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${WEB_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

/** The panel reads the session tenant's rows — wipe them for isolation. */
async function resetSources(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(`DELETE FROM sources`);
  } finally {
    await client.end();
  }
}

test.describe("Settings sources panel (P8)", () => {
  test.beforeEach(async ({ page }) => {
    await resetSources();
    await adminLogin(page);
  });

  test("test_REQ_074_sources_panel_in_settings_no_standalone_route", async ({
    page,
  }) => {
    await page.goto(`${WEB_BASE}/admin/settings`);
    const panel = page.getByTestId("tenant-sources-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("heading", { name: /sources/i }),
    ).toBeVisible();

    // No standalone admin sources management route: /admin/sources is a 404.
    await page.goto(`${WEB_BASE}/admin/sources`);
    await expect(page.getByText(/404 · NOT FOUND/i)).toBeVisible();
    await expect(page.getByTestId("tenant-sources-panel")).toHaveCount(0);
  });

  test("manual add, enable toggle, and remove persist (REQ-072)", async ({
    page,
  }) => {
    await page.goto(`${WEB_BASE}/admin/settings`);
    const panel = page.getByTestId("tenant-sources-panel");
    await expect(panel).toBeVisible();

    // -- Add a Reddit source manually. ------------------------------------
    await panel.getByLabel(/source type/i).selectOption("reddit");
    await panel.getByLabel(/source value/i).fill("r/LocalLLaMA");
    const postPromise = page.waitForResponse(
      (r) => r.url().includes("/api/sources") && r.request().method() === "POST",
    );
    await panel.getByRole("button", { name: /^add$/i }).click();
    expect((await postPromise).status()).toBe(201);

    const row = panel.getByTestId("source-row").filter({ hasText: "r/LocalLLaMA" });
    await expect(row).toBeVisible();

    // -- Toggle it off; persists across reload. ----------------------------
    const toggle = row.getByRole("switch", { name: /toggle r\/LocalLLaMA/i });
    await expect(toggle).toBeChecked();
    const patchPromise = page.waitForResponse(
      (r) => r.url().includes("/api/sources/") && r.request().method() === "PATCH",
    );
    await toggle.click();
    expect((await patchPromise).status()).toBe(200);
    await expect(toggle).not.toBeChecked();

    await page.reload();
    const rowAfter = page
      .getByTestId("tenant-sources-panel")
      .getByTestId("source-row")
      .filter({ hasText: "r/LocalLLaMA" });
    await expect(rowAfter).toBeVisible();
    await expect(
      rowAfter.getByRole("switch", { name: /toggle r\/LocalLLaMA/i }),
    ).not.toBeChecked();

    // -- Remove it; gone after reload. -------------------------------------
    const deletePromise = page.waitForResponse(
      (r) => r.url().includes("/api/sources/") && r.request().method() === "DELETE",
    );
    await rowAfter.getByRole("button", { name: /remove r\/LocalLLaMA/i }).click();
    expect((await deletePromise).status()).toBe(200);
    await expect(rowAfter).toHaveCount(0);

    await page.reload();
    await expect(
      page
        .getByTestId("tenant-sources-panel")
        .getByTestId("source-row")
        .filter({ hasText: "r/LocalLLaMA" }),
    ).toHaveCount(0);
  });

  test("invalid manual add surfaces the API error and adds nothing", async ({
    page,
  }) => {
    await page.goto(`${WEB_BASE}/admin/settings`);
    const panel = page.getByTestId("tenant-sources-panel");
    await expect(panel).toBeVisible();

    await panel.getByLabel(/source type/i).selectOption("blog");
    await panel.getByLabel(/source value/i).fill("not a url");
    await panel.getByRole("button", { name: /^add$/i }).click();

    await expect(
      page.locator("[data-sonner-toaster]").getByText(/invalid listing url/i),
    ).toBeVisible();
    await expect(panel.getByTestId("source-row")).toHaveCount(0);
  });
});
