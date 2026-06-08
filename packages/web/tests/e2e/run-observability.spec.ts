/**
 * Run Observability page e2e — VS-1 (live), VS-2 (historical), VS-3 (failure),
 * VS-4 (legacy/empty) + REQ-031 (dashboard link).
 *
 * Traces to: REQ-020, REQ-021, REQ-022, REQ-031, REQ-033, REQ-034, REQ-035,
 * REQ-037, EDGE-005.
 *
 * Each scenario seeds its run deterministically (Postgres rows + Redis run-state)
 * rather than depending on a full real pipeline run. Seeded rows are cleaned up
 * after the suite.
 *
 * Prereqs (managed by functional-verify / the operator):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - api dev server on :3000 (Vite proxies /api -> :3000)
 *   - web dev server on :5173 (Playwright baseURL)
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ADMIN_PASSWORD, API_BASE, makeDbClient } from "./_infra";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

interface RunLogSeed {
  level: "debug" | "info" | "warn" | "error";
  stage: string;
  source: string | null;
  event: string;
  message: string;
  context: unknown;
}

const seededRunIds = new Set<string>();
const seededRedisKeys = new Set<string>();
const seededRawExternalIds = new Set<string>();

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = makeDbClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureUserSettings(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO user_settings
       (top_n, pipeline_time, schedule_timezone, email_time, linkedin_time, twitter_time,
        ranking_prompt, shortlist_prompt, shortlist_size)
     VALUES (10, '08:00', 'UTC', '08:00', '08:00', '08:00',
             'rank by signal', 'shortlist by title', 40)
     ON CONFLICT (singleton) DO NOTHING`,
  );
}

function redisSet(key: string, value: string): void {
  // Seed Redis run-state directly so live composition has a non-terminal state.
  execFileSync("redis-cli", ["-u", REDIS_URL, "SET", key, value], {
    encoding: "utf8",
  });
  seededRedisKeys.add(key);
}

function redisDel(keys: string[]): void {
  if (keys.length === 0) return;
  execFileSync("redis-cli", ["-u", REDIS_URL, "DEL", ...keys], {
    encoding: "utf8",
  });
}

async function insertRunLogs(
  client: Client,
  runId: string,
  rows: RunLogSeed[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO run_logs (run_id, level, stage, source, event, message, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        runId,
        row.level,
        row.stage,
        row.source,
        row.event,
        row.message,
        row.context === null ? null : JSON.stringify(row.context),
      ],
    );
  }
}

async function insertRawItem(
  client: Client,
  row: {
    runId: string;
    sourceType: "reddit" | "twitter";
    externalId: string;
    title: string;
    url: string;
    author: string;
    points: number;
    commentCount: number;
    metadata?: unknown;
  },
): Promise<number> {
  seededRawExternalIds.add(row.externalId);
  const result = await client.query<{ id: number }>(
    `INSERT INTO raw_items
       (run_id, source_type, external_id, title, url, author, published_at,
        collected_at, engagement, metadata)
     VALUES ($1, $2, $3, $4, $5, $6,
             '2099-05-04T00:01:00Z'::timestamptz,
             '2099-05-04T00:02:00Z'::timestamptz,
             $7::jsonb, $8::jsonb)
     RETURNING id`,
    [
      row.runId,
      row.sourceType,
      row.externalId,
      row.title,
      row.url,
      row.author,
      JSON.stringify({ points: row.points, commentCount: row.commentCount }),
      JSON.stringify(row.metadata ?? { comments: [] }),
    ],
  );
  return result.rows[0]?.id ?? 0;
}

const telemetry = {
  sources: [
    {
      sourceType: "hn",
      identifier: "news.ycombinator.com",
      displayName: "Hacker News",
      itemsFetched: 12,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 4200,
    },
    {
      sourceType: "reddit",
      identifier: "r/LocalLLaMA",
      displayName: "r/LocalLLaMA",
      itemsFetched: 0,
      status: "failed",
      errors: ["rate limited"],
      retries: 2,
      durationMs: 900,
    },
  ],
  totalItemsFetched: 12,
  totalErrors: 1,
  enrichment: {
    attempted: 5,
    ok: 4,
    failed: 1,
    skipped: 0,
    cacheHits: 2,
    avgFetchMs: 320,
    skippedReasons: {},
  },
};

function costBreakdown(): unknown {
  return {
    schemaVersion: 1,
    totalCostUsd: 0.482,
    stages: {
      shortlist: {
        calls: 1,
        costUsd: 0.082,
        costStatus: "ok",
        byModel: [
          {
            modelId: "claude-haiku-4-5-20251001",
            calls: 1,
            costUsd: 0.082,
            inputTokens: 6000,
            outputTokens: 800,
            cachedInputTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
        ],
      },
      rank: {
        calls: 1,
        costUsd: 0.4,
        costStatus: "ok",
        byModel: [
          {
            modelId: "claude-haiku-4-5-20251001",
            calls: 1,
            costUsd: 0.4,
            inputTokens: 12000,
            outputTokens: 3000,
            cachedInputTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
        ],
      },
    },
    unknownModels: [],
    generatedAt: new Date().toISOString(),
  };
}

/** VS-1: a non-terminal Redis run-state + partial run_logs, NO archive row. */
async function seedLiveRun(): Promise<string> {
  const runId = randomUUID();
  const state = {
    id: runId,
    status: "running",
    stage: "ranking",
    topN: 10,
    startedAt: "2099-05-02T00:00:00.000Z",
    updatedAt: "2099-05-02T00:05:00.000Z",
    completedAt: null,
    sources: {
      hn: { status: "completed", itemsFetched: 12, errors: [] },
      reddit: { status: "running", itemsFetched: 3, errors: [] },
    },
    rankedItems: null,
    warnings: [],
    error: null,
  };
  redisSet(`run:${runId}`, JSON.stringify(state));

  await withClient(async (client) => {
    await insertRunLogs(client, runId, [
      {
        level: "info",
        stage: "queued",
        source: null,
        event: "run.started",
        message: "run started",
        context: null,
      },
      {
        level: "info",
        stage: "collecting",
        source: "hn",
        event: "source.completed",
        message: "hn completed",
        context: { itemsFetched: 12, durationMs: 4200 },
      },
      {
        level: "info",
        stage: "processing",
        source: null,
        event: "stage.result",
        message: "dedup 12 -> 10",
        context: { inputCount: 12, outputCount: 10 },
      },
      {
        level: "info",
        stage: "shortlisting",
        source: null,
        event: "stage.result",
        message: "shortlist 10 -> 8",
        context: { inputCount: 10, outputCount: 8 },
      },
    ]);
  });
  seededRunIds.add(runId);
  return runId;
}

