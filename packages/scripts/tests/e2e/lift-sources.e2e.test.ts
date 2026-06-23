/**
 * Phase 8 e2e: user_settings JSONB → normalized sources rows lift.
 *
 * Rehearses the production lift on a throwaway DB:
 *   1. Apply all migrations (sources table exists, empty).
 *   2. Seed AGENTLOOP-shaped user_settings (hn/reddit/web/twitter/webSearch
 *      configs) plus a second tenant.
 *   3. Run the lift → every configured source identity becomes a row with
 *      the right type/config/enabled, fenced to its tenant (REQ-070).
 *   4. Re-run → idempotent (tenants that already have rows are skipped), so
 *      panel edits made between runs are never clobbered.
 *
 * user_settings keeps its *Config columns — the pipeline reads them until
 * P9 — so the lift is additive and collection behavior is unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { runSourcesLift } from "../../src/lift-sources.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL must be set (see .env) to run lift e2e tests");
}

const migrationsFolder = resolve(REPO_ROOT, "packages/shared/src/db/migrations");
const testDbName = `lift_sources_test_${randomBytes(4).toString("hex")}`;

const admin = postgres(baseUrl, { max: 1 });
let sql: postgres.Sql;
let agentloopId: string;
let otherId: string;

const AGENTLOOP_HN_CONFIG = {
  keywords: ["ai", "llm", "agents"],
  pointsThreshold: 100,
  sinceDays: 1,
  feeds: ["newest", "best"],
  count: 50,
  commentsPerItem: 10,
};
const AGENTLOOP_REDDIT_CONFIG = {
  subreddits: ["MachineLearning", "LocalLLaMA"],
  sort: "hot",
  limit: 25,
  sinceDays: 1,
};
const AGENTLOOP_WEB_CONFIG = {
  sources: [
    { name: "vLLM blog", listingUrl: "https://blog.vllm.ai" },
    { name: "PyTorch blog", listingUrl: "https://pytorch.org/blog" },
  ],
  maxItems: 30,
  sinceDays: 2,
};
const AGENTLOOP_TWITTER_CONFIG = {
  listIds: ["1234567890"],
  users: [
    { handle: "tri_dao", userId: "111" },
    { handle: "danielhanchen", userId: "222" },
  ],
  maxTweetsPerSource: 20,
  sinceHours: 24,
};
const AGENTLOOP_WEB_SEARCH_CONFIG = {
  provider: "tavily",
  queries: [{ query: "agentic coding", sinceDays: 7, maxItems: 10 }],
};

async function seedSettings(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const base: Record<string, unknown> = {
    tenant_id: tenantId,
    top_n: 10,
    shortlist_size: 30,
    ranking_prompt: "rank",
    shortlist_prompt: "shortlist",
    pipeline_time: "07:00",
    email_time: "07:30",
    linkedin_time: "07:45",
    twitter_time: "08:00",
    schedule_timezone: "UTC",
    hn_enabled: true,
    hn_config: AGENTLOOP_HN_CONFIG,
    reddit_enabled: true,
    reddit_config: AGENTLOOP_REDDIT_CONFIG,
    web_enabled: true,
    web_config: AGENTLOOP_WEB_CONFIG,
    twitter_enabled: false,
    twitter_config: AGENTLOOP_TWITTER_CONFIG,
    web_search_enabled: true,
    web_search_config: AGENTLOOP_WEB_SEARCH_CONFIG,
    ...overrides,
  };
  // postgres.js dynamic-insert helper can't serialize plain objects to jsonb;
  // pass JSON text and let Postgres cast the unknown-typed parameter.
  const serialized = Object.fromEntries(
    Object.entries(base).map(([k, v]) => [
      k,
      v !== null && typeof v === "object" ? JSON.stringify(v) : v,
    ]),
  );
  await sql`INSERT INTO user_settings ${sql(serialized)}`;
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${testDbName}`;
  sql = postgres(testUrl.href, { max: 1, onnotice: () => undefined });
  await migrate(drizzle(sql), { migrationsFolder });

  const tenants = await sql<{ id: string; slug: string }[]>`
    INSERT INTO tenants (slug, name, status)
    VALUES ('agentloop', 'AGENTLOOP', 'active'),
           ('other', 'Other Tenant', 'active')
    RETURNING id, slug
  `;
  agentloopId = tenants.find((t) => t.slug === "agentloop")?.id ?? "";
  otherId = tenants.find((t) => t.slug === "other")?.id ?? "";

  await seedSettings(agentloopId);
  await seedSettings(otherId, {
    hn_config: null,
    hn_enabled: false,
    reddit_config: { subreddits: ["mlops"], sinceDays: 1 },
    web_config: null,
    web_enabled: false,
    twitter_config: null,
    web_search_config: null,
    web_search_enabled: false,
  });
}, 120_000);

afterAll(async () => {
  await sql?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
  await admin.end();
});

describe("test_REQ_070_lift_preserves_agentloop_sources", () => {
  it("lifts every configured source identity into a tenant-fenced row", async () => {
    const result = await runSourcesLift(sql);

    const lifted = result.tenants.find((t) => t.tenantId === agentloopId);
    // 1 hn + 2 reddit + 2 web + (2 users + 1 list) twitter + 1 web_search = 9
    expect(lifted?.inserted).toBe(9);

    const rows = await sql<
      { type: string; config: Record<string, unknown>; enabled: boolean }[]
    >`SELECT type, config, enabled FROM sources WHERE tenant_id = ${agentloopId} ORDER BY type, config->>'subreddit', config->>'handle', config->>'name'`;
    expect(rows).toHaveLength(9);

    const byKind = (
      kind: string,
    ): { type: string; config: Record<string, unknown>; enabled: boolean }[] =>
      rows.filter((r) => r.config.kind === kind);

    expect(byKind("hn")).toHaveLength(1);
    expect(byKind("hn")[0]).toMatchObject({
      type: "hn",
      enabled: true,
      config: { kind: "hn", ...AGENTLOOP_HN_CONFIG },
    });

    expect(byKind("reddit").map((r) => r.config.subreddit)).toEqual([
      "LocalLLaMA",
      "MachineLearning",
    ]);
    expect(byKind("reddit")[0]).toMatchObject({
      type: "reddit",
      enabled: true,
      config: { kind: "reddit", sort: "hot", limit: 25, sinceDays: 1 },
    });

    expect(byKind("web").map((r) => r.config.name).sort()).toEqual([
      "PyTorch blog",
      "vLLM blog",
    ]);
    expect(byKind("web")[0]).toMatchObject({
      type: "blog",
      enabled: true,
      config: { kind: "web", maxItems: 30, sinceDays: 2 },
    });

    // twitter_enabled=false → rows lift disabled, identities preserved.
    expect(byKind("twitter_user").map((r) => r.config.handle).sort()).toEqual([
      "danielhanchen",
      "tri_dao",
    ]);
    expect(
      byKind("twitter_user").every((r) => r.type === "twitter" && !r.enabled),
    ).toBe(true);
    expect(byKind("twitter_user")[0].config).toMatchObject({
      maxTweetsPerSource: 20,
      sinceHours: 24,
    });
    expect(byKind("twitter_list")).toHaveLength(1);
    expect(byKind("twitter_list")[0]).toMatchObject({
      type: "twitter",
      enabled: false,
      config: { kind: "twitter_list", listId: "1234567890" },
    });

    expect(byKind("web_search")).toHaveLength(1);
    expect(byKind("web_search")[0]).toMatchObject({
      type: "web_search",
      enabled: true,
      config: {
        kind: "web_search",
        provider: "tavily",
        query: "agentic coding",
        sinceDays: 7,
        maxItems: 10,
      },
    });
  });

  it("lifts other tenants independently (per-tenant fencing)", async () => {
    const rows = await sql<
      { type: string; config: Record<string, unknown>; enabled: boolean }[]
    >`SELECT type, config, enabled FROM sources WHERE tenant_id = ${otherId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "reddit",
      enabled: true,
      config: { kind: "reddit", subreddit: "mlops", sinceDays: 1 },
    });
  });

  it("is idempotent: a re-run skips tenants that already have rows", async () => {
    const before = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM sources`;
    const rerun = await runSourcesLift(sql);
    expect(rerun.tenants.every((t) => t.inserted === 0 && t.skipped)).toBe(true);
    const after = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM sources`;
    expect(after[0].n).toBe(before[0].n);
  });
});
