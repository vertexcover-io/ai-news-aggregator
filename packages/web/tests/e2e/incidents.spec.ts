/**
 * Incidents page e2e — REQ-024, REQ-025, EDGE-010, surfaces REQ-020/023 via UI.
 *
 * VS-2 verification scenarios:
 *   - Page lists incidents with all required fields (REQ-024)
 *   - Empty state when no incidents (EDGE-010)
 *   - Filter by status + severity (REQ-020 via UI)
 *   - Resolve action updates row state (REQ-025)
 *   - Mute action updates row state (REQ-025)
 *   - Unauthenticated access redirects to admin login (REQ-023 via UI)
 *
 * Prereqs (managed by hermetic harness):
 *   - Ephemeral Postgres + Redis
 *   - api dev server
 *   - web dev server
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";

interface SeededIncident {
  id: string;
  title: string;
  severity: string;
  status: string;
  source: string;
  runId: string | null;
}

async function ensureUserSettings(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO user_settings (top_n, shortlist_size, ranking_prompt, shortlist_prompt, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time)
     VALUES (5, 50, 'seed ranking prompt', 'seed shortlist prompt', '08:00', 'UTC', '08:00', '08:00', '08:00')
     ON CONFLICT (singleton) DO NOTHING`,
  );
}

async function seedIncident(
  client: Client,
  opts: {
    severity: string;
    status: string;
    title: string;
    source: string;
    runId?: string | null;
    occurrences?: number;
  },
): Promise<SeededIncident> {
  const id = randomUUID();
  const fingerprint = randomUUID();
  const runId = opts.runId ?? null;
  const occurrences = opts.occurrences ?? 1;
  const now = new Date();
  await client.query(
    `INSERT INTO incidents
       (id, fingerprint, severity, category, title, message, source, run_id, context, status,
        occurrences, delivery_attempts, first_seen_at, last_seen_at)
     VALUES
       ($1, $2, $3, 'worker_crash', $4, 'Test message', $5, $6, '{}'::jsonb, $7,
        $8, 0, $9, $9)`,
    [
      id,
      fingerprint,
      opts.severity,
      opts.title,
      opts.source,
      runId,
      opts.status,
      occurrences,
      now,
    ],
  );
  return { id, title: opts.title, severity: opts.severity, status: opts.status, source: opts.source, runId };
}

interface SeedResult {
  criticalWithRun: SeededIncident;
  criticalNoRun: SeededIncident;
  warningOpen: SeededIncident;
  resolvedIncident: SeededIncident;
}

async function seedAll(): Promise<SeedResult> {
  const client = makeDbClient();
  await client.connect();
  try {
    await ensureUserSettings(client);
    const runId = randomUUID();
    const criticalWithRun = await seedIncident(client, {
      severity: "critical",
      status: "open",
      title: "Worker crashed with run",
      source: "pipeline",
      runId,
      occurrences: 3,
    });
    const criticalNoRun = await seedIncident(client, {
      severity: "critical",
      status: "open",
      title: "API server crash",
      source: "api",
      runId: null,
    });
    const warningOpen = await seedIncident(client, {
      severity: "warning",
      status: "open",
      title: "Enrichment failure rate high",
      source: "enrichment",
      runId: null,
    });
    const resolvedIncident = await seedIncident(client, {
      severity: "error",
      status: "resolved",
      title: "Job failed (already resolved)",
      source: "queue",
      runId: null,
    });
    return { criticalWithRun, criticalNoRun, warningOpen, resolvedIncident };
  } finally {
    await client.end();
  }
}

async function cleanupIncidents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const client = makeDbClient();
  await client.connect();
  try {
    await client.query(
      `DELETE FROM incidents WHERE id = ANY($1::uuid[])`,
      [ids],
    );
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

test.describe("Incidents page e2e (REQ-024, REQ-025, EDGE-010, REQ-020/023)", () => {
  let seeded: SeedResult;
  let seededIds: string[];

  test.beforeAll(async () => {
    seeded = await seedAll();
    seededIds = [
      seeded.criticalWithRun.id,
      seeded.criticalNoRun.id,
      seeded.warningOpen.id,
      seeded.resolvedIncident.id,
    ];
  });

  test.afterAll(async () => {
    await cleanupIncidents(seededIds);
  });

  test("test_REQ_024_incidents_page_lists_rows: page renders incidents with required fields", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/incidents");

    // Page heading
    await expect(page.getByRole("heading", { level: 1, name: /incidents/i })).toBeVisible();

    // Rows visible for open incidents (default filter = open)
    const row1 = page.getByRole("row", { name: /Worker crashed with run/i });
    await expect(row1).toBeVisible();

    // Severity badge visible
    await expect(row1.getByText(/critical/i)).toBeVisible();

    // Source visible — use getByRole("cell") to avoid the duplicate sub-div in the title cell
    await expect(row1.getByRole("cell", { name: "pipeline", exact: true })).toBeVisible();

    // Occurrences visible (3)
    await expect(row1.getByText("3")).toBeVisible();

    // Status badge visible
    await expect(row1.getByText(/open/i)).toBeVisible();

    // Run link present when runId is set
    const runLink = row1.getByRole("link", { name: /run/i });
    await expect(runLink).toBeVisible();

    // Row without runId should NOT have a run link
    const row2 = page.getByRole("row", { name: /API server crash/i });
    await expect(row2).toBeVisible();
    await expect(row2.getByRole("link", { name: /run/i })).toHaveCount(0);
  });

  test("test_EDGE_010_empty_incidents_empty_state: empty DB shows empty state not error", async ({ page }) => {
    // Temporarily delete all incidents to test empty state
    const client = makeDbClient();
    await client.connect();
    try {
      await client.query("DELETE FROM incidents");
    } finally {
      await client.end();
    }

    await adminLogin(page);
    await page.goto("/admin/incidents");

    // Should show empty state, not an error
    await expect(page.getByText(/no incidents/i)).toBeVisible();
    // Ensure no "Failed to load" error message is visible (severity filter options contain "error" text but that's ok)
    await expect(page.getByText(/failed to load/i)).toHaveCount(0);

    // Re-seed after this test
    seeded = await seedAll();
    seededIds = [
      seeded.criticalWithRun.id,
      seeded.criticalNoRun.id,
      seeded.warningOpen.id,
      seeded.resolvedIncident.id,
    ];
  });

  test("test_REQ_020_list_incidents_filtered: filter open + critical shows only matching rows", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/incidents");

    // Select critical severity filter
    const severitySelect = page.getByLabel(/severity/i);
    await severitySelect.selectOption("critical");

    // Should show critical open rows
    await expect(page.getByRole("row", { name: /Worker crashed with run/i })).toBeVisible();
    await expect(page.getByRole("row", { name: /API server crash/i })).toBeVisible();

    // Warning row should not be visible
    await expect(page.getByRole("row", { name: /Enrichment failure rate high/i })).toHaveCount(0);
  });

  test("test_REQ_025_resolve_mute_updates_row: Resolve action updates row status", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/incidents");

    // Find the warning open row (criticalNoRun) and click Resolve
    const row = page.getByRole("row", { name: /API server crash/i });
    await expect(row).toBeVisible();

    const resolveButton = row.getByRole("button", { name: /resolve/i });

    // Register the promise BEFORE clicking to avoid a race
    const patchResponse = page.waitForResponse(
      (res) => res.url().includes("/api/admin/incidents") && res.request().method() === "PATCH",
    );
    await resolveButton.click();
    await patchResponse;

    // The row should either be gone (since it's now resolved and filter=open) or show resolved
    await expect(page.getByRole("row", { name: /API server crash/i })).toHaveCount(0);
  });

  test("test_REQ_025_mute_updates_row: Mute action updates row status", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/admin/incidents");

    // Find the warningOpen row and click Mute
    const row = page.getByRole("row", { name: /Enrichment failure rate high/i });
    await expect(row).toBeVisible();

    const muteButton = row.getByRole("button", { name: /mute/i });

    // Register before clicking to avoid race
    const patchResponse = page.waitForResponse(
      (res) => res.url().includes("/api/admin/incidents") && res.request().method() === "PATCH",
    );
    await muteButton.click();
    await patchResponse;

    // Row should leave the open filter (now muted)
    await expect(page.getByRole("row", { name: /Enrichment failure rate high/i })).toHaveCount(0);
  });

  test("test_REQ_023_incidents_unauthenticated_redirects: unauthenticated goto redirects to admin login", async ({ page }) => {
    // Clear cookies to ensure unauthenticated state
    await page.context().clearCookies();
    await page.goto("/admin/incidents");

    // Should be redirected to admin login
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
