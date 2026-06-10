import { and, between, eq, gte, inArray, sql } from "drizzle-orm";
import type IORedis from "ioredis";
import { rawItems, tenantScope } from "@newsletter/shared/db";
import type { AppDb, SourceType, TenantScope } from "@newsletter/shared/db";
import { runKey } from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared";
import { deriveRawItemIdentifier } from "@newsletter/shared/services";
import type {
  EnrichedLinkContent,
  RawItemMetadata,
  RawItemSummary,
  RunState,
} from "@newsletter/shared";
import type { RunArchivesRepo } from "./run-archives.js";
import { NotFoundError } from "@api/lib/errors.js";

export interface RawItemRow {
  id: number;
  sourceType: SourceType;
  title: string;
  url: string;
  sourceUrl: string | null;
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  imageUrl: string | null;
  metadata: RawItemMetadata;
}

export interface ListForRunDeps {
  archiveRepo: Pick<RunArchivesRepo, "findById">;
  redis: Pick<IORedis, "get">;
}

export interface RawItemsAggregateRow {
  sourceType: SourceType;
  identifier: string;
  url: string | null;
  fetchedCount: number;
  lastCollectedAt: Date | null;
}

export interface RawItemWithEnrichment {
  id: number;
  sourceType: SourceType;
  title: string;
  url: string;
  sourceUrl: string | null;
  author: string | null;
  publishedAt: string | null;
  collectedAt: string;
  engagement: { points: number; commentCount: number };
  enrichedLink: EnrichedLinkContent | undefined;
  sourceIdentifier: string;
}

export interface AggregateBySourceAndIdentifierOpts {
  from: Date;
  to: Date;
}

export interface RawItemsRepo {
  findByIds(ids: number[]): Promise<RawItemRow[]>;
  listForRun(runId: string, deps: ListForRunDeps): Promise<RawItemSummary[]>;
  listForRunWithEnrichment(
    runId: string,
    deps: ListForRunDeps,
  ): Promise<RawItemWithEnrichment[]>;
  aggregateBySourceAndIdentifier(
    opts: AggregateBySourceAndIdentifierOpts,
  ): Promise<RawItemsAggregateRow[]>;
}

// NOTE: The fallback chain (regex match → hostname → 'unknown') MUST mirror
// JS deriveRawItemIdentifier exactly — see REQ-018. Cross-checked in the
// e2e test (packages/api/tests/e2e/sources.e2e.test.ts), including
// malformed-URL probes for reddit/twitter/github so the hostname fallback
// stays aligned. Backslashes are doubled (\\.) so Postgres receives \. (a
// literal dot) rather than the JS-collapsed `.` wildcard. The host-extract
// regex excludes `:` so a URL with a port (e.g. example.com:8080) yields
// `example.com`, matching the JS `URL.hostname` behaviour. The `(?i)`
// inline flag makes every POSIX regex case-insensitive, mirroring the
// JS `/i` flag — without it, `https://X.com/foo/status/1` would miss
// the twitter branch and fall through to the hostname fallback.
//
// This derivation yields the natural per-item identity shown on cards and the
// /sources page. The review-page source FILTER does NOT use it — that filter
// groups by the stamped metadata.sourceUnit (see getSourceFacets /
// findPoolItems) so it is unit-accurate (subreddit / Twitter list) even for
// link posts. Keep this aligned with the JS deriveRawItemIdentifier (the e2e
// cross-check enforces parity).
const DERIVED_IDENTIFIER_SQL = sql`CASE
  WHEN source_type = 'hn' THEN 'news.ycombinator.com'
  WHEN source_type = 'reddit' THEN
    COALESCE(
      'r/' || lower(substring(COALESCE(url, source_url) FROM '(?i)/r/([^/?#]+)')),
      lower(regexp_replace(substring(COALESCE(url, source_url) FROM '://([^/?#:]+)'), '^www\\.', '')),
      'unknown'
    )
  WHEN source_type = 'twitter' THEN
    COALESCE(
      '@' || substring(COALESCE(url, source_url) FROM '(?i)(?:x\\.com|twitter\\.com)/([^/?#]+)/status/'),
      lower(regexp_replace(substring(COALESCE(url, source_url) FROM '://([^/?#:]+)'), '^www\\.', '')),
      'unknown'
    )
  WHEN source_type = 'github' THEN
    COALESCE(
      substring(COALESCE(url, source_url) FROM '(?i)github\\.com/([^/?#]+/[^/?#]+)'),
      lower(regexp_replace(substring(COALESCE(url, source_url) FROM '://([^/?#:]+)'), '^www\\.', '')),
      'unknown'
    )
  WHEN source_type IN ('rss', 'blog', 'newsletter') THEN
    COALESCE(
      lower(regexp_replace(substring(COALESCE(url, source_url) FROM '://([^/?#:]+)'), '^www\\.', '')),
      'unknown'
    )
  WHEN source_type = 'web_search' THEN
    COALESCE(NULLIF(trim(metadata->>'query'), ''), 'web search')
  ELSE 'unknown'
END`;

