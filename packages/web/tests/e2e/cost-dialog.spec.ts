/**
 * CostDialog e2e — REQ-064, REQ-065, REQ-066, REQ-069, EDGE-005, EDGE-010 + VS-2/VS-3.
 *
 * Prereqs (managed by functional-verify):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { adminLogin, makeDbClient } from "./_infra";


interface SeededRun {
  runId: string;
  totalCostUsd: number | null;
}

interface BuildOptions {
  totalCostUsd: number;
  rankByModelCount: 1 | 2;
}

function buildBreakdown(opts: BuildOptions): unknown {
  const byModel =
    opts.rankByModelCount === 2
      ? [
          {
            modelId: "claude-haiku-4-5-20251001",
            calls: 2,
            costUsd: opts.totalCostUsd / 2,
            inputTokens: 12000,
            outputTokens: 3000,
            cachedInputTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
          {
            modelId: "claude-sonnet-4-5-20251001",
            calls: 1,
            costUsd: opts.totalCostUsd / 2,
            inputTokens: 8000,
            outputTokens: 2500,
            cachedInputTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
        ]
      : [
          {
            modelId: "claude-haiku-4-5-20251001",
            calls: 1,
            costUsd: opts.totalCostUsd,
            inputTokens: 12000,
            outputTokens: 3000,
            cachedInputTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
        ];
  const calls = byModel.reduce((s, m) => s + m.calls, 0);
  return {
    schemaVersion: 1,
    totalCostUsd: opts.totalCostUsd,
    stages: {
      rank: {
        calls,
        costUsd: opts.totalCostUsd,
        costStatus: "ok",
        byModel,
      },
    },
    unknownModels: [],
    generatedAt: new Date().toISOString(),
  };
}

async function seedRun(
  client: Client,
  costBreakdown: unknown,
  completedAt: Date,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO run_archives (id, status, ranked_items, top_n, reviewed, completed_at, cost_breakdown)
     VALUES ($1, 'completed', '[]'::jsonb, 5, true, $3::timestamp, $2::jsonb)`,
    [id, costBreakdown === null ? null : JSON.stringify(costBreakdown), completedAt],
  );
  return id;
}

interface SeedResult {
  runWithBreakdown: SeededRun;
  preFeatureRun: SeededRun;
  twoModelRun: SeededRun;
  runA: SeededRun;
  runB: SeededRun;
}

async function ensureUserSettings(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO user_settings (top_n, shortlist_size, ranking_prompt, shortlist_prompt, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time)
     VALUES (5, 50, 'seed ranking prompt', 'seed shortlist prompt', '08:00', 'UTC', '08:00', '08:00', '08:00')
     ON CONFLICT (singleton) DO NOTHING`,
  );
}

async function seedAll(): Promise<SeedResult> {
  const client = makeDbClient();
  await client.connect();
  try {
    await ensureUserSettings(client);
    // Seed with completed_at far in the future so these rows top the dashboard
    // (default limit=30) regardless of other test data already in the DB.
    const futureBase = new Date(Date.UTC(2099, 0, 1));
    const breakdown = buildBreakdown({
      totalCostUsd: 0.637,
      rankByModelCount: 1,
    });
    const twoModel = buildBreakdown({
      totalCostUsd: 0.555,
      rankByModelCount: 2,
    });
    const a = buildBreakdown({ totalCostUsd: 0.111, rankByModelCount: 1 });
    const b = buildBreakdown({ totalCostUsd: 0.222, rankByModelCount: 1 });
    const t = (n: number): Date => new Date(futureBase.getTime() + n * 60_000);
    const id1 = await seedRun(client, breakdown, t(1));
    const id2 = await seedRun(client, null, t(2));
    const id3 = await seedRun(client, twoModel, t(3));
    const idA = await seedRun(client, a, t(4));
    const idB = await seedRun(client, b, t(5));
    return {
      runWithBreakdown: { runId: id1, totalCostUsd: 0.637 },
      preFeatureRun: { runId: id2, totalCostUsd: null },
      twoModelRun: { runId: id3, totalCostUsd: 0.555 },
      runA: { runId: idA, totalCostUsd: 0.111 },
      runB: { runId: idB, totalCostUsd: 0.222 },
    };
  } finally {
    await client.end();
  }
}


async function openCostDialogFor(page: Page, runId: string): Promise<void> {
  const row = page.locator(`[data-run-id="${runId}"]`).first();
  await row.waitFor({ state: "visible" });
  await row.getByTestId("cost-button").click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
}

async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

test.describe("CostDialog e2e (REQ-064..REQ-069, EDGE-005/010)", () => {
  let seeded: SeedResult;

  test.beforeAll(async () => {
    seeded = await seedAll();
  });

  test("VS-2 / REQ-064: dialog with populated breakdown shows 8 column headers", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await openCostDialogFor(page, seeded.runWithBreakdown.runId);

    const dialog = page.getByRole("dialog");
    for (const header of [
      "Stage",
      "Calls",
      "In tok",
      "Out tok",
      "Cached",
      "Thinking",
      "Model",
      "Cost",
    ]) {
      await expect(
        dialog.getByRole("columnheader", { name: header }),
      ).toBeVisible();
    }
    await expect(dialog.getByText(/Total:\s*\$0\.637/)).toBeVisible();
  });

  test("VS-3 / REQ-065: pre-feature run shows empty state copy", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await openCostDialogFor(page, seeded.preFeatureRun.runId);
    await expect(
      page.getByRole("dialog").getByText(/Cost tracking was added on/i),
    ).toBeVisible();
  });

  test("REQ-066 / EDGE-005: two-model rank stage renders 3 rows (aggregate + 2 sub)", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");
    await openCostDialogFor(page, seeded.twoModelRun.runId);
    const rows = page.locator('tr[data-stage="rank"]');
    await expect(rows).toHaveCount(3);
  });

  test("EDGE-010: open A, close, open B shows B's total (no stale data)", async ({
    page,
  }) => {
    await adminLogin(page);
    await page.goto("/admin");

    await openCostDialogFor(page, seeded.runA.runId);
    await expect(
      page.getByRole("dialog").getByText(/Total:\s*\$0\.111/),
    ).toBeVisible();

    await closeDialog(page);

    await openCostDialogFor(page, seeded.runB.runId);
    await expect(
      page.getByRole("dialog").getByText(/Total:\s*\$0\.222/),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText(/Total:\s*\$0\.111/),
    ).toHaveCount(0);
  });

  test("REQ-069: public routes do not render any cost-button", async ({
    page,
  }) => {
    await page.context().clearCookies();
    for (const path of ["/", `/archive/${seeded.runWithBreakdown.runId}`]) {
      await page.goto(path);
      await expect(page.getByTestId("cost-button")).toHaveCount(0);
    }
  });
});