/** VS-2: completed run_archives + run_funnel + sourceTelemetry + cost + logs, NO Redis. */
async function seedHistoricalRun(): Promise<string> {
  const runId = randomUUID();
  await withClient(async (client) => {
    await ensureUserSettings(client);
    await client.query(
      `INSERT INTO run_archives
         (id, status, ranked_items, top_n, reviewed, started_at, completed_at,
          source_types, source_telemetry, run_funnel, cost_breakdown)
       VALUES ($1, 'completed', '[]'::jsonb, 10, true,
               '2099-05-01T00:00:00Z'::timestamptz, '2099-05-01T00:06:00Z'::timestamptz,
               $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [
        runId,
        JSON.stringify(["hn", "reddit"]),
        JSON.stringify(telemetry),
        JSON.stringify({ collected: 12, deduped: 10, shortlisted: 8, ranked: 6 }),
        JSON.stringify(costBreakdown()),
      ],
    );
    await insertRunLogs(client, runId, [
      {
        level: "info",
        stage: "collecting",
        source: null,
        event: "stage.start",
        message: "collecting start",
        context: null,
      },
      {
        level: "info",
        stage: "collecting",
        source: null,
        event: "stage.end",
        message: "collecting end",
        context: { durationMs: 5000 },
      },
      {
        level: "info",
        stage: "processing",
        source: null,
        event: "stage.result",
        message: "dedup 12 -> 10",
        context: { inputCount: 12, outputCount: 10 },
      },
    ]);
  });
  seededRunIds.add(runId);
  return runId;
}

/** VS-3: a failed run with a run.failed error log (with stack) + a source.failed row. */
async function seedFailedRun(): Promise<string> {
  const runId = randomUUID();
  const longStack = [
    "Error: rerank stage exploded",
    "    at rerank (/app/packages/pipeline/src/processors/rerank.ts:88:11)",
    "    at handleRunProcessJob (/app/packages/pipeline/src/workers/processing.ts:210:5)",
    "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
  ].join("\n");
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO run_archives
         (id, status, ranked_items, top_n, reviewed, started_at, completed_at,
          source_types, source_telemetry, run_funnel)
       VALUES ($1, 'failed', '[]'::jsonb, 10, false,
               '2099-05-03T00:00:00Z'::timestamptz, '2099-05-03T00:04:00Z'::timestamptz,
               $2::jsonb, $3::jsonb, $4::jsonb)`,
      [
        runId,
        JSON.stringify(["hn", "reddit"]),
        JSON.stringify(telemetry),
        JSON.stringify({ collected: 12, deduped: 10, shortlisted: null, ranked: null }),
      ],
    );
    await insertRunLogs(client, runId, [
      {
        level: "info",
        stage: "collecting",
        source: null,
        event: "stage.start",
        message: "collecting start",
        context: null,
      },
      {
        level: "error",
        stage: "collecting",
        source: "reddit",
        event: "source.failed",
        message: "reddit failed: rate limited",
        context: { errors: ["rate limited"], errorClass: "rate-limit", retries: 2 },
      },
      {
        level: "error",
        stage: "ranking",
        source: null,
        event: "run.failed",
        message: "rerank stage exploded — see stack for full context",
        context: { stage: "ranking", stack: longStack, fatal: true },
      },
    ]);
  });
  seededRunIds.add(runId);
  return runId;
}

