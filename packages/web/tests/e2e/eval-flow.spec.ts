/**
 * Eval index page e2e — Phase 8.
 *
 * Prereqs (same as admin-ranking-prompt.spec.ts):
 *   - `pnpm infra:up`
 *   - `pnpm --filter @newsletter/shared db:migrate`
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 *
 * Note: this test stubs the SSE `/api/admin/eval/run` endpoint via Playwright
 * route fulfillment so it can run without Anthropic credentials or live
 * fixtures. The page itself, the diff modal, and the prompt save mutation are
 * exercised end-to-end against the real api server.
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { DEFAULT_RANKING_PROMPT } from "@newsletter/shared/constants";

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "aman2005";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@localhost:5433/newsletter";

const SCREENSHOT_DIR =
  "../../docs/spec/ranking-eval-pipeline/verification/screenshots";

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post("/api/admin/login", {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

async function seedDefaultViaUi(page: Page): Promise<void> {
  await adminLogin(page);
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Reset to default" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible({
    timeout: 10_000,
  });
}

async function cleanupSingleton(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM user_settings WHERE singleton = true`);
  } finally {
    await client.end();
  }
}

test.describe("eval index page", () => {
  test.beforeEach(async () => {
    await cleanupSingleton();
  });
  test.afterEach(async () => {
    await cleanupSingleton();
  });

  test("loads with saved prompt, opens diff modal, saves draft", async ({
    page,
  }) => {
    await seedDefaultViaUi(page);

    await page.goto("/admin/eval");

    const ta = page.getByTestId("prompt-editor-textarea");
    await expect(ta).toBeVisible();
    await expect(ta).toHaveValue(DEFAULT_RANKING_PROMPT);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/eval-page-initial.png`,
      fullPage: true,
    });

    // Tabs render.
    await expect(page.getByRole("tab", { name: /Mode A/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Mode B/ })).toBeVisible();

    // Stub the SSE run endpoint with three SSE events (progress, aggregate, done).
    await page.route("**/api/admin/eval/run", async (route) => {
      const body = [
        'event: progress',
        'data: {"fixtureId":"fx-stub","status":"done","score":{"fixtureId":"fx-stub","ndcgAt10":0.85,"precisionAt10":0.7,"mustIncludeRecall":0.6,"rankOneIsMustInclude":true,"perItemDiff":[],"ranAt":"2026-05-22T00:00:00Z","promptHash":"abc","model":"claude-haiku-4-5-20251001"},"cost":{"promptHash":"abc","tokensIn":100,"tokensOut":50,"usd":0.0123,"cacheHit":false}}',
        '',
        'event: aggregate',
        'data: {"totalCost":{"usd":0.0123}}',
        '',
        'event: done',
        'data: {"totalCost":{"usd":0.0123}}',
        '',
      ].join("\n");
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body,
      });
    });

    // Edit prompt to make it dirty.
    await ta.fill(DEFAULT_RANKING_PROMPT + "\n\n# eval-test extra line");

    // Open diff modal.
    await page
      .getByRole("button", { name: /save as current prompt/i })
      .click();
    await expect(page.getByTestId("prompt-diff-body")).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/eval-save-modal.png`,
      fullPage: true,
    });

    // Cancel (so we don't mutate prompt mid-test).
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByTestId("prompt-diff-body")).not.toBeVisible();

    // Take post-render screenshot for the verification log.
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/eval-page-after-run.png`,
      fullPage: true,
    });
  });
});