export function deriveRawItemIdentifierSql(): typeof DERIVED_IDENTIFIER_SQL {
  return DERIVED_IDENTIFIER_SQL;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "select" | "execute">,
  ctx?: TenantContext,
): RawItemsRepo {
  const scope = tenantScope(rawItems.tenantId, ctx);
  return {
    async findByIds(ids: number[]): Promise<RawItemRow[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          title: rawItems.title,
          url: rawItems.url,
          sourceUrl: rawItems.sourceUrl,
          author: rawItems.author,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          content: rawItems.content,
          imageUrl: rawItems.imageUrl,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(scope.where(inArray(rawItems.id, ids)));
      return rows;
    },
    async listForRun(
      runId: string,
      callDeps: ListForRunDeps,
    ): Promise<RawItemSummary[]> {
      return listRawItemsForRun(runId, { db, scope, ...callDeps });
    },
    async listForRunWithEnrichment(
      runId: string,
      callDeps: ListForRunDeps,
    ): Promise<RawItemWithEnrichment[]> {
      return listRawItemsForRunWithEnrichment(runId, { db, scope, ...callDeps });
    },
    async aggregateBySourceAndIdentifier(
      opts: AggregateBySourceAndIdentifierOpts,
    ): Promise<RawItemsAggregateRow[]> {
      const rows = await db.execute<{
        source_type: SourceType;
        identifier: string;
        url: string | null;
        fetched_count: string | number;
        last_collected_at: Date | string | null;
      }>(sql`
        SELECT
          source_type,
          ${DERIVED_IDENTIFIER_SQL} AS identifier,
          MAX(url) AS url,
          COUNT(*) AS fetched_count,
          MAX(collected_at) AS last_collected_at
        FROM raw_items
        WHERE collected_at >= ${opts.from.toISOString()}::timestamptz
          AND collected_at <  ${opts.to.toISOString()}::timestamptz
          AND tenant_id = ${scope.tenantId}
        GROUP BY source_type, identifier
      `);
      return rows.map((r) => ({
        sourceType: r.source_type,
        identifier: r.identifier,
        url: r.url,
        fetchedCount:
          typeof r.fetched_count === "number"
            ? r.fetched_count
            : Number.parseInt(r.fetched_count, 10),
        lastCollectedAt:
          r.last_collected_at === null
            ? null
            : r.last_collected_at instanceof Date
              ? r.last_collected_at
              : new Date(r.last_collected_at),
      }));
    },
  };
}

export interface ListRawItemsForRunDeps {
  db: Pick<AppDb, "select">;
  scope: TenantScope;
  archiveRepo: Pick<RunArchivesRepo, "findById">;
  redis: Pick<IORedis, "get">;
}

const SOURCE_KEY_TO_TYPE: Partial<Record<string, SourceType>> = {
  hn: "hn",
  reddit: "reddit",
  twitter: "twitter",
  blog: "blog",
  rss: "rss",
  github: "github",
  newsletter: "newsletter",
};

interface RunWindow {
  startedAt: Date;
  completedAt: Date | null;
  sourceTypes: SourceType[];
}

async function resolveRunWindow(
  runId: string,
  deps: ListRawItemsForRunDeps,
): Promise<RunWindow> {
  const archive = await deps.archiveRepo.findById(runId);
  if (archive?.startedAt && archive.sourceTypes) {
    return {
      startedAt: archive.startedAt,
      completedAt: archive.completedAt,
      sourceTypes: archive.sourceTypes,
    };
  }
  const raw = await deps.redis.get(runKey(runId));
  if (raw === null) {
    throw new NotFoundError(`run not found: ${runId}`);
  }
  const state = JSON.parse(raw) as RunState;
  const sourceTypes: SourceType[] = Object.keys(state.sources)
    .map((k) => SOURCE_KEY_TO_TYPE[k])
    .filter((t): t is SourceType => t !== undefined);
  return {
    startedAt: new Date(state.startedAt),
    completedAt: null,
    sourceTypes,
  };
}

