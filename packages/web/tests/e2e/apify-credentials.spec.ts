/**
 * VS-1: Super-admin Apify token management (REQ-019, Phase 6).
 *
 * Journeys:
 *   1. test_REQ_019_super_admin_apify_panel: super-admin navigates DIRECTLY to
 *      /admin/platform (no impersonation), sees the Apify section, saves a
 *      token — status flips to Configured, updatedAt shown, secret never echoed.
 *   2. test_REQ_019_tenant_admin_denied_platform: tenant_admin hitting
 *      /admin/platform is redirected away by RequireSuperAdmin (→ /admin) and
 *      does NOT see the Apify panel.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { randomBytes, scryptSync } from "node:crypto";
import { makeDbClient, ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE } from "./_infra";

const UNIQUE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const SUPER_EMAIL = `e2e-apify-super-${UNIQUE}@example.com`;
const SUPER_PASSWORD = "e2e-apify-super-password-1";

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
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query("DELETE FROM app_credentials WHERE key = 'apify_api_token'");
    await db.query("DELETE FROM users WHERE email = $1", [SUPER_EMAIL]);
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
 * The super_admin navigates DIRECTLY to /admin/platform — no impersonation
 * required. RequireSuperAdmin lets them through. The Apify panel is visible,
 * saving a token flips the status to Configured, and the secret is never
 * echoed in the UI or API response.
 */
test("test_REQ_019_super_admin_apify_panel: super-admin navigates directly to /admin/platform, sees Apify panel, saves token", async ({
  page,
}) => {
  await loginWithForm(page, SUPER_EMAIL, SUPER_PASSWORD);
  // After login, the super_admin is redirected to /admin/tenants.
  await page.waitForURL("**/admin/tenants", { timeout: 10_000 });

  // Navigate directly to the platform settings page — no impersonation needed.
  await page.goto("/admin/platform");
  await page.waitForURL("**/admin/platform", { timeout: 10_000 });

  // The Apify credential panel must be visible.
  const panel = page.getByTestId("apify-credential-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // Panel should show "Not configured" initially.
  await expect(panel).toContainText(/not configured/i);

  // Enter a token and save.
  const tokenInput = panel.getByLabel(/Apify API token/i);
  await tokenInput.fill("test-apify-token-e2e");
  await panel.getByRole("button", { name: /Save/i }).click();

  // Status should flip to Configured + show updatedAt.
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

/**
 * test_REQ_019_tenant_admin_denied_platform (VS-1):
 *
 * A tenant_admin hitting /admin/platform is bounced away by RequireSuperAdmin
 * (→ /admin) and the Apify panel is never rendered.
 */
test("test_REQ_019_tenant_admin_denied_platform: tenant_admin hitting /admin/platform is redirected and does NOT see the Apify panel", async ({
  page,
}) => {
  // Use the bootstrap tenant_admin (ADMIN_EMAIL is a tenant_admin).
  await loginAsAdmin(page);
  await page.goto("/admin/platform");

  // RequireSuperAdmin redirects non-super_admin to /admin.
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 10_000 });

  // The Apify panel must NOT be present.
  await expect(page.getByTestId("apify-credential-panel")).toHaveCount(0);
});