/** VS-4 / EDGE-005: completed archive, run_funnel=null, NO run_logs. */
async function seedLegacyRun(): Promise<string> {
  const runId = randomUUID();
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO run_archives
         (id, status, ranked_items, top_n, reviewed, started_at, completed_at,
          source_types, source_telemetry, run_funnel, cost_breakdown)
       VALUES ($1, 'completed', '[]'::jsonb, 10, true,
               '2099-04-01T00:00:00Z'::timestamptz, '2099-04-01T00:05:00Z'::timestamptz,
               $2::jsonb, $3::jsonb, NULL, $4::jsonb)`,
      [
        runId,
        JSON.stringify(["hn", "reddit"]),
        JSON.stringify(telemetry),
        JSON.stringify(costBreakdown()),
      ],
    );
    // No run_logs inserted — legacy run.
  });
  seededRunIds.add(runId);
  return runId;
}

/** Phase 4: completed run with per-item source payload plus a failed empty source. */
async function seedPerItemObservabilityRun(): Promise<string> {
  const runId = randomUUID();
  await withClient(async (client) => {
    await ensureUserSettings(client);
    const rankedId = await insertRawItem(client, {
      runId,
      sourceType: "reddit",
      externalId: `phase4-ranked-${runId}`,
      title: "OpenAI ships agent SDK with built-in tool routing",
      url: "https://reddit.com/r/AI_Agents/comments/agent_sdk",
      author: "u/devshipper",
      points: 412,
      commentCount: 88,
      metadata: {
        comments: [],
        enrichedLink: { url: "https://reddit.com/r/AI_Agents/comments/agent_sdk", status: "ok" },
      },
    });
    await insertRawItem(client, {
      runId,
      sourceType: "reddit",
      externalId: `phase4-dropped-${runId}`,
      title: "Show HN: I built an open-source agent SDK clone",
      url: "https://reddit.com/r/AI_Agents/comments/agent_sdk",
      author: "u/clonemaker",
      points: 47,
      commentCount: 12,
      metadata: {
        comments: [],
        enrichedLink: { url: "https://reddit.com/r/AI_Agents/comments/agent_sdk", status: "ok" },
      },
    });
    await insertRawItem(client, {
      runId,
      sourceType: "reddit",
      externalId: `phase4-failed-${runId}`,
      title: "Agent benchmarks are misleading",
      url: "https://reddit.com/r/AI_Agents/comments/benchmarks",
      author: "u/skeptic_ai",
      points: 203,
      commentCount: 64,
      metadata: {
        comments: [],
        enrichedLink: {
          url: "https://reddit.com/r/AI_Agents/comments/benchmarks",
          status: "failed",
          failureReason: "fetch timeout after 15000ms",
        },
      },
    });

    await client.query(
      `INSERT INTO run_archives
         (id, status, ranked_items, top_n, reviewed, started_at, completed_at,
          source_types, source_telemetry, run_funnel, shortlisted_item_ids)
       VALUES ($1, 'completed', $2::jsonb, 10, true,
               '2099-05-04T00:00:00Z'::timestamptz,
               '2099-05-04T00:06:00Z'::timestamptz,
               $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)`,
      [
        runId,
        JSON.stringify([{ rawItemId: rankedId, score: 98, rationale: "highest signal" }]),
        JSON.stringify(["reddit", "twitter"]),
        JSON.stringify({
          sources: [
            {
              sourceType: "reddit",
              identifier: "r/AI_Agents",
              displayName: "r/AI_Agents",
              itemsFetched: 3,
              status: "completed",
              errors: [],
              retries: 0,
              durationMs: 1700,
            },
            {
              sourceType: "twitter",
              identifier: "@karpathy",
              displayName: "@karpathy",
              itemsFetched: 0,
              status: "failed",
              errors: ["Twitter cookies not configured"],
              retries: 1,
              durationMs: 2100,
            },
          ],
          totalItemsFetched: 3,
          totalErrors: 1,
          enrichment: {
            attempted: 3,
            ok: 2,
            failed: 1,
            skipped: 0,
            cacheHits: 0,
            avgFetchMs: 611,
            skippedReasons: {},
          },
        }),
        JSON.stringify({ collected: 3, deduped: 2, shortlisted: 1, ranked: 1 }),
        JSON.stringify([rankedId]),
      ],
    );
    await insertRunLogs(client, runId, [
      {
        level: "info",
        stage: "collecting",
        source: "r/ai_agents",
        event: "source.completed",
        message: "collect.ok",
        context: { fetched: 3, durationMs: 1700 },
      },
      {
        level: "warn",
        stage: "enriching",
        source: "r/ai_agents",
        event: "enrichment.summary",
        message: "enrich.failed",
        context: { reason: "fetch timeout after 15000ms" },
      },
      {
        level: "error",
        stage: "collecting",
        source: "@karpathy",
        event: "source.failed",
        message: "Twitter cookies not configured",
        context: { errorClass: "auth", retries: 1 },
      },
    ]);
  });
  seededRunIds.add(runId);
  return runId;
}

async function adminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${API_BASE}/api/admin/login`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBe(true);
}

