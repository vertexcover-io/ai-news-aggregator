/**
 * P15 — super-admin console UI (REQ-100, links REQ-101 via P6).
 *
 * Journeys:
 *   1. test_REQ_100_superadmin_lands_on_tenant_list: a super admin signs in
 *      and LANDS on the tenant-list console (never a tenant dashboard); the
 *      list shows the seeded tenant with owner email, subscribers, last run.
 *   2. A tenant_admin can never reach the console — the guard bounces them
 *      to their own dashboard.
 *   3. "Open →" starts an audited impersonation and routes into the tenant
 *      dashboard with the P6 banner; exiting returns to the console.
 *
 * No real external messages are sent (S-web-04): everything here is DB +
 * cookies only. The spec seeds its own tenant/users — no shared tenant-0
 * archive assertions, so no reseed-to-newest dance is needed.
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { makeDbClient, ADMIN_EMAIL, ADMIN_PASSWORD } from "./_infra";

const UNIQUE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const SUPER_EMAIL = `e2e-console-super-${UNIQUE}@example.com`;
const SUPER_PASSWORD = "e2e-console-password-1";
const TENANT_NAME = `Console Target ${UNIQUE}`;
const TENANT_SLUG = `console-${UNIQUE}`;
const OWNER_EMAIL = `e2e-console-owner-${UNIQUE}@example.com`;

let tenantId = "";

/** Same stored format as the API's scrypt hasher (services/password.ts). */
function scryptHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
}

// Warm up the Vite dev server's module graph for the login page — the first
// visit can trigger a full reload that wipes form state mid-test (see
// auth.spec.ts).
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
    await db.query(
      "INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, 'E2E Owner', $3, 'tenant_admin')",
      [tenantId, OWNER_EMAIL, scryptHash("e2e-owner-password-1")],
    );
    await db.query(
      "INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES (NULL, $1, 'E2E Console Super', $2, 'super_admin')",
      [SUPER_EMAIL, scryptHash(SUPER_PASSWORD)],
    );
    // Console list stats: one confirmed subscriber + one completed run.
    await db.query(
      "INSERT INTO subscribers (email, status, tenant_id) VALUES ($1, 'confirmed', $2)",
      [`e2e-console-sub-${UNIQUE}@example.com`, tenantId],
    );
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
    await db.query("DELETE FROM audit_log WHERE tenant_id = $1", [tenantId]);
    await db.query("DELETE FROM run_archives WHERE tenant_id = $1", [tenantId]);
    await db.query("DELETE FROM subscribers WHERE tenant_id = $1", [tenantId]);
    await db.query("DELETE FROM users WHERE email IN ($1, $2)", [
      SUPER_EMAIL,
      OWNER_EMAIL,
    ]);
    await db.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  } finally {
    await db.end();
  }
});

test("test_REQ_100_superadmin_lands_on_tenant_list", async ({ page, context }) => {
  await context.clearCookies();
  await login(page, SUPER_EMAIL, SUPER_PASSWORD);

  // The super admin LANDS on the console — never a tenant dashboard.
  await page.waitForURL("**/admin/tenants", { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "Tenants", level: 1 }),
  ).toBeVisible();

  // The seeded tenant row carries the list fields: owner email, subscribers,
  // last run.
  const row = page.getByRole("row", { name: new RegExp(TENANT_NAME) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(OWNER_EMAIL);
  await expect(row).toContainText(TENANT_SLUG);
  await expect(row).toContainText("Active");
  await expect(row).toContainText("1");
  await expect(row).toContainText(/ago/);

  // Search narrows the list to the seeded tenant.
  await page
    .getByPlaceholder(/Search tenants/i)
    .fill(TENANT_NAME.toLowerCase());
  await expect(row).toBeVisible();
});

test("tenant_admin cannot access the console (guard redirects)", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  // The bootstrap tenant-0 admin is a tenant_admin (P3 seed).
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.waitForURL(
    (url) => url.pathname.startsWith("/admin") && !url.pathname.startsWith("/admin/login"),
    { timeout: 10_000 },
  );

  await page.goto("/admin/tenants");
  // Bounced to the tenant dashboard; the console never renders.
  await page.waitForURL(
    (url) => url.pathname === "/admin",
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("heading", { name: "Tenants", level: 1 }),
  ).toHaveCount(0);
});

test("Open → impersonates the tenant and enters its dashboard with the banner (REQ-101)", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await login(page, SUPER_EMAIL, SUPER_PASSWORD);
  await page.waitForURL("**/admin/tenants", { timeout: 10_000 });

  const row = page.getByRole("row", { name: new RegExp(TENANT_NAME) });
  await row.getByRole("button", { name: /Open/ }).click();

  // Routed into the acting tenant's dashboard with the P6 banner naming it.
  await page.waitForURL((url) => url.pathname === "/admin", { timeout: 10_000 });
  const banner = page.getByTestId("impersonation-banner");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(TENANT_NAME);

  // One-click exit returns to the console landing (REQ-102 linkage).
  await page.getByRole("button", { name: /Exit impersonation/i }).click();
  await page.waitForURL("**/admin/tenants", { timeout: 10_000 });
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Tenants", level: 1 }),
  ).toBeVisible();
});
