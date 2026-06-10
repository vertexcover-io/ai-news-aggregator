/**
 * AGENTLOOP migration verification gate (Phase 2 — REQ-115).
 *
 * Four checks, ALL of which must pass before the enforce migration
 * (NOT NULL tenant_id + singleton→unique(tenant_id) swap) may be applied:
 *   1. Row counts match the pre-migration snapshot for every tenant-owned table.
 *   2. Zero NULL tenant_id rows remain on every tenant-owned table.
 *   3. AGENTLOOP entities (tenant + admin, archives, subscribers, runs)
 *      resolve under the tenant.
 *   4. A --dry-run pipeline enqueue succeeds through the real `startRun`
 *      seam (the job is removed immediately after — no pipeline work runs).
 *
 * Usage:
 *   pnpm --filter @newsletter/scripts verify:agentloop [-- --counts-file <path>]
 * Env: DATABASE_URL, REDIS_URL (required); AGENTLOOP_SLUG (default agentloop).
 * Exit code 0 = gate passed; 1 = at least one check failed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import { startRun, runKey } from "@newsletter/shared";
import type { RunProcessJobPayload, UserSettings } from "@newsletter/shared";
import { TENANT_OWNED_TABLES } from "./tenant-tables.js";
import { DEFAULT_COUNTS_FILE } from "./migrate-agentloop-tenant.js";
import type { CountsFilePayload } from "./migrate-agentloop-tenant.js";

export interface VerificationCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface VerificationReport {
  pass: boolean;
  checks: VerificationCheck[];
}

export interface VerificationOptions {
  slug: string;
  /** Pre-migration row counts captured by migrate-agentloop-tenant.ts.
   * Partial: the file is external input — a stale/hand-edited snapshot may
   * miss tables, which must fail the check rather than crash. */
  preCounts: Partial<Record<string, number>>;
  redisUrl: string;
  /** BullMQ queue the API enqueues pipeline runs on. */
  queueName?: string;
}

async function checkCountsMatch(
  sql: postgres.Sql,
  preCounts: Partial<Record<string, number>>,
): Promise<VerificationCheck> {
  const mismatches: string[] = [];
  for (const table of TENANT_OWNED_TABLES) {
    const expected = preCounts[table];
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM ${sql(table)}
    `;
    const actual = Number(row.n);
    if (expected === undefined) {
      mismatches.push(`${table}: missing from pre-migration snapshot`);
    } else if (actual !== expected) {
      mismatches.push(`${table}: pre=${expected} post=${actual}`);
    }
  }
  return {
    name: "row counts match pre-migration snapshot",
    pass: mismatches.length === 0,
    detail: mismatches.length === 0 ? "all tables match" : mismatches.join("; "),
  };
}

async function checkNoNullTenantId(sql: postgres.Sql): Promise<VerificationCheck> {
  const offenders: string[] = [];
  for (const table of TENANT_OWNED_TABLES) {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM ${sql(table)} WHERE tenant_id IS NULL
    `;
    const nulls = Number(row.n);
    if (nulls > 0) offenders.push(`${table}: ${nulls} NULL rows`);
  }
  return {
    name: "zero NULL tenant_id on every tenant-owned table",
    pass: offenders.length === 0,
    detail: offenders.length === 0 ? "no NULLs remain" : offenders.join("; "),
  };
}

interface TenantRow {
  id: string;
  status: string;
  feature_canon: boolean;
}