// ---------------------------------------------------------------------------

test.describe("Run Observability page e2e", () => {
  test.afterAll(async () => {
    if (seededRedisKeys.size > 0) {
      redisDel([...seededRedisKeys]);
      seededRedisKeys.clear();
    }
    if (seededRunIds.size > 0) {
      await withClient(async (client) => {
        if (seededRawExternalIds.size > 0) {
          await client.query(`DELETE FROM raw_items WHERE external_id = ANY($1::text[])`, [
            [...seededRawExternalIds],
          ]);
        }
        await client.query(`DELETE FROM run_logs WHERE run_id = ANY($1::uuid[])`, [
          [...seededRunIds],
        ]);
        await client.query(`DELETE FROM run_archives WHERE id = ANY($1::uuid[])`, [
          [...seededRunIds],
        ]);
      });
      seededRunIds.clear();
      seededRawExternalIds.clear();
    }
  });

  test("VS-1 / REQ-021, REQ-034: live run shows live pill, populated + pending funnel, timeline events", async ({
    page,
  }) => {
    const runId = await seedLiveRun();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await adminLogin(page);
    await page.goto(`/admin/runs/${runId}`);

    // Live pill present and marked live (REQ-034).
    const pill = page.getByTestId("live-status-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("data-live", "true");
    await expect(pill).toContainText(/RUNNING/);
    await expect(pill).toContainText(/RANKING/);

    // Funnel: collected/deduped/shortlisted populated, ranked pending (REQ-021).
    await expect(page.getByTestId("funnel-row-collected")).toHaveAttribute(
      "data-pending",
      "false",
    );
    await expect(page.getByTestId("funnel-row-deduped")).toHaveAttribute(
      "data-pending",
      "false",
    );
    await expect(page.getByTestId("funnel-row-shortlisted")).toHaveAttribute(
      "data-pending",
      "false",
    );
    await expect(page.getByTestId("funnel-row-rank")).toHaveAttribute(
      "data-pending",
      "true",
    );

    // Timeline lists the seeded events (4 rows).
    await expect(page.getByTestId("debug-timeline")).toBeVisible();
    await expect(page.getByTestId("log-row")).toHaveCount(4);
    await expect(page.getByTestId("debug-timeline")).toContainText("run.started");
    await expect(page.getByTestId("debug-timeline")).toContainText("stage.result");

    await page.screenshot({
      path: "../../.harness/features/run-observability-page/verification/screenshots/e2e-vs1-live.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test("VS-2 / REQ-022, REQ-033: historical run renders live=false with all six sections", async ({
    page,
  }) => {
    const runId = await seedHistoricalRun();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await adminLogin(page);
    await page.goto(`/admin/runs/${runId}`);

    // live=false rendering: pill not marked live.
    const pill = page.getByTestId("live-status-pill");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute("data-live", "false");
    await expect(pill).toContainText(/COMPLETED/);

    // All six sections populate from persisted data (REQ-033).
    // 1. masthead/status pill (above). 2. funnel — all four rows populated.
    for (const key of ["collected", "deduped", "shortlisted", "rank"]) {
      await expect(page.getByTestId(`funnel-row-${key}`)).toHaveAttribute(
        "data-pending",
        "false",
      );
    }
    // 3. stage timing + cost.
    await expect(page.getByTestId("cost-strip")).toContainText("$0.482");
    // 4. source telemetry table from archive.
    await expect(page.getByTestId("source-telemetry-table")).toBeVisible();
    await expect(page.getByTestId("source-row-hn")).toBeVisible();
    await expect(page.getByTestId("source-row-reddit")).toBeVisible();
    // 5. enrichment strip from archive telemetry.
    await expect(page.getByTestId("enrichment-strip")).toContainText("320");
    // 6. debug timeline from run_logs (3 rows seeded).
    await expect(page.getByTestId("log-row")).toHaveCount(3);

    await page.screenshot({
      path: "../../.harness/features/run-observability-page/verification/screenshots/e2e-vs2-historical.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test("VS-3 / REQ-035: failure run shows Failures card + error timeline row with expandable stack", async ({
    page,
  }) => {
    const runId = await seedFailedRun();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await adminLogin(page);
    await page.goto(`/admin/runs/${runId}`);

    await expect(page.getByTestId("live-status-pill")).toContainText(/FAILED/);

    // Failures section card present (the two error logs are surfaced as cards).
    await expect(page.getByTestId("failures-list")).toBeVisible();
    await expect(page.getByTestId("failure-card")).toHaveCount(2);

    // Error-styled timeline row for run.failed.
    const errorRows = page.getByTestId("log-row").filter({ hasText: "run.failed" });
    await expect(errorRows).toHaveCount(1);
    await expect(errorRows.first()).toHaveAttribute("data-level", "error");

    // Expandable stack: toggle reveals the stack pre block.
    await expect(page.getByTestId("log-stack")).toHaveCount(0);
    await errorRows.first().getByTestId("log-stack-toggle").click();
    const stack = page.getByTestId("log-stack");
    await expect(stack).toBeVisible();
    await expect(stack).toContainText("rerank stage exploded");
    await expect(stack).toContainText("rerank.ts:88:11");

    await page.screenshot({
      path: "../../.harness/features/run-observability-page/verification/screenshots/e2e-vs3-failure.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test("VS-4 / REQ-037, EDGE-005: legacy run shows empty timeline + failures while source/cost still render", async ({
    page,
  }) => {
    const runId = await seedLegacyRun();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await adminLogin(page);
    await page.goto(`/admin/runs/${runId}`);

    // Empty timeline state (no run_logs).
    await expect(page.getByTestId("timeline-empty")).toBeVisible();
    await expect(page.getByTestId("log-row")).toHaveCount(0);

    // Failures empty state (no error logs).
    await expect(page.getByTestId("failures-empty")).toBeVisible();

    // Source + cost sections still populate from the archive.
    await expect(page.getByTestId("source-telemetry-table")).toBeVisible();
    await expect(page.getByTestId("source-row-hn")).toBeVisible();
    await expect(page.getByTestId("cost-strip")).toContainText("$0.482");

    // Funnel cells render the legacy "—" placeholder (run_funnel = null).
    await expect(page.getByTestId("funnel-row-collected")).toHaveAttribute(
      "data-pending",
      "true",
    );

    await page.screenshot({
      path: "../../.harness/features/run-observability-page/verification/screenshots/e2e-vs4-legacy.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test("REQ-031: dashboard run row links to /admin/runs/:runId", async ({
    page,
  }) => {
    const runId = await seedHistoricalRun();
    await adminLogin(page);
    await page.goto("/admin");

    const row = page.locator(`tr[data-run-id="${runId}"]`).first();
    await row.waitFor({ state: "visible" });
    const detailsLink = row.getByRole("link", { name: /details/i });
    await expect(detailsLink).toHaveAttribute("href", `/admin/runs/${runId}`);

    await detailsLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/runs/${runId}$`));
    await expect(page.getByTestId("live-status-pill")).toBeVisible();
  });

  test("Phase 4 / REQ-001, REQ-003, REQ-004, REQ-005, REQ-007, REQ-010, REQ-011, REQ-012: source rows expand to per-item telemetry", async ({
    page,
  }) => {
    const runId = await seedPerItemObservabilityRun();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await adminLogin(page);
    await page.goto(`/admin/runs/${runId}`);

    const healthyRow = page.getByTestId("source-row-reddit").first();
    await expect(healthyRow).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("source-items-panel")).toHaveCount(0);

    await healthyRow.click();
    await expect(healthyRow).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("source-items-panel");
    await expect(panel).toContainText("1 ranked");
    await expect(panel).not.toContainText("0 shortlisted");
    await expect(panel).toContainText("dedup-dropped");
    await expect(panel).toContainText("enrich-failed");
    await expect(panel.getByRole("link", { name: /OpenAI ships agent SDK/i })).toHaveAttribute(
      "href",
      /reddit\.com\/r\/AI_Agents\/comments\/agent_sdk/,
    );
    await expect(panel).toContainText("Ranked #1");
    await expect(panel).toContainText("lost to");
    await expect(panel).toContainText("fetch timeout after 15000ms");
    await expect(page.getByTestId("source-item-list")).toHaveClass(/scrollbar-none/);
    await expect(page.getByTestId("source-log-strip")).toHaveClass(/scrollbar-none/);
    await expect(page.getByTestId("source-log-strip")).toContainText("enrich.failed");

    await page.screenshot({
      path: "../../.harness/features/telemetry-per-item-observability/verification/screenshots/e2e-phase4-expanded.png",
      fullPage: true,
    });

    await healthyRow.click();
    await expect(healthyRow).toHaveAttribute("aria-expanded", "false");

    const failedRow = page.getByTestId("source-row-twitter").first();
    await failedRow.click();
    await expect(page.getByTestId("source-items-panel")).toContainText("Source failed");
    await expect(page.getByTestId("source-items-panel")).toContainText("source.failed");
    await expect(page.getByTestId("source-item-list")).toHaveCount(0);

    await page.screenshot({
      path: "../../.harness/features/telemetry-per-item-observability/verification/screenshots/e2e-phase4-failed-source.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
});
