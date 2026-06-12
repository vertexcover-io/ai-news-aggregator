/**
 * Admin social credentials e2e — VS-11, reworked for P12 (REQ-080/082/086).
 *
 * Tenants manage ONLY their own credentials:
 *   - Twitter/X OAuth1 posting keys (save/clear, encrypted at rest)
 *   - LinkedIn connect/disconnect (the app client is super-admin-managed)
 * App-level secrets (LinkedIn client id/secret, Twitter collector cookie)
 * are no longer settable from the tenant settings page or API.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";


async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function resetCredentials(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(`DELETE FROM social_credentials`);
    await client.query(`DELETE FROM app_credentials`);
  } finally {
    await client.end();
  }
}

test.describe("Admin social credentials panel (VS-11 / P12)", () => {
  test.beforeEach(async () => {
    await resetCredentials();
  });

  test("LinkedIn section is connect-only (no client form); Twitter posting keys save and clear", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");

    const panel = page.getByTestId("social-credentials-panel");
    await panel.waitFor({ state: "visible" });

    // LinkedIn: the app client is super-admin-managed (REQ-082) — the tenant
    // page renders NO client id/secret form, only the connection controls.
    const linkedin = page.getByTestId("linkedin-section");
    await expect(linkedin.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
    await expect(linkedin.locator("#linkedin-clientId")).toHaveCount(0);
    await expect(linkedin.locator("#linkedin-clientSecret")).toHaveCount(0);
    const connectBtn = linkedin.getByTestId("linkedin-connect-btn");
    await expect(connectBtn).toBeVisible();
    // Shared client unset → connect disabled with a super-admin hint.
    await expect(connectBtn).toBeDisabled();

    // The collector-cookie card is gone from the tenant page (REQ-086).
    await expect(page.getByTestId("twitter-collector-card")).toHaveCount(0);

    // Twitter posting keys remain a tenant credential.
    const twitter = page.getByTestId("twitter-section");
    await expect(twitter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
    await twitter.locator("#twitter-apiKey").fill("tw-api-key");
    await twitter.locator("#twitter-apiSecret").fill("tw-api-secret");
    await twitter.locator("#twitter-accessToken").fill("tw-access-token");
    await twitter
      .locator("#twitter-accessTokenSecret")
      .fill("tw-access-token-secret");
    await twitter.getByTestId("twitter-save").click();
    await expect(twitter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // Reload — status persists, fields are empty (secrets never echoed back).
    await page.reload();
    const twitterAfter = page.getByTestId("twitter-section");
    await twitterAfter.waitFor({ state: "visible" });
    await expect(twitterAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );
    await expect(twitterAfter.locator("#twitter-apiKey")).toHaveValue("");

    // Clear Twitter.
    await twitterAfter.getByTestId("twitter-clear").click();
    await twitterAfter.getByTestId("twitter-clear-confirm").click();
    await expect(twitterAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
  });
});

test.describe("App-level secrets are tenant-unreachable (P12, REQ-082/086)", () => {
  test.beforeEach(async () => {
    await resetCredentials();
  });

  test("tenant PUTs for the LinkedIn client and collector cookie return 404", async ({
    page,
  }) => {
    await adminLogin(page);

    const putLinkedIn = await page.request.put(
      `${API_BASE}/api/admin/social-credentials/linkedin`,
      { data: { clientId: "li-client-id", clientSecret: "li-client-secret" } },
    );
    expect(putLinkedIn.status()).toBe(404);

    const putCollector = await page.request.put(
      `${API_BASE}/api/admin/social-credentials/twitter-collector`,
      { data: { apiKey: "base64-cookie-blob-e2e-fixture" } },
    );
    expect(putCollector.status()).toBe(404);

    // Nothing landed in either store.
    const client = makeDbClient();
    await client.connect();
    try {
      const creds = await client.query("SELECT 1 FROM social_credentials");
      expect(creds.rowCount).toBe(0);
      const appCreds = await client.query("SELECT 1 FROM app_credentials");
      expect(appCreds.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });

  test("tenant Twitter PUT then GET confirms encrypted DB roundtrip", async ({
    page,
  }) => {
    await adminLogin(page);
    const put = await page.request.put(
      `${API_BASE}/api/admin/social-credentials/twitter`,
      {
        data: {
          apiKey: "  api-key-with-whitespace  ",
          apiSecret: "tw-secret",
          accessToken: "tw-at",
          accessTokenSecret: "tw-ats",
        },
      },
    );
    expect(put.ok()).toBe(true);

    const get = await page.request.get(
      `${API_BASE}/api/admin/social-credentials`,
    );
    const status = (await get.json()) as {
      twitter: { configured: boolean; updatedAt: string | null };
    };
    expect(status.twitter.configured).toBe(true);
    expect(typeof status.twitter.updatedAt).toBe("string");

    // Verify the DB column is encrypted (not plaintext) and keyed by tenant.
    const client = makeDbClient();
    await client.connect();
    try {
      const row = await client.query<{
        tenant_id: string | null;
        encrypted_fields: { apiKey: { ct: string } };
      }>(
        "SELECT tenant_id, encrypted_fields FROM social_credentials WHERE platform = 'twitter'",
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].tenant_id).not.toBeNull();
      expect(row.rows[0].encrypted_fields.apiKey.ct).not.toContain(
        "api-key-with-whitespace",
      );
    } finally {
      await client.end();
    }
  });
});