export async function listRawItemsForRun(
  runId: string,
  deps: ListRawItemsForRunDeps,
): Promise<RawItemSummary[]> {
  const window = await resolveRunWindow(runId, deps);
  if (window.sourceTypes.length === 0) return [];

  const rows = await deps.db
    .select({
      id: rawItems.id,
      sourceType: rawItems.sourceType,
      title: rawItems.title,
      url: rawItems.url,
      author: rawItems.author,
      imageUrl: rawItems.imageUrl,
      publishedAt: rawItems.publishedAt,
      collectedAt: rawItems.collectedAt,
      engagement: rawItems.engagement,
    })
    .from(rawItems)
    .where(
      deps.scope.where(
        and(
          gte(rawItems.collectedAt, window.startedAt),
          inArray(rawItems.sourceType, window.sourceTypes),
        ),
      ),
    )
    .orderBy(
      sql`${rawItems.sourceType} ASC`,
      sql`COALESCE(${rawItems.publishedAt}, ${rawItems.collectedAt}) DESC`,
    );

  return rows.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    title: r.title,
    url: r.url,
    author: r.author,
    imageUrl: r.imageUrl,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    collectedAt: r.collectedAt.toISOString(),
    engagement: r.engagement,
  }));
}

const RAW_ITEM_WITH_ENRICHMENT_SELECT = {
  id: rawItems.id,
  sourceType: rawItems.sourceType,
  title: rawItems.title,
  url: rawItems.url,
  sourceUrl: rawItems.sourceUrl,
  author: rawItems.author,
  publishedAt: rawItems.publishedAt,
  collectedAt: rawItems.collectedAt,
  engagement: rawItems.engagement,
  metadata: rawItems.metadata,
} as const;

interface RawItemWithEnrichmentRow {
  readonly id: number;
  readonly sourceType: SourceType;
  readonly title: string;
  readonly url: string;
  readonly sourceUrl: string | null;
  readonly author: string | null;
  readonly publishedAt: Date | null;
  readonly collectedAt: Date;
  readonly engagement: { points: number; commentCount: number };
  readonly metadata: RawItemMetadata;
}

async function listRawItemsForRunWithEnrichment(
  runId: string,
  deps: ListRawItemsForRunDeps,
): Promise<RawItemWithEnrichment[]> {
  const window = await resolveRunWindow(runId, deps);

  const byRunId = await deps.db
    .select(RAW_ITEM_WITH_ENRICHMENT_SELECT)
    .from(rawItems)
    .where(deps.scope.where(eq(rawItems.runId, runId)))
    .orderBy(
      sql`${rawItems.sourceType} ASC`,
      sql`COALESCE(${rawItems.publishedAt}, ${rawItems.collectedAt}) DESC`,
    );

  if (byRunId.length > 0) {
    return byRunId.map(toRawItemWithEnrichment);
  }

  if (window.sourceTypes.length === 0) return [];

  const windowPredicate =
    window.completedAt === null
      ? gte(rawItems.collectedAt, window.startedAt)
      : between(rawItems.collectedAt, window.startedAt, window.completedAt);

  const fallbackRows = await deps.db
    .select(RAW_ITEM_WITH_ENRICHMENT_SELECT)
    .from(rawItems)
    .where(
      deps.scope.where(
        and(windowPredicate, inArray(rawItems.sourceType, window.sourceTypes)),
      ),
    )
    .orderBy(
      sql`${rawItems.sourceType} ASC`,
      sql`COALESCE(${rawItems.publishedAt}, ${rawItems.collectedAt}) DESC`,
    );

  return fallbackRows.map(toRawItemWithEnrichment);
}

function toRawItemWithEnrichment(row: RawItemWithEnrichmentRow): RawItemWithEnrichment {
  return {
    id: row.id,
    sourceType: row.sourceType,
    title: row.title,
    url: row.url,
    sourceUrl: row.sourceUrl,
    author: row.author,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    collectedAt: row.collectedAt.toISOString(),
    engagement: row.engagement,
    enrichedLink: row.metadata.enrichedLink,
    sourceIdentifier: deriveRawItemIdentifier({
      sourceType: row.sourceType,
      url: row.url,
      sourceUrl: row.sourceUrl,
      metadata: row.metadata,
    }),
  };
}
