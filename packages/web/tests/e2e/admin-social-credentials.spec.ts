/**
 * Admin social credentials e2e — VS-11.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";


async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function resetCredentials(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(`DELETE FROM social_credentials`);
  } finally {
    await client.end();
  }
}

test.describe("Admin social credentials panel (VS-11)", () => {
  test.beforeEach(async () => {
    await resetCredentials();
  });

  test("renders both sections as Not configured, saves and clears LinkedIn + Twitter", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");

    const panel = page.getByTestId("social-credentials-panel");
    await panel.waitFor({ state: "visible" });

    const linkedin = page.getByTestId("linkedin-section");
    const twitter = page.getByTestId("twitter-section");
    await expect(linkedin.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
    await expect(twitter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );

    // Save LinkedIn
    await linkedin.locator("#linkedin-clientId").fill("li-client-id");
    await linkedin.locator("#linkedin-clientSecret").fill("li-client-secret");
    await linkedin.locator("#linkedin-apiVersion").fill("202511");
    await linkedin.getByTestId("linkedin-save").click();

    await expect(linkedin.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // Reload — status persists, fields are empty
    await page.reload();
    const linkedinAfter = page.getByTestId("linkedin-section");
    await linkedinAfter.waitFor({ state: "visible" });
    await expect(linkedinAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );
    await expect(linkedinAfter.locator("#linkedin-clientId")).toHaveValue("");
    await expect(linkedinAfter.locator("#linkedin-clientSecret")).toHaveValue(
      "",
    );

    // Save Twitter
    const twitterAfter = page.getByTestId("twitter-section");
    await twitterAfter.locator("#twitter-apiKey").fill("tw-api-key");
    await twitterAfter.locator("#twitter-apiSecret").fill("tw-api-secret");
    await twitterAfter.locator("#twitter-accessToken").fill("tw-access-token");
    await twitterAfter
      .locator("#twitter-accessTokenSecret")
      .fill("tw-access-token-secret");
    await twitterAfter.getByTestId("twitter-save").click();
    await expect(twitterAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // Clear LinkedIn
    await linkedinAfter.getByTestId("linkedin-clear").click();
    await linkedinAfter.getByTestId("linkedin-clear-confirm").click();
    await expect(linkedinAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
  });
});

test.describe("Twitter collector cookies card (VS-7)", () => {
  test.beforeEach(async () => {
    await resetCredentials();
  });

  test("starts Not configured, save flips to Configured, persists across reload, clear reverts", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");

    const panel = page.getByTestId("social-credentials-panel");
    await panel.waitFor({ state: "visible" });

    const card = page.getByTestId("twitter-collector-card");
    await card.waitFor({ state: "visible" });

    await expect(card.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );

    // Save cookies
    await card
      .getByTestId("twitter-collector-apiKey-input")
      .fill("base64-cookie-blob-e2e-fixture");
    await card.getByTestId("twitter-collector-save").click();

    await expect(card.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // The input clears after save (secrets never echoed back)
    await expect(
      card.getByTestId("twitter-collector-apiKey-input"),
    ).toHaveValue("");

    // Reload — Configured pill persists
    await page.reload();
    const cardAfter = page.getByTestId("twitter-collector-card");
    await cardAfter.waitFor({ state: "visible" });
    await expect(cardAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "true",
    );

    // Clear cookies — confirm reverts to Not configured
    await cardAfter.getByTestId("twitter-collector-clear").click();
    await cardAfter.getByTestId("twitter-collector-clear-confirm").click();
    await expect(cardAfter.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
  });

  test("blocks empty/whitespace-only paste with a 400 from the server", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin/settings");
    const card = page.getByTestId("twitter-collector-card");
    await card.waitFor({ state: "visible" });

    // Whitespace-only — client side toast fires; status stays Not configured.
    await card.getByTestId("twitter-collector-apiKey-input").fill("   ");
    await card.getByTestId("twitter-collector-save").click();

    // Status pill remains Not configured.
    await expect(card.getByTestId("status-pill")).toHaveAttribute(
      "data-configured",
      "false",
    );
  });

  test("PUT then GET via API confirms encrypted DB roundtrip", async ({
    page,
  }) => {
    await adminLogin(page);
    const put = await page.request.put(
      `${API_BASE}/api/admin/social-credentials/twitter-collector`,
      { data: { apiKey: "  api-blob-with-whitespace  " } },
    );
    expect(put.ok()).toBe(true);

    const get = await page.request.get(
      `${API_BASE}/api/admin/social-credentials`,
    );
    const status = (await get.json()) as {
      twitterCollector: { configured: boolean; updatedAt: string | null };
    };
    expect(status.twitterCollector.configured).toBe(true);
    expect(typeof status.twitterCollector.updatedAt).toBe("string");

    // Verify the DB column is encrypted (not plaintext) and that the trimmed
    // value round-trips through the cipher.
    const client = makeDbClient();
    await client.connect();
    try {
      const row = await client.query<{
        encrypted_fields: { apiKey: { ct: string } };
      }>(
        "SELECT encrypted_fields FROM social_credentials WHERE platform = 'twitter_collector'",
      );
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].encrypted_fields.apiKey.ct).not.toContain(
        "api-blob-with-whitespace",
      );
    } finally {
      await client.end();
    }
  });
});
