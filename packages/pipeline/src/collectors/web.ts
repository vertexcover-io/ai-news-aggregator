import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { RawItemInsert } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import type { SourceUnitResult } from "@newsletter/shared/types";
import type {
  BlogSource,
  CollectorFailure,
  WebCollectConfig,
  WebCollectorResult,
} from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { fetchAdaptive } from "@pipeline/services/web-fetch/index.js";
import {
  runWebCrawl,
  type CrawlJob,
  type CrawlResult,
} from "@pipeline/services/web-crawler.js";

const logger = createLogger("collector:web");

const MAX_ERROR_LENGTH = 200;

export const DiscoverySchema = z.object({
  posts: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      published_at: z.string(),
    }),
  ),
});

export const DetailSchema = z.object({
  title: z.string(),
  author: z.string(),
  published_at: z.string(),
  image_url: z.string(),
});

export type DiscoveredPost = z.infer<typeof DiscoverySchema>["posts"][number];
export type ExtractedFields = z.infer<typeof DetailSchema>;

export async function discoverPostUrls(
  listingUrl: string,
  listingMarkdown: string,
  model: LanguageModel,
): Promise<DiscoveredPost[]> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await generateObject({
    model,
    schema: DiscoverySchema,
    temperature: 0,
    prompt:
      `You are extracting blog post entries from a listing page that has been ` +
      `converted to markdown. The listing URL is ${listingUrl}. Today is ${today}.\n\n` +
      `Find every post-like entry on the page and return it in the schema. Skip ` +
      `obvious non-posts like navigation, footer, and social links.\n\n` +
      `Normalize published_at to ISO 8601 (YYYY-MM-DD). If the page shows a ` +
      `relative date like "2 hours ago", "yesterday", or "3 days ago", compute ` +
      `the absolute date from today. Use empty strings for fields that are not ` +
      `stated on the page. Never invent data.\n\n` +
      `--- BEGIN LISTING MARKDOWN ---\n${listingMarkdown}\n--- END LISTING MARKDOWN ---`,
  });
  return result.object.posts;
}

export async function extractPostFields(
  postUrl: string,
  postMarkdown: string,
  model: LanguageModel,
): Promise<ExtractedFields> {
  const result = await generateObject({
    model,
    schema: DetailSchema,
    temperature: 0,
    prompt:
      `Extract title, author, publish date, and the most relevant image URL from this blog post markdown. ` +
      `The source URL is ${postUrl}. ` +
      `For image_url, select the most relevant or representative image from the markdown based on ` +
      `filename, alt text, and context. Skip icons, logos, tracking pixels, and data URIs. ` +
      `Return an empty string if no suitable image is found. ` +
      `Use empty strings for fields not stated on the page - never invent data.\n\n` +
      `--- BEGIN ARTICLE ---\n${postMarkdown}\n--- END ARTICLE ---`,
  });
  return result.object;
}

export function validateDiscoveredUrls(
  posts: DiscoveredPost[],
  listingMarkdown: string,
): DiscoveredPost[] {
  return posts.filter((p) => listingMarkdown.includes(p.url));
}

export function sortPostsByPublishedAtDesc(posts: DiscoveredPost[]): DiscoveredPost[] {
  return [...posts].sort((a, b) => {
    const ta = parseDateOrNull(a.published_at)?.getTime() ?? -Infinity;
    const tb = parseDateOrNull(b.published_at)?.getTime() ?? -Infinity;
    return tb - ta;
  });
}

const MS_PER_DAY = 86_400_000;

export function applySinceDays(
  posts: DiscoveredPost[],
  sinceDays: number | undefined,
): DiscoveredPost[] {
  if (sinceDays === undefined) return posts;
  const cutoff = Date.now() - sinceDays * MS_PER_DAY;
  return posts.filter((p) => {
    if (!p.published_at) return true;
    const t = Date.parse(p.published_at);
    if (Number.isNaN(t)) return true;
    return t >= cutoff;
  });
}

export function parseDateOrNull(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > MAX_ERROR_LENGTH ? `${msg.slice(0, MAX_ERROR_LENGTH - 3)}...` : msg;
}

export interface WebCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  llmModel?: LanguageModel;
  signal?: AbortSignal;
  runWebCrawl?: typeof runWebCrawl;
}

let cachedDefaultModel: LanguageModel | null = null;

async function resolveDefaultModel(): Promise<LanguageModel> {
  if (cachedDefaultModel) return cachedDefaultModel;
  const { anthropic } = await import("@ai-sdk/anthropic");
  cachedDefaultModel = anthropic("claude-haiku-4-5-20251001");
  return cachedDefaultModel;
}

