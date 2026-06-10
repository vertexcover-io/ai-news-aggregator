/**
 * Edit-after-review e2e — Phase 2 + Phase 3.
 * Phase 2 traces: REQ-001, REQ-002, EDGE-003, EDGE-004 (VS-1 steps 1-3, VS-2)
 * Phase 3 traces: REQ-005, REQ-006, EDGE-005, EDGE-006 (VS-1 steps 3-5)
 * Phase 3 (new): EDGE-004 dry-run reorder+save (REQ-009, REQ-010)
 *
 * Prereqs (managed by functional-verify):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";


interface SeededArchives {
  reviewedRunId: string;
  unreviewedRunId: string;
  dryRunId: string;
}

interface SeededEditArchive {
  runId: string;
  originalTitle: string;
}

async function seedEditArchive(): Promise<SeededEditArchive> {
  const client = makeDbClient();
  await client.connect();
  try {
    await ensureUserSettings(client);
    // Use 2199 (not 2099) to stay ahead of any pre-existing 2099 test seed rows.
    const futureBase = new Date(Date.UTC(2199, 11, 1));
    const t = (n: number): Date => new Date(futureBase.getTime() + n * 60_000);

    // Insert a raw_items row so hydrateRankedItems can find it
    const externalId = `edit-test-${String(Date.now())}`;
    const rawItemResult = await client.query<{ id: number }>(
      `INSERT INTO raw_items (url, title, source_type, external_id, collected_at, metadata)
       VALUES ('https://example.com/story-edit-test', 'Original Story Title For Edit Test', 'hn', $1, now(), '{"comments":[]}'::jsonb)
       RETURNING id`,
      [externalId],
    );
    const rawItemId = rawItemResult.rows[0]?.id;
    if (!rawItemId) throw new Error("Failed to insert raw_item");

    const originalTitle = "Original Story Title For Edit Test";
    // RankedItemRef: rawItemId references the raw_items row, title override
    const rankedItems = JSON.stringify([
      { rawItemId, score: 0.9, rationale: "test", title: originalTitle },
    ]);

    const runId = randomUUID();
    await client.query(
      `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, is_dry_run, completed_at, email_sent_at, started_at)
       VALUES ($1, 'completed', $2::jsonb, 5, true, false, $3::timestamptz, $4::timestamptz, $5::timestamptz)`,
      [runId, rankedItems, t(10), t(11), t(9)],
    );

    return { runId, originalTitle };
  } finally {
    await client.end();
  }
}

async function ensureUserSettings(client: Client): Promise<void> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*) FROM user_settings`,
  );
  if (result.rows[0]?.count === "0") {
    await client.query(
      `INSERT INTO user_settings (top_n, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time, ranking_prompt, shortlist_prompt, shortlist_size)
       VALUES (5, '08:00', 'UTC', '08:00', '08:00', '08:00', 'rank these items', 'shortlist these items', 20)`,
    );
  }
}

async function seedArchives(): Promise<SeededArchives> {
  const client = makeDbClient();
  await client.connect();
  try {
    await ensureUserSettings(client);

    // Use far-future completed_at so our rows appear at the top of the dashboard.
    // Use 2199 (not 2099) to stay ahead of any pre-existing 2099 test seed rows.
    const futureBase = new Date(Date.UTC(2199, 11, 1));
    const t = (n: number): Date => new Date(futureBase.getTime() + n * 60_000);

    const reviewedId = randomUUID();
    await client.query(
      `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, is_dry_run, completed_at)
       VALUES ($1, 'completed', '[]'::jsonb, 5, true, false, $2::timestamptz)`,
      [reviewedId, t(1)],
    );

    const unreviewedId = randomUUID();
    await client.query(
      `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, is_dry_run, completed_at)
       VALUES ($1, 'completed', '[]'::jsonb, 5, false, false, $2::timestamptz)`,
      [unreviewedId, t(2)],
    );

    const dryRunId = randomUUID();
    await client.query(
      `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, is_dry_run, completed_at)
       VALUES ($1, 'completed', '[]'::jsonb, 5, true, true, $2::timestamptz)`,
      [dryRunId, t(3)],
    );

    return { reviewedRunId: reviewedId, unreviewedRunId: unreviewedId, dryRunId };
  } finally {
    await client.end();
  }
}

async function seedDryRunWithItems(): Promise<{ runId: string }> {
  const client = makeDbClient();
  await client.connect();
  try {
    await ensureUserSettings(client);
    const futureBase = new Date(Date.UTC(2299, 11, 1));
    const t = (n: number): Date => new Date(futureBase.getTime() + n * 60_000);

    // Insert two raw_items
    const rawItem1Result = await client.query<{ id: number }>(
      `INSERT INTO raw_items (url, title, source_type, external_id, collected_at, metadata)
       VALUES ('https://example.com/dry-item-1', 'Dry Run Story Alpha', 'hn', $1, now(), '{}'::jsonb)
       RETURNING id`,
      [`dry-e2e-1-${String(Date.now())}`],
    );
    const rawItem2Result = await client.query<{ id: number }>(
      `INSERT INTO raw_items (url, title, source_type, external_id, collected_at, metadata)
       VALUES ('https://example.com/dry-item-2', 'Dry Run Story Beta', 'hn', $1, now(), '{}'::jsonb)
       RETURNING id`,
      [`dry-e2e-2-${String(Date.now())}`],
    );
    const id1 = rawItem1Result.rows[0]?.id;
    const id2 = rawItem2Result.rows[0]?.id;
    if (!id1 || !id2) throw new Error("Failed to insert raw_items");

    const rankedItems = JSON.stringify([
      { rawItemId: id1, score: 0.9, rationale: "test", title: "Dry Run Story Alpha" },
      { rawItemId: id2, score: 0.8, rationale: "test", title: "Dry Run Story Beta" },
    ]);

    const runId = randomUUID();
    await client.query(
      `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, is_dry_run, completed_at, started_at)
       VALUES ($1, 'completed', $2::jsonb, 5, true, true, $3::timestamptz, $4::timestamptz)`,
      [runId, rankedItems, t(10), t(9)],
    );
    return { runId };
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

async function openKebabMenuForRun(page: Page, runId: string): Promise<void> {
  const row = page.locator(`[data-run-id="${runId}"]`).first();
  await row.waitFor({ state: "visible" });
  await row.getByRole("button", { name: /more actions/i }).click();
}

test.describe("Edit-after-review kebab menu gating (Phase 2)", () => {
  let seeded: SeededArchives;

  test.beforeAll(async () => {
    seeded = await seedArchives();
  });

  // REQ-001: reviewed run → "Edit newsletter" enabled → click navigates to /admin/review/:runId
  test("REQ-001: reviewed run shows enabled Edit newsletter item that navigates", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");

    await openKebabMenuForRun(page, seeded.reviewedRunId);

    const editItem = page.getByRole("menuitem", { name: /edit newsletter/i });
    await expect(editItem).toBeVisible();
    await expect(editItem).not.toHaveAttribute("aria-disabled", "true");

    await editItem.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/review/${seeded.reviewedRunId}`),
    );
  });

  // REQ-002: unreviewed completed run → "Edit newsletter" disabled, no navigation
  test("REQ-002: unreviewed run shows disabled Edit newsletter item that does not navigate", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");

    await openKebabMenuForRun(page, seeded.unreviewedRunId);

    const editItem = page.getByRole("menuitem", { name: /edit newsletter/i });
    await expect(editItem).toBeVisible();
    await expect(editItem).toHaveAttribute("aria-disabled", "true");

    // Click disabled item — URL should remain on /admin
    await editItem.click({ force: true });
    await expect(page).toHaveURL("/admin");
  });

  // EDGE-003: dry-run + reviewed → Edit newsletter enabled (dry runs included)
  test("EDGE-003: dry-run reviewed archive shows enabled Edit newsletter item", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");

    await openKebabMenuForRun(page, seeded.dryRunId);

    const editItem = page.getByRole("menuitem", { name: /edit newsletter/i });
    await expect(editItem).toBeVisible();
    await expect(editItem).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("Edit-after-review page mode (Phase 3)", () => {
  let editArchive: SeededEditArchive;

  test.beforeAll(async () => {
    editArchive = await seedEditArchive();
  });

  // REQ-005 + REQ-006 + VS-1 steps 3-4: Edit heading + banner for sent archive
  test("REQ-005/REQ-006: navigating to reviewed+sent archive shows Edit heading and banner", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto(`/admin/review/${editArchive.runId}`);

    // heading should read "Edit · <date>"
    const heading = page.getByRole("heading", { level: 2 });
    await expect(heading).toHaveText(/^Edit · /);

    // banner should list Email since email_sent_at is set
    const banner = page.getByTestId("published-channels-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Email");
  });

  // VS-3: EDGE-004 — dry-run reorder + save (REQ-009, REQ-010)
  // Regenerate must be disabled (dry-run reason), Save must be enabled after reorder, PATCH succeeds.
  test("test_EDGE_004_dry_run_review_edit_saves — dry-run: reorder → Regenerate disabled → Save enabled → PATCH succeeds", async ({
    page,
  }) => {
    const { runId } = await seedDryRunWithItems();
    await adminLogin(page);
    await page.goto(`/admin/review/${runId}`);

    // Verify dry-run pill is present
    const dryRunPill = page.getByTestId("dry-run-pill");
    await expect(dryRunPill).toBeVisible();

    // Wait for items to render
    await expect(page.getByText("Dry Run Story Alpha")).toBeVisible();
    await expect(page.getByText("Dry Run Story Beta")).toBeVisible();

    // Regenerate should be disabled with dry-run reason on load
    const regenBtn = page.getByRole("button", { name: /regenerate/i });
    await expect(regenBtn).toBeDisabled();

    // Remove the second item to change the ranked list
    const deleteButtons = page.getByRole("button", { name: /delete|remove/i });
    await deleteButtons.last().click();

    // After deletion: Regenerate still disabled (dry-run), Save should be enabled
    await expect(regenBtn).toBeDisabled();
    const saveBtn = page.getByRole("button", { name: /save & view archive/i });
    await expect(saveBtn).toBeEnabled();

    // Click Save — the stale-digest confirm dialog appears instead of saving directly
    await saveBtn.click();
    await expect(page.getByTestId("save-confirmation-message")).toBeVisible();
    await page.getByRole("button", { name: /save anyway/i }).click();

    // Should navigate to /archive/:runId after successful PATCH
    await expect(page).toHaveURL(new RegExp(`/archive/${runId}`), { timeout: 10000 });
  });

  // VS-1 steps 3-5: change a story title, Save, verify edited title on /archive/:runId
  test("REQ-005/EDGE-005: edit mode save updates archive — edited title visible on public archive", async ({
    page,
  }) => {
    const editedTitle = "Edited Title After Review";
    await adminLogin(page);
    await page.goto(`/admin/review/${editArchive.runId}`);

    // Wait for the edit page to load — heading must show Edit ·
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(/^Edit · /);

    // The review card title is rendered as an EditableField (a div[role="button"]):
    // click it to enter editing mode, then type the new title.
    // The title text is the first editable field in the article card.
    const titleText = page.getByText(editArchive.originalTitle).first();
    await titleText.click();

    // Now an input is visible — clear and fill with the new title
    const titleInput = page.locator('article input[type="text"]').first();
    await titleInput.fill(editedTitle);
    await titleInput.press("Enter");

    // Click Save & View Archive
    const saveBtn = page.getByRole("button", { name: /save/i });
    await saveBtn.click();

    // After save, should navigate to /archive/:runId
    await expect(page).toHaveURL(new RegExp(`/archive/${editArchive.runId}`));

    // The public archive page should display the edited title.
    // ArchiveStoryCard renders story titles as <h2>, not <h1>.
    await expect(page.getByRole("heading", { name: editedTitle, level: 2 })).toBeVisible();
  });
});
