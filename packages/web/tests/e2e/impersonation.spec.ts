/**
 * P6 — super-admin impersonation UI (REQ-101/102/103, EDGE-008).
 *
 * Journey: a seeded super admin logs in, starts impersonating a tenant via
 * the API (the console UI lands in P15), and the admin shell shows the
 * persistent impersonation banner naming the acting tenant. One click on
 * "Exit impersonation" clears it. Audit rows exist for start AND stop.
 *
 * No real external messages are sent (S-web-04): impersonation only touches
 * the DB and cookies.
 */
import { test, expect } from "@playwright/test";
import { randomBytes, scryptSync } from "node:crypto";
import { makeDbClient } from "./_infra";

const UNIQUE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const SUPER_EMAIL = `e2e-super-${UNIQUE}@example.com`;
const SUPER_PASSWORD = "e2e-super-password-1";
const TENANT_NAME = `Impersonation Target ${UNIQUE}`;
const TENANT_SLUG = `imp-${UNIQUE}`;

let tenantId = "";
let superUserId = "";

/** Same stored format as the API's scrypt hasher (services/password.ts). */
function scryptHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

// Warm up the Vite dev server's module graph for the login page. The first
// visit to a page with newly-optimized deps can trigger a full Vite reload
// that wipes in-progress form state mid-test (see auth.spec.ts).
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
    const tenant = await db.query<{ id: string }>(
      "INSERT INTO tenants (slug, name, status) VALUES ($1, $2, 'active') RETURNING id",
      [TENANT_SLUG, TENANT_NAME],
    );
    tenantId = tenant.rows[0].id;
    const superUser = await db.query<{ id: string }>(
      "INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES (NULL, $1, 'E2E Super', $2, 'super_admin') RETURNING id",
      [SUPER_EMAIL, scryptHash(SUPER_PASSWORD)],
    );
    superUserId = superUser.rows[0].id;
  } finally {
    await db.end();
  }
});

test.afterAll(async () => {
  const db = makeDbClient();
  await db.connect();
  try {
    await db.query("DELETE FROM audit_log WHERE tenant_id = $1", [tenantId]);
    await db.query("DELETE FROM users WHERE email = $1", [SUPER_EMAIL]);
    await db.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  } finally {
    await db.end();
  }
});

test("impersonation banner renders while impersonating and exit clears it (REQ-101/102/103)", async ({
  page,
  context,
}) => {
  await context.clearCookies();

  // Sign in as the seeded super admin.
  await page.goto("/admin/login");
  await page.getByLabel(/^Email$/i).fill(SUPER_EMAIL);
  await page.getByLabel(/^Password$/i).fill(SUPER_PASSWORD);
  await page.getByRole("button", { name: /Sign in/i }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/admin") && !url.pathname.startsWith("/admin/login"),
    { timeout: 10_000 },
  );
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);

  // No banner before impersonation starts.
  await expect(
    page.getByRole("button", { name: /Exit impersonation/i }),
  ).toHaveCount(0);

  // Start impersonation (REQ-101) — the tenant-list console UI is P15, so
  // drive the API directly through the same-origin proxy (cookies shared).
  const start = await page.request.post(`/api/super/impersonate/${tenantId}`);
  expect(start.status()).toBe(200);

  // The banner renders app-wide in the admin shell and names the tenant.
  await page.goto("/admin");
  const banner = page.getByTestId("impersonation-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(TENANT_NAME);
  await expect(banner).toContainText(/super admin/i);

  // It persists across navigation (REQ-102 "persistent banner").
  await page.goto("/admin/settings");
  await expect(page.getByTestId("impersonation-banner")).toBeVisible();

  // One-click exit clears it (REQ-102).
  await page
    .getByRole("button", { name: /Exit impersonation/i })
    .click();
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0, {
    timeout: 10_000,
  });

  // Reload — still gone (cookie cleared server-side, not just hidden).
  await page.goto("/admin");
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0);

  // DB truth: audit rows for start AND stop with the super admin id (REQ-103).
  const db = makeDbClient();
  await db.connect();
  try {
    const rows = await db.query<{ action: string; actor_user_id: string }>(
      "SELECT action, actor_user_id FROM audit_log WHERE tenant_id = $1 ORDER BY id",
      [tenantId],
    );
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toContain("impersonation_start");
    expect(actions).toContain("impersonation_stop");
    for (const row of rows.rows) {
      expect(row.actor_user_id).toBe(superUserId);
    }
  } finally {
    await db.end();
  }
});