export async function collectWeb(
  deps: WebCollectorDeps,
  config: WebCollectConfig,
): Promise<WebCollectorResult> {
  const startTime = Date.now();
  const llmModel = deps.llmModel ?? (await resolveDefaultModel());
  const fetcher = deps.runWebCrawl ?? runWebCrawl;

  if (config.sources.length === 0) {
    const durationMs = Date.now() - startTime;
    logger.info(
      {
        event: "collector.web.completed",
        itemsFetched: 0,
        itemsStored: 0,
        failures: 0,
        durationMs,
      },
      "collection completed",
    );
    return { itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs, failures: undefined, unitResults: [] };
  }

  // Pass 1: listings
  const listingJobs: CrawlJob[] = config.sources.map((s) => ({
    kind: "listing" as const,
    sourceName: s.name,
    url: s.listingUrl,
  }));
  logger.info(
    {
      event: "collector.web.started",
      sourceCount: config.sources.length,
      maxItems: config.maxItems,
      sinceDays: config.sinceDays,
      sources: config.sources.map((source) => ({
        name: source.name,
        listingUrl: source.listingUrl,
      })),
    },
    "web collector started",
  );
  const listingResults = await fetcher(listingJobs, { signal: deps.signal });

  // Per source: run discovery LLM + dedup + filter
  interface PerSource {
    source: BlogSource;
    capped: DiscoveredPost[];
    failure?: string;
    sourceFailed: boolean;
  }

  const perSource: PerSource[] = await Promise.all(
    config.sources.map(async (source) => {
      const r = listingResults.get(source.listingUrl);
      if (!r?.ok) {
        logger.warn(
          {
            event: "collector.web.listing_failed",
            source: source.name,
            listingUrl: source.listingUrl,
            sinceDays: config.sinceDays,
            error: r?.error ?? "no result",
          },
          "web listing failed",
        );
        return {
          source,
          capped: [],
          failure: r?.error ?? "no result",
          sourceFailed: true,
        };
      }
      try {
        const discovered = await discoverPostUrls(source.listingUrl, r.result.markdown, llmModel);
        const validated = validateDiscoveredUrls(discovered, r.result.markdown);
        const sorted = sortPostsByPublishedAtDesc(validated);
        const filtered = applySinceDays(sorted, config.sinceDays);
        const capped = filtered.slice(0, config.maxItems);
        logger.info(
          {
            event: "collector.web.listing_completed",
            source: source.name,
            listingUrl: source.listingUrl,
            sinceDays: config.sinceDays,
            discovered: discovered.length,
            validated: validated.length,
            afterSinceDays: filtered.length,
            capped: capped.length,
          },
          "web listing processed",
        );
        return { source, capped, sourceFailed: false };
      } catch (err) {
        logger.warn(
          {
            event: "collector.web.discovery_failed",
            source: source.name,
            listingUrl: source.listingUrl,
            sinceDays: config.sinceDays,
            error: truncateError(err),
          },
          "web listing discovery failed",
        );
        return { source, capped: [], failure: truncateError(err), sourceFailed: true };
      }
    }),
  );

  // Dedup detail URLs against existing external IDs
  const allCappedUrls = perSource.flatMap((ps) => ps.capped.map((p) => p.url));
  const existing = allCappedUrls.length > 0
    ? await deps.rawItemsRepo.findExistingExternalIds("blog", allCappedUrls)
    : new Set<string>();

  const detailJobs: CrawlJob[] = [];
  const postBySource = new Map<string, DiscoveredPost[]>();
  for (const ps of perSource) {
    const newPosts = ps.capped.filter((p) => !existing.has(p.url));
    postBySource.set(ps.source.name, newPosts);
    for (const p of newPosts) {
      detailJobs.push({ kind: "detail" as const, sourceName: ps.source.name, postUrl: p.url, url: p.url });
    }
  }

  // Pass 2: details (only when there is work)
  const detailResults: Map<string, CrawlResult> = detailJobs.length > 0
    ? await fetcher(detailJobs, { signal: deps.signal })
    : new Map<string, CrawlResult>();

  // Aggregate items and failures
  const allItems: RawItemInsert[] = [];
  const allFailures: CollectorFailure[] = [];
  const itemsBySource = new Map<string, number>();

  // Source-level failures (listing + LLM-discovery)
  for (const ps of perSource) {
    if (ps.sourceFailed) {
      allFailures.push({ source: ps.source.name, error: ps.failure ?? "unknown" });
    }
  }

  // Detail-stage results
  const totalToExtract = Array.from(postBySource.values()).reduce(
    (n, posts) => n + posts.filter((p) => detailResults.get(p.url)?.ok).length,
    0,
  );
  const extractStart = Date.now();
  logger.info(
    { event: "web.extract.start", posts: totalToExtract },
    "extracting post fields via LLM",
  );
  let extracted = 0;
  for (const ps of perSource) {
    if (ps.sourceFailed) continue;
    const posts = postBySource.get(ps.source.name) ?? [];
    for (const post of posts) {
      const dr = detailResults.get(post.url);
      if (!dr?.ok) {
        logger.warn(
          {
            event: "collector.web.detail_failed",
            source: ps.source.name,
            postUrl: post.url,
            error: dr?.error ?? "no result",
          },
          "web detail fetch failed",
        );
        allFailures.push({
          source: ps.source.name,
          postUrl: post.url,
          error: dr?.error ?? "no result",
        });
        continue;
      }
      try {
        const fields = await extractPostFields(post.url, dr.result.markdown, llmModel);
        extracted += 1;
        logger.info(
          {
            event: "web.extract.progress",
            source: ps.source.name,
            postUrl: post.url,
            done: extracted,
            total: totalToExtract,
          },
          "extracted post fields",
        );
        const merged: ExtractedFields = {
          title: fields.title.trim() || post.title.trim(),
          author: fields.author,
          published_at: fields.published_at.trim() || post.published_at,
          image_url: (fields.image_url.trim() || dr.result.imageUrl) ?? "",
        };
        if (!merged.title) {
          allFailures.push({ source: ps.source.name, postUrl: post.url, error: "empty title" });
          continue;
        }
        allItems.push(buildRawItem(post.url, dr.result.markdown, merged));
        itemsBySource.set(ps.source.name, (itemsBySource.get(ps.source.name) ?? 0) + 1);
      } catch (err) {
        logger.warn(
          {
            event: "collector.web.detail_failed",
            source: ps.source.name,
            postUrl: post.url,
            error: truncateError(err),
          },
          "web detail extraction failed",
        );
        allFailures.push({ source: ps.source.name, postUrl: post.url, error: truncateError(err) });
      }
    }
  }

  logger.info(
    {
      event: "web.extract.done",
      extracted,
      total: totalToExtract,
      durationMs: Date.now() - extractStart,
    },
    "post field extraction complete",
  );

  if (config.sources.length > 0 && perSource.every((ps) => ps.sourceFailed)) {
    logger.error(
      { event: "collector.web.all_failed", failures: allFailures },
      "all web sources failed",
    );
    throw new Error("all sources failed");
  }

  if (allItems.length > 0) {
    await deps.rawItemsRepo.upsertItems(allItems);
  }

  const durationMs = Date.now() - startTime;
  const unitResults: SourceUnitResult[] = perSource.map((ps) => ({
    identifier: ps.source.listingUrl,
    displayName: ps.source.name,
    itemsFetched: ps.sourceFailed ? 0 : itemsBySource.get(ps.source.name) ?? 0,
    status: ps.sourceFailed ? "failed" : "completed",
    errors: ps.sourceFailed ? [ps.failure ?? "unknown"] : [],
    durationMs: 0,
  }));
  const result: WebCollectorResult = {
    itemsFetched: allItems.length,
    itemsStored: allItems.length,
    commentsFetched: 0,
    durationMs,
    failures: allFailures.length > 0 ? allFailures : undefined,
    unitResults,
  };

  logger.info(
    {
      event: "collector.web.completed",
      itemsFetched: result.itemsFetched,
      itemsStored: result.itemsStored,
      failures: result.failures?.length ?? 0,
      durationMs,
    },
    "collection completed",
  );
  return result;
}

