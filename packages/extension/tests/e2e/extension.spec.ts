/**
 * E2E suite: Chrome extension popup flows — multi-tenant.
 *
 * Loads the unpacked extension in a persistent Chrome for Testing context and
 * drives login + add-current-tab against a hermetic API (ephemeral Postgres +
 * Redis from run-e2e.mjs). Two tenant_admins are seeded via the signup API so
 * the suite can prove per-tenant stamping AND cross-tenant isolation.
 *
 * Covers: login (email+password), tenant-stamped submission, per-tenant dedupe,
 * cross-tenant isolation, stale-token 401, deterministic id.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  EXPECTED_EXTENSION_ID,
  queryRawItems,
  countRawItemsByUrl,
  signupTenant,
  getTenantIdForEmail,
} from "./fixtures";

const PASSWORD = "Password123!";
const WRONG_PASSWORD = "wrong-password-for-test";

const TENANT_A = { email: "a-admin@e2e.test", name: "Tenant A" };
const TENANT_B = { email: "b-admin@e2e.test", name: "Tenant B" };

const TEST_URL = "https://example.com/test-article-e2e";

test.beforeAll(async () => {
  await signupTenant(TENANT_A.email, PASSWORD, TENANT_A.name);
  await signupTenant(TENANT_B.email, PASSWORD, TENANT_B.name);
});

/** Ensure the popup is logged in as `email`: logs out first if already in AddView. */
async function loginAs(page: Page, extensionId: string, email: string): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  const inAddView = await page
    .getByRole("heading", { name: "Add a Story" })
    .isVisible()
    .catch(() => false);
  if (inAddView) {
    await page.getByRole("button", { name: "Log out" }).first().click();
  }
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Add a Story" })).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Login flow", () => {
  test("no token → login view; wrong password → inline error; correct → AddView", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Add a Story" }),
    ).not.toBeVisible();

    await page.getByLabel("Email").fill(TENANT_A.email);
    await page.getByLabel("Password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("Incorrect email or password");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Add a Story" })).toBeVisible({
      timeout: 10_000,
    });

    await page.close();
  });
});

test.describe("Tenant-stamped submission + per-tenant dedupe", () => {
  test("add page → exactly one manual row stamped with the submitter's tenant", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await loginAs(page, extensionId, TENANT_A.email);

    const urlInput = page.getByLabel("URL");
    await urlInput.fill(TEST_URL);
    await page.getByRole("button", { name: "Add this page" }).click();
    await expect(page.getByText(/Added to the next issue/i)).toBeVisible({
      timeout: 15_000,
    });

    const tenantA = await getTenantIdForEmail(TENANT_A.email);
    expect(tenantA).not.toBeNull();

    const rows = await queryRawItems(TEST_URL);
    expect(rows).toHaveLength(1);
    expect(rows[0].source_type).toBe("manual");
    expect(rows[0].url).toBe(TEST_URL);
    expect(rows[0].tenant_id).toBe(tenantA);

    await page.close();
  });

  test("same URL, same tenant again → alreadyExisted, count stays 1", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await loginAs(page, extensionId, TENANT_A.email);

    await page.getByLabel("URL").fill(TEST_URL);
    await page.getByRole("button", { name: "Add this page" }).click();
    await expect(page.getByText(/Already in the queue/i)).toBeVisible({
      timeout: 15_000,
    });

    expect(await countRawItemsByUrl(TEST_URL)).toBe(1);
    await page.close();
  });
});

test.describe("Cross-tenant isolation", () => {
  test("a second tenant submitting the same URL creates its OWN row (not a dedupe)", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await loginAs(page, extensionId, TENANT_B.email);

    await page.getByLabel("URL").fill(TEST_URL);
    await page.getByRole("button", { name: "Add this page" }).click();
    // Per-tenant dedupe: tenant B has never seen this URL → a fresh add.
    await expect(page.getByText(/Added to the next issue/i)).toBeVisible({
      timeout: 15_000,
    });

    const tenantA = await getTenantIdForEmail(TENANT_A.email);
    const tenantB = await getTenantIdForEmail(TENANT_B.email);
    expect(tenantA).not.toBe(tenantB);

    const rows = await queryRawItems(TEST_URL);
    // Now exactly two rows for the same URL — one per tenant, isolated.
    expect(rows).toHaveLength(2);
    const tenantIds = rows.map((r) => r.tenant_id).sort();
    expect(tenantIds).toEqual([tenantA, tenantB].sort());

    await page.close();
  });
});

test.describe("Stale token handling", () => {
  test("invalid stored token → submit → 401 → returns to login view", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);

    await page.evaluate(() =>
      chrome.storage.local.set({
        ext_token: "invalid.bogus-token-that-will-be-rejected",
      }),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Add a Story" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel("URL").fill("https://example.com/stale-token-test");
    await page.getByRole("button", { name: "Add this page" }).click();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 15_000,
    });
    await page.close();
  });
});

test.describe("Deterministic extension ID", () => {
  test("derived extension ID matches the manifest key", ({ extensionId }) => {
    expect(extensionId).toBe(EXPECTED_EXTENSION_ID);
  });
});
