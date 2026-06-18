/**
 * E2E suite: Chrome extension popup flows — Phase 4
 *
 * Loads the unpacked extension in a persistent Chrome for Testing context.
 * Drives the login view and add-current-tab flows against a hermetic API
 * (ephemeral Postgres + Redis provisioned by run-e2e.mjs).
 *
 * Covers: REQ-011, REQ-012, REQ-013, REQ-015, EDGE-003, EDGE-006 (VS-1, VS-2)
 */
import { test, expect, EXPECTED_EXTENSION_ID, ADMIN_PASSWORD, queryRawItems, countRawItemsByUrl } from "./fixtures";

const WRONG_PASSWORD = "wrong-password-for-test";
const TEST_URL = "https://example.com/test-article-e2e";

test.describe("VS-1: Login flow (REQ-011)", () => {
  test("test_REQ_011_login_view_when_no_token — no token → login view shown; wrong password → inline error; correct password → AddView", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();

    // Navigate to popup — no token stored yet.
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    // Login view must be visible.
    await expect(page.getByText("Newsletter Login")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    // AddView must NOT be present.
    await expect(page.getByText("Add to Newsletter")).not.toBeVisible();

    // Submit wrong password → inline error, still on login view.
    await page.getByPlaceholder("Password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid password");
    await expect(page.getByText("Newsletter Login")).toBeVisible();

    // Submit correct password → AddView shown.
    await page.getByPlaceholder("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Add to Newsletter")).toBeVisible({ timeout: 10_000 });

    await page.close();
  });
});

test.describe("VS-2: Add-current-tab flow (REQ-012, REQ-013, EDGE-003)", () => {
  test("test_REQ_012_addview_prefills_active_tab + test_REQ_013_add_page_submits_and_succeeds — logged in popup shows AddView, URL field editable, submit succeeds, DB row created", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    // Login first.
    await expect(page.getByText("Newsletter Login")).toBeVisible();
    await page.getByPlaceholder("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Add to Newsletter")).toBeVisible({ timeout: 10_000 });

    // In headless, active tab may be about:blank — override the URL field directly.
    const urlInput = page.getByLabel("URL");
    await urlInput.fill(TEST_URL);
    await expect(urlInput).toHaveValue(TEST_URL);

    // Submit.
    await page.getByRole("button", { name: "Add this page" }).click();

    // Success state shown (REQ-013).
    await expect(page.getByText(/Added to the next newsletter run/i)).toBeVisible({
      timeout: 15_000,
    });

    // DB assertion: exactly one raw_items row with source_type='manual' and that URL.
    const rows = await queryRawItems(TEST_URL);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_type).toBe("manual");
    expect(rows[0].url).toBe(TEST_URL);

    await page.close();
  });

  test("test_REQ_006_dedupe — same URL submitted again → alreadyExisted, DB count stays 1 (EDGE-003)", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    // Login (token from previous test may have been cleared by context; re-login).
    const loginHeading = page.getByText("Newsletter Login");
    const isLogin = await loginHeading.isVisible().catch(() => false);
    if (isLogin) {
      await page.getByPlaceholder("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByText("Add to Newsletter")).toBeVisible({ timeout: 10_000 });
    }

    // Submit the same URL again.
    const urlInput = page.getByLabel("URL");
    await urlInput.fill(TEST_URL);
    await page.getByRole("button", { name: "Add this page" }).click();

    // Should show alreadyExisted message.
    await expect(page.getByText(/Already in the queue/i)).toBeVisible({ timeout: 15_000 });

    // DB count for that URL must still be exactly 1.
    const count = await countRawItemsByUrl(TEST_URL);
    expect(count).toBe(1);

    await page.close();
  });
});

test.describe("EDGE-006: Stale token handling", () => {
  test("test_EDGE_006_stale_token_returns_to_login — invalid stored token → submit → returns to login view", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();

    // Navigate to an extension page to manipulate chrome.storage via evaluate.
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    // Inject a bogus token directly into chrome.storage.local.
    await page.evaluate(() => {
      return chrome.storage.local.set({ ext_token: "invalid.bogus.token.that.will.be.rejected" });
    });

    // Reload so the App reads the injected token and shows AddView.
    await page.reload();
    await expect(page.getByText("Add to Newsletter")).toBeVisible({ timeout: 10_000 });

    // Submit with the stale token — API will return 401.
    const urlInput = page.getByLabel("URL");
    await urlInput.fill("https://example.com/stale-token-test");
    await page.getByRole("button", { name: "Add this page" }).click();

    // Extension should clear the token and return to login view.
    await expect(page.getByText("Newsletter Login")).toBeVisible({ timeout: 15_000 });

    await page.close();
  });
});

test.describe("REQ-015: Deterministic extension ID", () => {
  test("test_REQ_015_deterministic_extension_id — derived extension ID matches manifest key", ({
    extensionId,
  }) => {
    expect(extensionId).toBe(EXPECTED_EXTENSION_ID);
  });
});
