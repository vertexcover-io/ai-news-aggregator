/**
 * Edit-after-review e2e — Phase 2: "Edit newsletter" kebab menu item gating.
 * Traces: REQ-001, REQ-002, EDGE-003, EDGE-004 (VS-1 steps 1-3, VS-2)
 *
 * Prereqs (managed by functional-verify):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const API_BASE = "http://localhost:3000";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "vertexcover@123";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://newsletter:newsletter@localhost:5434/newsletter";

interface SeededArchives {
  reviewedRunId: string;
  unreviewedRunId: string;
  dryRunId: string;
}

async function ensureUserSettings(client: Client): Promise<void> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*) FROM user_settings`,
  );
  if (result.rows[0]?.count === "0") {
    await client.query(
      `INSERT INTO user_settings (top_n, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time, ranking_prompt, shortlist_prompt)
       VALUES (5, '08:00', 'UTC', '08:00', '08:00', '08:00', 'rank these items', 'shortlist these items')`,
    );
  }
}

async function seedArchives(): Promise<SeededArchives> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await ensureUserSettings(client);

    // Use far-future completed_at so our rows appear at the top of the dashboard
    const futureBase = new Date(Date.UTC(2099, 5, 1));
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

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
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
