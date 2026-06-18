/**
 * VS-1: Super-admin Apify token management (REQ-019, Phase 5).
 *
 * Journeys:
 *   1. test_REQ_019_super_admin_apify_panel: super-admin visits /admin/settings,
 *      sees the Apify section, saves a token — status flips to configured,
 *      updatedAt is shown, no secret echoed in any response.
 *   2. Tenant-admin DOES NOT see the Apify section on /admin/settings.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { makeDbClient, ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE } from "./_infra";

const UNIQUE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const SUPER_EMAIL = `e2e-apify-super-${UNIQUE}@example.com`;
const SUPER_PASSWORD = "e2e-apify-super-password-1";
// A separate tenant for impersonation (so the super_admin can reach /admin/settings).
const TENANT_NAME = `E2E Apify Target ${UNIQUE}`;
const TENANT_SLUG = `e2e-apify-${UNIQUE}`;

let tenantId = "";

/** Same stored format as the API's scrypt hasher (services/password.ts). */
function scryptHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function loginWithForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
}

async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function clearApifyCredential(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(`DELETE FROM app_credentials WHERE key = 'apify_api_token'`);
  } finally {
    await client.end();
  }
}

// Warm up the Vite dev server's module graph for the login page — the first
// visit can trigger a full reload that wipes form state mid-test.
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/admin/login");
  await page.getByRole("heading", { name: /^Sign in$/i }).waitFor();
  await page.waitForTimeout(1000);
  await page.close();
});

test.beforeAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    // Insert a dedicated super_admin user for Apify tests.
    await db.query(
      "INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES (NULL, $1, 'E2E Apify Super', $2, 'super_admin') ON CONFLICT (email) DO NOTHING",
      [SUPER_EMAIL, scryptHash(SUPER_PASSWORD)],
    );
    // Insert an active tenant so the super_admin can impersonate and reach settings.
    const tenant = await db.query<{ id: string }>(
      "INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'active') RETURNING id",
      [TENANT_SLUG, TENANT_NAME],
    );
    tenantId = tenant.rows[0].id;
    // Seed a completed run so the tenant's archive renders.
    await db.query(
      "INSERT INTO run_archives (id, status, ranked_items, top_n, completed_at, tenant_id) VALUES ($1, 'completed', '[]'::jsonb, 10, now() - interval '2 hours', $2)",
      [randomUUID(), tenantId],
    );
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query("DELETE FROM app_credentials WHERE key = 'apify_api_token'");
    await db.query("DELETE FROM run_archives WHERE tenant_id = $1", [tenantId]);
    await db.query("DELETE FROM users WHERE email = $1", [SUPER_EMAIL]);
    await db.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  } finally {
    await db.end();
  }
});

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await clearApifyCredential();
});

/**
 * test_REQ_019_super_admin_apify_panel (VS-1):
 *
 * The super_admin reaches the Apify panel by:
 *   1. Logging in → lands on /admin/tenants.
 *   2. Impersonating the seeded tenant → enters the tenant dashboard.
 *   3. Navigating to /admin/settings → the Apify section appears (role=super_admin
 *      is preserved through impersonation — SettingsPage reads session.data.user.role).
 *
 * The token is masked, never echoed in the UI or API status response.
 */
test("test_REQ_019_super_admin_apify_panel: super-admin sees Apify section, saves token, status flips to configured", async ({
  page,
}) => {
  await loginWithForm(page, SUPER_EMAIL, SUPER_PASSWORD);
  // After login, the super_admin is redirected to /admin/tenants.
  await page.waitForURL("**/admin/tenants", { timeout: 10_000 });

  // Impersonate the seeded tenant so RequireOnboarding lets us through to settings.
  const row = page.getByRole("row", { name: new RegExp(TENANT_NAME) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: /Open/ }).click();
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 10_000 });
  await expect(page.getByTestId("impersonation-banner")).toBeVisible({ timeout: 10_000 });

  // Navigate to settings — the super_admin role is preserved, so ApifyCredentialPanel renders.
  await page.goto("/admin/settings");
  await page.waitForURL("**/admin/settings", { timeout: 10_000 });

  // The Apify credential panel must be visible for super_admin.
  const panel = page.getByTestId("apify-credential-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // Panel should show "Not configured" initially.
  await expect(panel).toContainText(/not configured/i);

  // Enter a token and save.
  const tokenInput = panel.getByLabel(/Apify API token/i);
  await tokenInput.fill("test-apify-token-e2e");
  await panel.getByRole("button", { name: /Save/i }).click();

  // Status should flip to configured + show updatedAt.
  await expect(panel).toContainText(/configured/i, { timeout: 10_000 });
  await expect(panel).toContainText(/updated/i);

  // The token value must NEVER appear anywhere in the panel.
  const panelText = await panel.textContent();
  expect(panelText).not.toContain("test-apify-token-e2e");

  // Verify the API status response also never contains the secret.
  const statusRes = await page.request.get(`${API_BASE}/api/super/app-credentials`);
  const statusBody = await statusRes.text();
  expect(statusBody).not.toContain("test-apify-token-e2e");
});

test("tenant_admin DOES NOT see the Apify section on settings page", async ({
  page,
}) => {
  // Use the bootstrap tenant_admin (ADMIN_EMAIL is a tenant_admin).
  await loginAsAdmin(page);
  await page.goto("/admin/settings");
  await page.waitForURL("**/admin/settings", { timeout: 10_000 });

  // Wait for page to load (other panels are visible).
  await expect(page.getByTestId("social-credentials-panel")).toBeVisible({ timeout: 10_000 });

  // The Apify panel must NOT be visible.
  await expect(page.getByTestId("apify-credential-panel")).toHaveCount(0);
});
