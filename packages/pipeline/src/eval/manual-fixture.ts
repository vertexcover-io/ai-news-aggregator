import type { RawItemInsert } from "@newsletter/shared/db";
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

export interface CreateManualFixtureOptions {
  name?: string;
  model?: string;
  logger?: Logger;
}

export interface CreateManualFixtureDeps {
  enrichRawItems?: (
    items: RawItemInsert[],
    ctx: EnrichmentContext,
  ) => Promise<RawItemInsert[]>;
  writeFixture?: (fixture: Fixture, dir?: string) => Promise<string>;
  now?: () => Date;
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

function syntheticInsert(url: string): RawItemInsert {
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
  item: RawItemInsert,
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
    comments: [],
    engagement: { points: 0, commentCount: 0 },
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
  const now = (deps.now ?? (() => new Date()))();

  const deduped = dedupUrls(urls);
  if (deduped.length === 0) {
    throw new Error("createManualFixture: no urls provided");
  }

  const inserts = deduped.map(syntheticInsert);
  const counters = newCounters();
  const ctx: EnrichmentContext = {
    logger,
    cache: new Map(),
    counters,
  };

  await enrichFn(inserts, ctx);

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