async function checkAgentloopResolves(
  sql: postgres.Sql,
  slug: string,
): Promise<{ check: VerificationCheck; tenantId: string | null }> {
  const tenant = (
    await sql<TenantRow[]>`
      SELECT id, status, feature_canon FROM tenants WHERE slug = ${slug}
    `
  ).at(0);
  if (!tenant) {
    return {
      check: {
        name: "AGENTLOOP entities resolve under the tenant",
        pass: false,
        detail: `tenant '${slug}' not found`,
      },
      tenantId: null,
    };
  }

  const problems: string[] = [];
  if (tenant.status !== "active") problems.push(`tenant status=${tenant.status}`);
  if (!tenant.feature_canon) problems.push("feature_canon is off");

  const [adminRow] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM users
    WHERE tenant_id = ${tenant.id} AND role = 'tenant_admin'
  `;
  if (Number(adminRow.n) === 0) problems.push("no tenant_admin user");

  for (const table of ["run_archives", "subscribers", "run_logs"] as const) {
    const [totals] = await sql<{ total: string; scoped: string }[]>`
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE tenant_id = ${tenant.id})::text AS scoped
      FROM ${sql(table)}
    `;
    if (totals.total !== totals.scoped) {
      problems.push(`${table}: ${totals.scoped}/${totals.total} rows under tenant`);
    }
  }

  return {
    check: {
      name: "AGENTLOOP entities resolve under the tenant",
      pass: problems.length === 0,
      detail:
        problems.length === 0
          ? `tenant ${tenant.id} active; archives/subscribers/runs all scoped`
          : problems.join("; "),
    },
    tenantId: tenant.id,
  };
}

interface SettingsRow {
  id: string;
  top_n: number;
  shortlist_size: number;
  half_life_hours: number | null;
  hn_enabled: boolean;
  hn_config: UserSettings["hnConfig"];
  reddit_enabled: boolean;
  reddit_config: UserSettings["redditConfig"];
  web_enabled: boolean;
  web_config: UserSettings["webConfig"];
  twitter_enabled: boolean;
  twitter_config: UserSettings["twitterConfig"];
  web_search_enabled: boolean;
  web_search_config: UserSettings["webSearchConfig"];
  posthog_enabled: boolean;
  posthog_project_token: string | null;
  posthog_host: string | null;
  ranking_prompt: string;
  shortlist_prompt: string;
  pipeline_time: string;
  email_time: string;
  linkedin_time: string;
  twitter_time: string;
  schedule_timezone: string;
  schedule_enabled: boolean;
  email_enabled: boolean;
  linkedin_enabled: boolean;
  twitter_post_enabled: boolean;
  auto_review: boolean;
  updated_at: Date | string;
}

function toUserSettings(row: SettingsRow): UserSettings {
  return {
    id: row.id,
    topN: row.top_n,
    halfLifeHours: row.half_life_hours,
    hnEnabled: row.hn_enabled,
    hnConfig: row.hn_config,
    redditEnabled: row.reddit_enabled,
    redditConfig: row.reddit_config,
    webEnabled: row.web_enabled,
    webConfig: row.web_config,
    twitterEnabled: row.twitter_enabled,
    twitterConfig: row.twitter_config,
    webSearchEnabled: row.web_search_enabled,
    webSearchConfig: row.web_search_config,
    posthogEnabled: row.posthog_enabled,
    posthogProjectToken: row.posthog_project_token,
    posthogHost: row.posthog_host,
    scheduleTime: row.pipeline_time,
    pipelineTime: row.pipeline_time,
    emailTime: row.email_time,
    linkedinTime: row.linkedin_time,
    twitterTime: row.twitter_time,
    scheduleTimezone: row.schedule_timezone,
    scheduleEnabled: row.schedule_enabled,
    emailEnabled: row.email_enabled,
    linkedinEnabled: row.linkedin_enabled,
    twitterPostEnabled: row.twitter_post_enabled,
    autoReview: row.auto_review,
    rankingPrompt: row.ranking_prompt,
    shortlistPrompt: row.shortlist_prompt,
    shortlistSize: row.shortlist_size,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function checkDryRunEnqueue(
  sql: postgres.Sql,
  tenantId: string | null,
  redisUrl: string,
  queueName: string,
): Promise<VerificationCheck> {
  const name = "dry-run pipeline enqueue succeeds";
  if (tenantId === null) {
    return { name, pass: false, detail: "skipped: tenant not resolved" };
  }

  const rows = await sql<SettingsRow[]>`
    SELECT id, top_n, shortlist_size, half_life_hours,
           hn_enabled, hn_config, reddit_enabled, reddit_config,
           web_enabled, web_config, twitter_enabled, twitter_config,
           web_search_enabled, web_search_config,
           posthog_enabled, posthog_project_token, posthog_host,
           ranking_prompt, shortlist_prompt,
           pipeline_time, email_time, linkedin_time, twitter_time,
           schedule_timezone, schedule_enabled, email_enabled,
           linkedin_enabled, twitter_post_enabled, auto_review, updated_at
    FROM user_settings WHERE tenant_id = ${tenantId} LIMIT 1
  `;
  const row = rows.at(0);
  if (!row) {
    return { name, pass: false, detail: "no user_settings row under the tenant" };
  }

  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 5000,
  });
  try {
    await redis.connect();
  } catch (err) {
    redis.disconnect();
    return { name, pass: false, detail: `redis unreachable: ${String(err)}` };
  }

  const queue = new Queue<RunProcessJobPayload>(queueName, { connection: redis });
  try {
    const { runId } = await startRun(toUserSettings(row), { redis, queue }, { dryRun: true });
    const job = await queue.getJob(runId);
    if (!job) {
      return { name, pass: false, detail: `job ${runId} not found after enqueue` };
    }
    if (job.data.dryRun !== true) {
      return { name, pass: false, detail: `job ${runId} enqueued without dryRun flag` };
    }
    // Verification only — remove the job before a worker can pick it up.
    try {
      await job.remove();
    } catch {
      // Already taken by a live worker: it is a dry run, no publish happens.
    }
    await redis.del(runKey(runId));
    return { name, pass: true, detail: `enqueued + cleaned up dry-run job ${runId}` };
  } catch (err) {
    return { name, pass: false, detail: `enqueue failed: ${String(err)}` };
  } finally {
    await queue.close();
    await redis.quit().catch(() => {
      redis.disconnect();
    });
  }
}

export async function runAgentloopVerification(
  sql: postgres.Sql,
  opts: VerificationOptions,
): Promise<VerificationReport> {
  const queueName = opts.queueName ?? "processing";

  const counts = await checkCountsMatch(sql, opts.preCounts);
  const nulls = await checkNoNullTenantId(sql);
  const { check: resolves, tenantId } = await checkAgentloopResolves(sql, opts.slug);
  const enqueue = await checkDryRunEnqueue(sql, tenantId, opts.redisUrl, queueName);

  const checks = [counts, nulls, resolves, enqueue];
  return { pass: checks.every((c) => c.pass), checks };
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: resolve(import.meta.dirname, "../../../.env") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required (dry-run enqueue check)");

  const countsFile = resolve(
    argValue(process.argv, "--counts-file") ?? DEFAULT_COUNTS_FILE,
  );
  let payload: CountsFilePayload;
  try {
    payload = JSON.parse(readFileSync(countsFile, "utf8")) as CountsFilePayload;
  } catch (err) {
    throw new Error(
      `cannot read pre-migration counts at ${countsFile} — run migrate-agentloop-tenant.ts first`,
      { cause: err },
    );
  }

  const slug = argValue(process.argv, "--slug") ?? process.env.AGENTLOOP_SLUG ?? payload.slug;

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const report = await runAgentloopVerification(sql, {
      slug,
      preCounts: payload.preCounts,
      redisUrl,
    });
    for (const check of report.checks) {
      console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
    }
    if (!report.pass) {
      console.error("Verification FAILED — do NOT apply the enforce migration.");
      process.exitCode = 1;
    } else {
      console.log("Verification passed — safe to apply the enforce migration (pnpm migrate:up).");
    }
  } finally {
    await sql.end();
  }
}

const cliEntry = process.argv.at(1);
const isCliEntry =
  cliEntry !== undefined && import.meta.url === pathToFileURL(cliEntry).href;

if (isCliEntry) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
