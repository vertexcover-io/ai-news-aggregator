import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";
import type { Page } from "@playwright/test";

// ─── Legacy env-var-gated test ──────────────────────────────────────────────

const legacyRunId = process.env.REVIEW_RUN_ID;

test.describe("legacy save & view archive (REVIEW_RUN_ID env only)", () => {
  test.skip(!legacyRunId, "REVIEW_RUN_ID not set");

  test("save & view archive navigates to /archive/:runId (REQ-151)", async ({
    page,
  }) => {
    const runId = legacyRunId ?? "";
    await page.goto(`/admin/review/${runId}`);
    await expect(page.getByRole("article").first()).toBeVisible({
      timeout: 15_000,
    });
    // Perform a trivial reorder to make save eligible and cause a visible change.
    const firstHandle = page.getByLabel("Drag to reorder").first();
    await firstHandle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");

    await page
      .getByRole("button", { name: /save & publish/i })
      .click();
    // Reordering leaves the digest meta stale — confirm the save-anyway dialog.
    await page.getByRole("button", { name: /save anyway/i }).click();
    await expect(page).toHaveURL(new RegExp(`/archive/${runId}$`));
  });
});

// ─── VS-1: Draft-save e2e (self-seeding) ─────────────────────────────────────

async function ensureUserSettings(): Promise<void> {
  const client = makeDbClient();
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM user_settings`,
    );
    if (result.rows[0]?.count === "0") {
      await client.query(
        `INSERT INTO user_settings (top_n, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time, ranking_prompt, shortlist_prompt, shortlist_size)
         VALUES (5, '08:00', 'UTC', '08:00', '08:00', '08:00', 'rank these items', 'shortlist these items', 20)`,
      );
    }
  } finally {
    await client.end();
  }
}

interface SeededDraftRun {
  runId: string;
  title1: string;
  title2: string;
}

async function seedUnreviewedRunWithItems(): Promise<SeededDraftRun> {
  const client = makeDbClient();
  await client.connect();
  try {
    await ensureUserSettings();

    // Use far-future timestamps so rows appear at top of dashboard list
    const futureBase = new Date(Date.UTC(2399, 11, 1));
    const t = (n: number): Date => new Date(futureBase.getTime() + n * 60_000);

    const title1 = `Draft E2E Story Alpha ${String(Date.now())}`;
    const title2 = `Draft E2E Story Beta ${String(Date.now())}`;

    const raw1 = await client.query<{ id: number }>(
      `INSERT INTO raw_items (url, title, source_type, external_id, collected_at, metadata)
       VALUES ($1, $2, 'hn', $3, now(), '{}'::jsonb) RETURNING id`,
      [`https://example.com/draft-a-${String(Date.now())}`, title1, `draft-e2e-a-${String(Date.now())}`],
    );
    const raw2 = await client.query<{ id: number }>(
      `INSERT INTO raw_items (url, title, source_type, external_id, collected_at, metadata)
       VALUES ($1, $2, 'hn', $3, now(), '{}'::jsonb) RETURNING id`,
      [`https://example.com/draft-b-${String(Date.now())}`, title2, `draft-e2e-b-${String(Date.now())}`],
    );
    const id1 = raw1.rows[0]?.id;
    const id2 = raw2.rows[0]?.id;
    if (!id1 || !id2) throw new Error("Failed to insert raw_items");

    const rankedItems = JSON.stringify([
      { rawItemId: id1, score: 0.9, rationale: "test", title: title1 },
      { rawItemId: id2, score: 0.8, rationale: "test", title: title2 },
    ]);

    const runId = randomUUID();
    await client.query(
      `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, is_dry_run, completed_at, started_at)
       VALUES ($1, 'completed', $2::jsonb, 5, false, false, $3::timestamptz, $4::timestamptz)`,
      [runId, rankedItems, t(10), t(9)],
    );
    return { runId, title1, title2 };
  } finally {
    await client.end();
  }
}

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

test.describe("VS-1: Draft-save flow (REQ-015)", () => {
  let seeded: SeededDraftRun;

  test.beforeAll(async () => {
    seeded = await seedUnreviewedRunWithItems();
  });

  /**
   * test_REQ_015_draft_save_stays_and_toasts
   *
   * Full VS-1 walk:
   * 1. Open review page for unreviewed run → both buttons visible (L2: assert h2)
   * 2. Click Save draft → "Draft saved" toast; unsaved counter = 0; URL stays
   * 3. Go to /admin → run shows "Draft" badge with Review CTA
   * 4. Confirm run is absent from public "/" (not reviewed → not public)
   * 5. Reopen → edits rehydrated (run reopens successfully)
   */
  test("test_REQ_015_draft_save_stays_and_toasts", async ({ page }) => {
    await adminLogin(page);
    const { runId, title1 } = seeded;

    // ── Step 1: Open review page ─────────────────────────────────────────────
    await page.goto(`/admin/review/${runId}`);

    // L2: assert the actual rendered h2 heading
    const heading = page.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText(/^Review · /, { timeout: 15_000 });

    // Wait for items to load
    await expect(page.getByText(title1)).toBeVisible({ timeout: 10_000 });

    // Both buttons should be visible (REQ-013)
    const saveDraftBtn = page.getByRole("button", { name: /save draft/i });
    const savePublishBtn = page.getByRole("button", { name: /save & publish/i });
    await expect(saveDraftBtn).toBeVisible();
    await expect(savePublishBtn).toBeVisible();

    // ── Step 2: Save draft ───────────────────────────────────────────────────
    await saveDraftBtn.click();

    // Toast "Draft saved" should appear
    await expect(page.getByText(/draft saved/i)).toBeVisible({ timeout: 8_000 });

    // Unsaved counter resets to 0
    await expect(page.getByText(/^0 unsaved changes/)).toBeVisible({ timeout: 5_000 });

    // URL stays on review page (no navigation)
    await expect(page).toHaveURL(new RegExp(`/admin/review/${runId}`));

    // ── Step 3: Dashboard shows Draft badge + Review CTA ─────────────────────
    await page.goto("/admin");
    const runRow = page.locator(`[data-run-id="${runId}"]`).first();
    await runRow.waitFor({ state: "visible", timeout: 10_000 });

    // Draft badge visible
    await expect(runRow.getByText("Draft")).toBeVisible();

    // Review CTA links to the review page (REQ-012)
    const reviewLink = runRow.getByRole("link", { name: /review/i });
    await expect(reviewLink).toBeVisible();
    await expect(reviewLink).toHaveAttribute("href", new RegExp(`/admin/review/${runId}`));

    // ── Step 4: Absent from public "/" ───────────────────────────────────────
    // Public listing only shows reviewed runs; draft should not appear.
    await page.goto("/");
    // The public page should not contain a link to this runId
    const publicLink = page.locator(`a[href*="${runId}"]`);
    await expect(publicLink).toHaveCount(0);

    // ── Step 5: Reopen and confirm rehydration ───────────────────────────────
    await page.goto(`/admin/review/${runId}`);
    const heading2 = page.getByRole("heading", { level: 2 });
    await expect(heading2).toHaveText(/^Review · /, { timeout: 10_000 });
    // Items still render (draft was persisted)
    await expect(page.getByText(title1)).toBeVisible({ timeout: 10_000 });
  });
});
