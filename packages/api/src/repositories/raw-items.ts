import { and, gte, inArray, sql } from "drizzle-orm";
import type IORedis from "ioredis";
import { rawItems } from "@newsletter/shared/db";
import type { AppDb, SourceType } from "@newsletter/shared/db";
import { runKey } from "@newsletter/shared";
import type {
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
  author: string | null;
  publishedAt: Date | null;
  engagement: { points: number; commentCount: number };
  content: string | null;
  imageUrl: string | null;
  metadata: RawItemMetadata;
}

export interface ListForRunDeps {
  archiveRepo: RunArchivesRepo;
  redis: Pick<IORedis, "get">;
}

export interface RawItemsAggregateRow {
  sourceType: SourceType;
  identifier: string;
  url: string | null;
  fetchedCount: number;
  lastCollectedAt: Date | null;
}

export interface AggregateBySourceAndIdentifierOpts {
  from: Date;
  to: Date;
}

export interface RawItemsRepo {
  findByIds(ids: number[]): Promise<RawItemRow[]>;
  listForRun(runId: string, deps: ListForRunDeps): Promise<RawItemSummary[]>;
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
const DERIVED_IDENTIFIER_SQL = sql`CASE
  WHEN source_type = 'hn' THEN 'news.ycombinator.com'
  WHEN source_type = 'reddit' THEN
    COALESCE(
      'r/' || substring(COALESCE(url, source_url) FROM '(?i)/r/([^/?#]+)'),
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
  WHEN source_type = 'web_search' THEN 'web search'
  ELSE 'unknown'
END`;

export function deriveRawItemIdentifierSql(): typeof DERIVED_IDENTIFIER_SQL {
  return DERIVED_IDENTIFIER_SQL;
}

export function createRawItemsRepo(
  db: Pick<AppDb, "select" | "execute">,
): RawItemsRepo {
  return {
    async findByIds(ids: number[]): Promise<RawItemRow[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select({
          id: rawItems.id,
          sourceType: rawItems.sourceType,
          title: rawItems.title,
          url: rawItems.url,
          author: rawItems.author,
          publishedAt: rawItems.publishedAt,
          engagement: rawItems.engagement,
          content: rawItems.content,
          imageUrl: rawItems.imageUrl,
          metadata: rawItems.metadata,
        })
        .from(rawItems)
        .where(inArray(rawItems.id, ids));
      return rows;
    },
    async listForRun(
      runId: string,
      callDeps: ListForRunDeps,
    ): Promise<RawItemSummary[]> {
      return listRawItemsForRun(runId, { db, ...callDeps });
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
  archiveRepo: RunArchivesRepo;
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
      and(
        gte(rawItems.collectedAt, window.startedAt),
        inArray(rawItems.sourceType, window.sourceTypes),
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
