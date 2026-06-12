/**
 * VS-4: super admin → tenant list → impersonate → tenant-scoped data → exit.
 *
 * Covers REQ-100 (super-admin landing is the tenant list), REQ-101/102
 * (impersonation banner + one-click exit, admin pages show only the
 * impersonated tenant's data), REQ-103 (start/stop audit rows in
 * impersonation_events, asserted via DB).
 */
import { test, expect } from "@playwright/test";
import {
  API_BASE,
  E2E_USER_PASSWORD,
  makeDbClient,
  seedReviewedArchive,
  seedTenant,
  seedTenantSettings,
  seedUser,
} from "./_infra";

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SUPER_EMAIL = `super-${RUN}@example.com`;
const TENANT_A = { slug: `alpha-${RUN}`, name: `Alpha Wire ${RUN}` };
const TENANT_B = { slug: `bravo-${RUN}`, name: `Bravo Signal ${RUN}` };

let superAdminId = "";
let tenantAId = "";
let tenantBId = "";
let archiveAId = "";
let archiveBId = "";

test.beforeAll(async () => {
  tenantAId = await seedTenant({ ...TENANT_A, status: "active" });
  tenantBId = await seedTenant({ ...TENANT_B, status: "active" });
  await seedTenantSettings(tenantAId);
  await seedTenantSettings(tenantBId);
  archiveAId = await seedReviewedArchive({
    tenantId: tenantAId,
    digestHeadline: `Alpha issue ${RUN}`,
  });
  archiveBId = await seedReviewedArchive({
    tenantId: tenantBId,
    digestHeadline: `Bravo issue ${RUN}`,
  });
  superAdminId = await seedUser({
    email: SUPER_EMAIL,
    tenantId: null,
    role: "super_admin",
  });
});

test("VS-4: impersonate tenant A, see only A's data, exit, audited", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // UI login → role-aware landing on the tenant list (REQ-100).
  await page.goto("/login");
  await page.locator("#email").fill(SUPER_EMAIL);
  await page.locator("#password").fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/tenants/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0);

  // Both seeded tenants are listed.
  const rowA = page.locator("tr").filter({ hasText: TENANT_A.name });
  await expect(rowA).toHaveCount(1);
  await expect(
    page.locator("tr").filter({ hasText: TENANT_B.name }),
  ).toHaveCount(1);

  // Impersonate tenant A (REQ-101).
  await rowA.getByRole("button", { name: /open/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });

  // Persistent banner names the impersonated tenant (REQ-102).
  const banner = page.getByTestId("impersonation-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(TENANT_A.name);
  await expect(banner).toContainText(TENANT_A.slug);

  // Admin surfaces are scoped to tenant A ONLY: A's run appears on the
  // dashboard (reviewed ⇒ "View archive" link), B's never does (REQ-101).
  await expect(
    page.locator(`a[href="/archive/${archiveAId}"]`).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(`a[href*="${archiveBId}"]`),
  ).toHaveCount(0);

  // Same through the API with the impersonation cookie: run list contains
  // A's archive and not B's.
  const runsRes = await page.request.get(`${API_BASE}/api/runs`);
  expect(runsRes.ok()).toBe(true);
  const runsBody = JSON.stringify(await runsRes.json());
  expect(runsBody).toContain(archiveAId);
  expect(runsBody).not.toContain(archiveBId);

  // The banner persists across admin pages (REQ-102).
  await page.goto("/admin/settings");
  await expect(page.getByTestId("impersonation-banner")).toBeVisible();

  // One-click exit returns to the tenant list, banner gone (REQ-102).
  await page
    .getByTestId("impersonation-banner")
    .getByRole("button", { name: /exit impersonation/i })
    .click();
  await expect(page).toHaveURL(/\/admin\/tenants/, { timeout: 15_000 });
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();

  // REQ-103: audit trail recorded start and stop for (super admin, tenant A).
  const db = makeDbClient();
  await db.connect();
  try {
    const events = await db.query<{ action: string }>(
      `SELECT action FROM impersonation_events
       WHERE super_admin_user_id = $1 AND tenant_id = $2
       ORDER BY created_at`,
      [superAdminId, tenantAId],
    );
    expect(events.rows.map((r: { action: string }) => r.action)).toEqual([
      "start",
      "stop",
    ]);
    const eventsB = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM impersonation_events WHERE tenant_id = $1`,
      [tenantBId],
    );
    expect(eventsB.rows[0].n).toBe(0);
  } finally {
    await db.end();
  }
});