export function buildRawItem(
  postUrl: string,
  markdownBody: string,
  fields: ExtractedFields,
): RawItemInsert {
  const now = new Date();
  const author = fields.author.trim();
  return {
    sourceType: "blog" as const,
    externalId: postUrl,
    title: fields.title,
    url: postUrl,
    sourceUrl: postUrl,
    author: author.length > 0 ? author : null,
    content: markdownBody,
    publishedAt: parseDateOrNull(fields.published_at),
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    imageUrl: fields.image_url.startsWith("http") ? fields.image_url : null,
    updatedAt: now,
  };
}

// -- Single-post fetch (add-post flow) --

export interface FetchWebPostDeps {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

function extractTitle(markdown: string, url: string): string {
  const headingMatch = /^\s*#\s+(.+)$/m.exec(markdown);
  if (headingMatch?.[1]) return headingMatch[1].trim();
  try {
    const u = new URL(url);
    const lastSegment = u.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      return lastSegment.replace(/[-_]/g, " ");
    }
    return u.hostname;
  } catch {
    return url;
  }
}

export async function fetchWebPost(
  url: string,
  deps: FetchWebPostDeps = {},
): Promise<RawItemInsert> {
  logger.info({ event: "web.single.fetch", url }, "web.single.fetch");
  const r = await fetchAdaptive(url, "article", { signal: deps.signal, fetchFn: deps.fetchFn });
  const title = (r.title?.trim() !== "" ? r.title?.trim() : undefined) ?? extractTitle(r.markdown, url);
  const now = new Date();
  return {
    sourceType: "blog",
    externalId: url,
    title,
    url,
    sourceUrl: url,
    author: r.byline?.trim() !== "" ? r.byline?.trim() ?? null : null,
    content: r.markdown,
    publishedAt: null,
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    imageUrl: r.imageUrl,
    updatedAt: now,
  };
}
