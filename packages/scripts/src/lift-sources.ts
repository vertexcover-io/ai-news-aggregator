/**
 * user_settings JSONB → normalized `sources` rows lift (Phase 8, REQ-070).
 *
 * Idempotent, transactional CLI in the P2 backfill style: for every tenant
 * whose user_settings row carries legacy `*_config` JSONB, explode each
 * configured source identity into one `sources` row:
 *
 *   hn_config                  → 1 `hn` row        (kind "hn")
 *   reddit_config.subreddits[] → 1 `reddit` row per subreddit
 *   web_config.sources[]       → 1 `blog` row per listing (kind "web" —
 *                                 matches the web collector's sourceType)
 *   twitter_config.users[]     → 1 `twitter` row per handle (kind "twitter_user")
 *   twitter_config.listIds[]   → 1 `twitter` row per list  (kind "twitter_list")
 *   web_search_config.queries[]→ 1 `web_search` row per query
 *
 * `enabled` mirrors the type's legacy `*_enabled` flag, so AGENTLOOP's
 * collection set is preserved exactly. Tenants that ALREADY have any
 * sources rows are skipped — a re-run never clobbers panel edits.
 *
 * The user_settings source columns are KEPT: the pipeline reads them until
 * P9 flips collection onto enabled rows (REQ-073). This lift is additive
 * and changes no collection behavior.
 *
 * Usage: pnpm --filter @newsletter/scripts lift:sources
 * Env:   DATABASE_URL (required)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

interface LegacyWebSource {
  name?: string;
  listingUrl?: string;
}

interface LegacySettingsRow {
  tenant_id: string;
  hn_enabled: boolean;
  hn_config: Record<string, unknown> | null;
  reddit_enabled: boolean;
  reddit_config: {
    subreddits?: string[];
    sort?: string;
    limit?: number;
    sinceDays?: number;
  } | null;
  web_enabled: boolean;
  web_config: {
    sources?: LegacyWebSource[];
    maxItems?: number;
    sinceDays?: number;
  } | null;
  twitter_enabled: boolean;
  twitter_config: {
    listIds?: string[];
    users?: { handle?: string; userId?: string }[];
    maxTweetsPerSource?: number;
    sinceHours?: number;
  } | null;
  web_search_enabled: boolean;
  web_search_config: {
    provider?: string;
    queries?: { query?: string; sinceDays?: number; maxItems?: number }[];
  } | null;
}

interface SourceRowSeed {
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface TenantLiftResult {
  tenantId: string;
  inserted: number;
  /** True when the tenant already had sources rows and was left untouched. */
  skipped: boolean;
}

export interface SourcesLiftResult {
  tenants: TenantLiftResult[];
}

function defined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null),
  ) as T;
}

/** Explode one tenant's legacy settings JSONB into source row seeds. */
export function explodeSettings(row: LegacySettingsRow): SourceRowSeed[] {
  const seeds: SourceRowSeed[] = [];

  if (row.hn_config !== null) {
    seeds.push({
      type: "hn",
      enabled: row.hn_enabled,
      config: defined({ kind: "hn", ...row.hn_config }),
    });
  }

  for (const subreddit of row.reddit_config?.subreddits ?? []) {
    seeds.push({
      type: "reddit",
      enabled: row.reddit_enabled,
      config: defined({
        kind: "reddit",
        subreddit,
        sort: row.reddit_config?.sort,
        limit: row.reddit_config?.limit,
        sinceDays: row.reddit_config?.sinceDays ?? 1,
      }),
    });
  }

  for (const source of row.web_config?.sources ?? []) {
    if (!source.listingUrl) continue;
    seeds.push({
      type: "blog",
      enabled: row.web_enabled,
      config: defined({
        kind: "web",
        name: source.name ?? source.listingUrl,
        listingUrl: source.listingUrl,
        maxItems: row.web_config?.maxItems,
        sinceDays: row.web_config?.sinceDays,
      }),
    });
  }

  const twitterShared = {
    maxTweetsPerSource: row.twitter_config?.maxTweetsPerSource,
    sinceHours: row.twitter_config?.sinceHours,
  };
  for (const user of row.twitter_config?.users ?? []) {
    if (!user.handle) continue;
    seeds.push({
      type: "twitter",
      enabled: row.twitter_enabled,
      config: defined({
        kind: "twitter_user",
        handle: user.handle,
        userId: user.userId,
        ...twitterShared,
      }),
    });
  }
  for (const listId of row.twitter_config?.listIds ?? []) {
    seeds.push({
      type: "twitter",
      enabled: row.twitter_enabled,
      config: defined({ kind: "twitter_list", listId, ...twitterShared }),
    });
  }

  for (const q of row.web_search_config?.queries ?? []) {
    if (!q.query) continue;
    seeds.push({
      type: "web_search",
      enabled: row.web_search_enabled,
      config: defined({
        kind: "web_search",
        provider: row.web_search_config?.provider ?? "tavily",
        query: q.query,
        sinceDays: q.sinceDays ?? 7,
        maxItems: q.maxItems ?? 10,
      }),
    });
  }

  return seeds;
}

export async function runSourcesLift(
  sql: postgres.Sql,
): Promise<SourcesLiftResult> {
  return sql.begin(async (tx) => {
    const settings = await tx<LegacySettingsRow[]>`
      SELECT tenant_id,
             hn_enabled, hn_config,
             reddit_enabled, reddit_config,
             web_enabled, web_config,
             twitter_enabled, twitter_config,
             web_search_enabled, web_search_config
      FROM user_settings
      WHERE tenant_id IS NOT NULL
      ORDER BY tenant_id
    `;

    const tenants: TenantLiftResult[] = [];
    for (const row of settings) {
      const [{ n }] = await tx<{ n: string }[]>`
        SELECT count(*)::text AS n FROM sources WHERE tenant_id = ${row.tenant_id}
      `;
      if (Number(n) > 0) {
        tenants.push({ tenantId: row.tenant_id, inserted: 0, skipped: true });
        continue;
      }

      const seeds = explodeSettings(row);
      for (const seed of seeds) {
        await tx`
          INSERT INTO sources (tenant_id, type, config, enabled)
          VALUES (${row.tenant_id}, ${seed.type}, ${JSON.stringify(seed.config)}::jsonb, ${seed.enabled})
        `;
      }
      tenants.push({
        tenantId: row.tenant_id,
        inserted: seeds.length,
        skipped: false,
      });
    }

    return { tenants };
  });
}

const cliEntry = process.argv.at(1);
const isCliEntry =
  cliEntry !== undefined && import.meta.url === pathToFileURL(cliEntry).href;

if (isCliEntry) {
  void (async () => {
    const { config } = await import("dotenv");
    config({ path: resolve(import.meta.dirname, "../../../.env") });
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");

    const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    try {
      const result = await runSourcesLift(sql);
      for (const t of result.tenants) {
        console.log(
          t.skipped
            ? `  tenant ${t.tenantId}: already has sources rows — skipped`
            : `  tenant ${t.tenantId}: lifted ${t.inserted} source row(s)`,
        );
      }
      if (result.tenants.length === 0) {
        console.log("  no tenant user_settings rows found — nothing to lift");
      }
    } finally {
      await sql.end();
    }
  })().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
