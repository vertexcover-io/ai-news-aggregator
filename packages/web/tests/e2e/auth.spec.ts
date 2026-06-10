/**
 * P3 — per-user auth journeys (REQ-001/002/003/007 UI level).
 *
 *   1. Signup happy path → session established → lands on the onboarding stub.
 *   2. Password mismatch → field error, no navigation, no rows.
 *   3. Duplicate email → "already in use" error.
 *   4. Login with the seeded admin → dashboard.
 *   5. Unauthenticated /admin/* → redirect to /admin/login?next=…
 *
 * No real external messages are sent (S-web-04): the reset email path is not
 * exercised here (covered by API integration tests against an injected
 * sender); signup sends nothing.
 */
import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeDbClient } from "./_infra";

const UNIQUE = `${String(Date.now())}-${String(Math.floor(Math.random() * 100000))}`;
const SIGNUP_EMAIL = `e2e-signup-${UNIQUE}@example.com`;
const PASSWORD = "e2e-password-123";

// Warm up the Vite dev server's module graph for the auth pages. The first
// visit to a page with newly-optimized deps can trigger a full Vite reload
// that wipes in-progress form state mid-test (flaky alert assertions).
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/signup");
  await page.getByRole("heading", { name: /Start your newsletter/i }).waitFor();
  await page.goto("/admin/login");
  await page.getByRole("heading", { name: /^Sign in$/i }).waitFor();
  // Give Vite a beat to finish any dependency re-optimization reload.
  await page.waitForTimeout(1000);
  await page.close();
});

test.afterAll(async () => {
  // Clean the rows this spec created (user + its pending tenant).
  const db = makeDbClient();
  await db.connect();
  try {
    const res = await db.query(
      "SELECT tenant_id FROM users WHERE email LIKE 'e2e-signup-%'",
    );
    await db.query("DELETE FROM users WHERE email LIKE 'e2e-signup-%'");
    const tenantIds = res.rows
      .map((r: { tenant_id: string | null }) => r.tenant_id)
      .filter((t): t is string => t !== null);
    if (tenantIds.length > 0) {
      await db.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [
        tenantIds,
      ]);
    }
  } finally {
    await db.end();
  }
});

test.describe("signup", () => {
  test("happy path creates the account and lands on onboarding", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/signup");
    await expect(
      page.getByRole("heading", { name: /Start your newsletter/i, level: 1 }),
    ).toBeVisible();

    await page.getByLabel(/Your name/i).fill("E2E Signup");
    await page.getByLabel(/^Email$/i).fill(SIGNUP_EMAIL);
    await page.getByLabel(/^Password$/i).fill(PASSWORD);
    await page.getByLabel(/Confirm password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /Create account/i }).click();

    await expect(page).toHaveURL(/\/admin\/onboarding/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /^Onboarding$/i, level: 1 }),
    ).toBeVisible();

    // DB truth: tenant_admin user + pending_setup tenant (REQ-001).
    const db = makeDbClient();
    await db.connect();
    try {
      const user = await db.query<{
        role: string;
        tenant_id: string | null;
        password_hash: string;
      }>("SELECT role, tenant_id, password_hash FROM users WHERE email = $1", [
        SIGNUP_EMAIL,
      ]);
      expect(user.rows).toHaveLength(1);
      expect(user.rows[0].role).toBe("tenant_admin");
      expect(user.rows[0].password_hash).toMatch(/^scrypt\$/);
      const tenant = await db.query<{ status: string }>(
        "SELECT status FROM tenants WHERE id = $1",
        [user.rows[0].tenant_id],
      );
      expect(tenant.rows[0].status).toBe("pending_setup");
    } finally {
      await db.end();
    }
  });

  test("password mismatch shows a field error and stays on /signup", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/signup");
    await page.getByLabel(/Your name/i).fill("E2E Mismatch");
    await page.getByLabel(/^Email$/i).fill(`e2e-signup-mm-${UNIQUE}@example.com`);
    await page.getByLabel(/^Password$/i).fill(PASSWORD);
    await page.getByLabel(/Confirm password/i).fill("different-password");
    await page.getByRole("button", { name: /Create account/i }).click();

    await expect(page.getByRole("alert")).toContainText(/Passwords do not match/i);
    await expect(page).toHaveURL(/\/signup/);
  });

  test("duplicate email shows an already-in-use error", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/signup");
    await page.getByLabel(/Your name/i).fill("E2E Dup");
    // The seeded admin's email is guaranteed to exist.
    await page.getByLabel(/^Email$/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/^Password$/i).fill(PASSWORD);
    await page.getByLabel(/Confirm password/i).fill(PASSWORD);
    const signupResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/auth/signup") &&
        r.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: /Create account/i }).click();
    expect((await signupResponse).status()).toBe(409);

    await expect(page.getByRole("alert")).toContainText(/already in use/i, {
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/signup/);
  });
});

test.describe("login & gating", () => {
  test("seeded admin logs in with email + password", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/login");
    await expect(
      page.getByRole("heading", { name: /^Sign in$/i, level: 1 }),
    ).toBeVisible();
    await page.getByLabel(/Email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 10_000 });
  });

  test("wrong password shows an error and no session is created", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel(/Email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/Password/i).fill("wrong-password-xyz");
    await page.getByRole("button", { name: /Sign in/i }).click();
    await expect(page.getByRole("alert")).toContainText(
      /Incorrect email or password/i,
    );
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("unauthenticated admin route redirects to login with next (REQ-007)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login\?next=/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /^Sign in$/i, level: 1 }),
    ).toBeVisible();
  });
});
