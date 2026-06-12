import type { RawItemUpsert } from "@pipeline/repositories/raw-items.js";
import type { EnrichedLinkContent } from "@newsletter/shared";
import { createLogger, type Logger } from "@newsletter/shared/logger";
import type {
  Fixture,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";
import { enrichRawItems as defaultEnrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import {
  newCounters,
  type EnrichmentContext,
} from "@pipeline/services/link-enrichment/types.js";
import { writeFixture as defaultWriteFixture } from "@pipeline/eval/fixture-io.js";
import {
  detectAddPostSourceType,
  dispatchFetch as defaultDispatchFetch,
  type AddPostSourceType,
  type DispatchFetchDeps,
} from "@pipeline/services/add-post/dispatch.js";

export interface CreateManualFixtureOptions {
  name?: string;
  model?: string;
  logger?: Logger;
}

export interface CreateManualFixtureDeps {
  enrichRawItems?: (
    items: RawItemUpsert[],
    ctx: EnrichmentContext,
  ) => Promise<RawItemUpsert[]>;
  writeFixture?: (fixture: Fixture, dir?: string) => Promise<string>;
  now?: () => Date;
  dispatchFetch?: (
    url: string,
    sourceType: AddPostSourceType,
    deps?: DispatchFetchDeps,
  ) => Promise<RawItemUpsert>;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "fixture"
  );
}

function dedupUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    let canonical: string;
    try {
      canonical = new URL(u).toString();
    } catch {
      canonical = u;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(u);
  }
  return out;
}

function syntheticInsert(url: string): RawItemUpsert {
  return {
    sourceType: "web_search",
    externalId: `manual:${url}`,
    title: url,
    url,
    content: null,
    publishedAt: null,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
  };
}

function toFixtureItem(
  item: RawItemUpsert,
  rawItemId: number,
): FixtureItem {
  const enriched: EnrichedLinkContent | null =
    item.metadata?.enrichedLink ?? null;
  const enrichmentStatus =
    enriched?.status === "ok" ? "ok" : enriched?.status === "skipped" ? "skipped" : "failed";
  return {
    rawItemId,
    title: enriched?.status === "ok" && enriched.title ? enriched.title : item.title,
    url: item.url,
    sourceType: item.sourceType,
    publishedAt: item.publishedAt
      ? (item.publishedAt instanceof Date
          ? item.publishedAt.toISOString()
          : String(item.publishedAt))
      : null,
    content: item.content ?? null,
    enrichedLink: enriched,
    enrichmentStatus,
    comments: item.metadata?.comments ?? [],
    engagement: item.engagement ?? { points: 0, commentCount: 0 },
  };
}

export interface CreateManualFixtureResult {
  fixture: Fixture;
  path: string;
  enrichment: {
    attempted: number;
    ok: number;
    failed: number;
    skipped: number;
  };
}

export async function createManualFixture(
  urls: string[],
  opts: CreateManualFixtureOptions = {},
  deps: CreateManualFixtureDeps = {},
): Promise<CreateManualFixtureResult> {
  const logger = opts.logger ?? createLogger("eval:manual-fixture");
  const enrichFn = deps.enrichRawItems ?? defaultEnrichRawItems;
  const writeFn = deps.writeFixture ?? defaultWriteFixture;
  const dispatchFn = deps.dispatchFetch ?? defaultDispatchFetch;
  const now = (deps.now ?? (() => new Date()))();

  const deduped = dedupUrls(urls);
  if (deduped.length === 0) {
    throw new Error("createManualFixture: no urls provided");
  }

  const dispatchDeps: DispatchFetchDeps = {
    signal: deps.signal,
    fetchFn: deps.fetchFn,
  };

  // Cap concurrency so 50 pasted URLs don't fan out 50 parallel
  // HN/Reddit requests — those platforms will rate-limit and we'd be
  // rude. 5 in flight is plenty for the typical fixture size.
  const COLLECTOR_CONCURRENCY = 5;
  interface ResolvedItem {
    insert: RawItemUpsert;
    needsEnrichment: boolean;
  }
  const resolved: ResolvedItem[] = Array.from(
    { length: deduped.length },
    () => ({ insert: syntheticInsert(""), needsEnrichment: false }),
  );
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= deduped.length) return;
      const url = deduped[i];
      const sourceType = detectAddPostSourceType(url);
      try {
        const insert = await dispatchFn(url, sourceType, dispatchDeps);
        resolved[i] = { insert, needsEnrichment: false };
        continue;
      } catch (err) {
        logger.warn(
          {
            event: "eval.manual-fixture.collector_fallback",
            url,
            sourceType,
            error: err instanceof Error ? err.message : String(err),
          },
          "eval.manual-fixture.collector_fallback",
        );
      }

      // Native collector threw. For hn/reddit URLs the link-enrichment
      // classifier would mark the URL "same-platform" and skip it, leaving
      // the rank-body-loader to fetch live at rank time (often 429/404).
      // Reuse the existing web fetcher to extract body content directly,
      // bypassing the enrichment classifier. If even that fails we drop
      // back to a synthetic placeholder so the fixture build still completes.
      if (sourceType !== "web") {
        try {
          const insert = await dispatchFn(url, "web", dispatchDeps);
          resolved[i] = { insert, needsEnrichment: false };
          continue;
        } catch (webErr) {
          logger.warn(
            {
              event: "eval.manual-fixture.web_fallback_failed",
              url,
              error: webErr instanceof Error ? webErr.message : String(webErr),
            },
            "eval.manual-fixture.web_fallback_failed",
          );
        }
      }

      resolved[i] = { insert: syntheticInsert(url), needsEnrichment: true };
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(COLLECTOR_CONCURRENCY, deduped.length) },
      () => worker(),
    ),
  );

  const inserts = resolved.map((r) => r.insert);
  const counters = newCounters();
  const ctx: EnrichmentContext = {
    logger,
    cache: new Map(),
    counters,
  };

  const toEnrich = resolved
    .filter((r) => r.needsEnrichment)
    .map((r) => r.insert);
  if (toEnrich.length > 0) {
    await enrichFn(toEnrich, ctx);
  }

  const items: FixtureItem[] = inserts.map((insert, i) =>
    toFixtureItem(insert, -(i + 1)),
  );

  const slug = slugify(opts.name ?? "fixture");
  const fixtureId = `manual-${slug}-${now.getTime()}`;
  const fixture: Fixture = {
    fixtureId,
    source: "manual",
    date: null,
    runId: null,
    model: opts.model ?? DEFAULT_MODEL,
    exportedAt: now.toISOString(),
    pool: items,
    dedupClusters: [],
    originalRankerOutput: null,
  };

  const path = await writeFn(fixture);

  return {
    fixture,
    path,
    enrichment: {
      attempted: counters.attempted,
      ok: counters.ok,
      failed: counters.failed,
      skipped: counters.skipped,
    },
  };
}
