/**
 * Admin ranking-prompt e2e — VS-1..VS-4.
 *
 * Prereqs:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @newsletter/shared db:migrate`
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 *
 * Setup strategy: bootstrap the singleton row through the UI (Reset → Save)
 * rather than INSERTing directly, so the DB column-defaults requirement of
 * `user_settings` doesn't have to be mirrored in this test.
 */
import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_RANKING_PROMPT } from "@newsletter/shared/constants";
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeDbClient } from "./_infra";


async function adminLogin(page: Page): Promise<void> {
  // Use the Vite proxy so the session cookie is scoped to the page origin.
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function readPromptFromDb(): Promise<string | null> {
  const client = makeDbClient();
  await client.connect();
  try {
    const res = await client.query<{ ranking_prompt: string }>(
      `SELECT ranking_prompt FROM user_settings WHERE singleton = true`,
    );
    return res.rows[0]?.ranking_prompt ?? null;
  } finally {
    await client.end();
  }
}

async function cleanupSingleton(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(`DELETE FROM user_settings WHERE singleton = true`);
  } finally {
    await client.end();
  }
}

/** Bootstrap the singleton row by saving DEFAULT_RANKING_PROMPT through the UI. */
async function seedDefaultViaUi(page: Page): Promise<void> {
  await adminLogin(page);
  await page.goto("/admin/settings");
  // Reset fills the textarea with DEFAULT_RANKING_PROMPT — guarantees a valid
  // non-empty value that satisfies the API schema regardless of prior state.
  await page.getByTestId("ranking-prompt-reset").click();
  const savePut = page.waitForResponse(
    (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  const resp = await savePut;
  expect(resp.status()).toBe(200);
}

test.describe("Admin ranking prompt (VS-1..VS-4)", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupSingleton();
    await seedDefaultViaUi(page);
  });

  test.afterAll(async () => {
    await cleanupSingleton();
  });

  test("VS-1 + VS-2: round-trips a multi-line value with newlines, backticks, $, and quotes", async ({
    page,
  }) => {
    await page.goto("/admin/settings");

    const textarea = page.locator("#rankingPrompt");
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(DEFAULT_RANKING_PROMPT);

    const updated =
      "UPDATED LINE 1\nLINE 2 with `backticks` and $foo and 'quotes'\nLINE 3 final\nLINE 4 end";
    await textarea.fill(updated);

    await expect(page.getByTestId("ranking-prompt-char-count")).toHaveText(
      `${String(updated.length)} / 20000`,
    );

    const savePut = page.waitForResponse(
      (r) =>
        r.url().includes("/api/settings") && r.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    const resp = await savePut;
    expect(resp.status()).toBe(200);

    // DB has the exact updated string (byte-for-byte, newlines preserved).
    expect(await readPromptFromDb()).toBe(updated);

    // Reload — UI shows the same value.
    await page.reload();
    await expect(page.locator("#rankingPrompt")).toHaveValue(updated);
  });

  test("VS-3: empty submission is rejected client-side and DB stays unchanged", async ({
    page,
  }) => {
    await page.goto("/admin/settings");

    const before = await readPromptFromDb();
    expect(before).toBe(DEFAULT_RANKING_PROMPT);

    const textarea = page.locator("#rankingPrompt");
    await expect(textarea).toHaveValue(DEFAULT_RANKING_PROMPT);
    await textarea.fill("");

    // No PUT should fire — the form schema rejects before the request.
    let putFired = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/settings") && req.method() === "PUT") {
        putFired = true;
      }
    });

    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByTestId("ranking-prompt-error")).toHaveText(
      "Ranking prompt is required",
    );

    // Give a beat for any (incorrectly fired) PUT to land, then assert no PUT.
    await page.waitForTimeout(500);
    expect(putFired).toBe(false);

    // DB unchanged.
    expect(await readPromptFromDb()).toBe(DEFAULT_RANKING_PROMPT);
  });

  test("VS-4: Reset to default populates field client-side without touching the server", async ({
    page,
  }) => {
    // Save a known short prompt first so Reset has something to override.
    await page.goto("/admin/settings");
    const knownShort = "Short test prompt for VS-4.";
    await page.locator("#rankingPrompt").fill(knownShort);
    const savePut = page.waitForResponse(
      (r) =>
        r.url().includes("/api/settings") && r.request().method() === "PUT",
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    await savePut;
    expect(await readPromptFromDb()).toBe(knownShort);

    // Reload to drop any dirty form state and observe the persisted value.
    await page.reload();
    await expect(page.locator("#rankingPrompt")).toHaveValue(knownShort);

    // Reset populates the textarea with DEFAULT_RANKING_PROMPT (client-only).
    await page.getByTestId("ranking-prompt-reset").click();
    await expect(page.locator("#rankingPrompt")).toHaveValue(
      DEFAULT_RANKING_PROMPT,
    );
    await expect(page.getByTestId("ranking-prompt-char-count")).toHaveText(
      `${String(DEFAULT_RANKING_PROMPT.length)} / 20000`,
    );

    // DB still has the short prompt — Reset did NOT issue a PUT.
    expect(await readPromptFromDb()).toBe(knownShort);

    // Navigate away without saving, come back — server value wins.
    await page.goto("/admin");
    await page.goto("/admin/settings");
    await expect(page.locator("#rankingPrompt")).toHaveValue(knownShort);
  });
});
