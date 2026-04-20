import pLimit from "p-limit";
import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { RawItemInsert } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import type {
  BlogSource,
  CollectorFailure,
  WebCollectConfig,
  WebCollectorResult,
} from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { fetchMarkdown } from "@pipeline/services/markdown-fetch.js";
import { withAbortSignal } from "@pipeline/lib/abortable-fetch.js";
export { fetchMarkdown };

// ── Image fallback extraction (inlined from web-image-fallback) ───────────────

const META_TAG_RE = /<meta\b[^>]*>/gi;
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const BASE_TAG_RE = /<base\b[^>]*\bhref=(["'])([^"']*)\1[^>]*>/i;

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}=(["'])([^"']*)\\1`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return m[2];
}

function decodeAmpFallback(s: string): string {
  return s.replaceAll("&amp;", "&");
}

function resolveAbsolute(raw: string, baseUrl: string): string | null {
  const decoded = decodeAmpFallback(raw.trim());
  if (!decoded) return null;
  if (decoded.startsWith("data:")) return null;
  try {
    const u = new URL(decoded, baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function extractMetaImage(html: string, effectiveBase: string): string | null {
  const metas = html.match(META_TAG_RE) ?? [];
  let ogImage: string | null = null;
  let twImage: string | null = null;
  for (const tag of metas) {
    const property = attr(tag, "property");
    const name = attr(tag, "name");
    const content = attr(tag, "content");
    if (!content) continue;
    if (!ogImage && property?.toLowerCase() === "og:image") {
      ogImage = resolveAbsolute(content, effectiveBase);
    }
    if (!twImage && (name?.toLowerCase() === "twitter:image" || name?.toLowerCase() === "twitter:image:src")) {
      twImage = resolveAbsolute(content, effectiveBase);
    }
  }
  return ogImage ?? twImage;
}

function extractIconFallback(html: string, effectiveBase: string): string | null {
  const links = html.match(LINK_TAG_RE) ?? [];
  for (const tag of links) {
    const rel = attr(tag, "rel")?.toLowerCase();
    if (rel === "icon" || rel === "shortcut icon") {
      const href = attr(tag, "href");
      if (href) {
        const resolved = resolveAbsolute(href, effectiveBase);
        if (resolved) return resolved;
      }
    }
  }
  return null;
}

export function extractFallbackImage(html: string, baseUrl: string): string | null {
  const baseMatch = BASE_TAG_RE.exec(html);
  let effectiveBase = baseUrl;
  if (baseMatch) {
    const baseHref = baseMatch[2];
    if (baseHref) {
      try {
        effectiveBase = new URL(baseHref, baseUrl).toString();
      } catch { /* keep baseUrl */ }
    }
  }

  const metaImage = extractMetaImage(html, effectiveBase);
  if (metaImage) return metaImage;
  return extractIconFallback(html, effectiveBase);
}

const logger = createLogger("collector:web");

const MAX_ERROR_LENGTH = 200;
const DEFAULT_POST_CONCURRENCY = 3;

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
      `Use empty strings for fields not stated on the page \u2014 never invent data.\n\n` +
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

type FailureStage =
  | "discovery-fetch"
  | "discovery-llm"
  | "discovery-empty"
  | "detail-fetch"
  | "detail-llm"
  | "validate";

class CollectorError extends Error {
  constructor(
    public readonly stage: FailureStage,
    message: string,
  ) {
    super(message);
    this.name = "CollectorError";
  }
}

function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > MAX_ERROR_LENGTH ? `${msg.slice(0, MAX_ERROR_LENGTH - 3)}...` : msg;
}

function logFailure(
  source: string,
  listingUrl: string,
  stage: FailureStage,
  error: string,
  postUrl?: string,
): void {
  logger.warn(
    {
      event: "collector_failure",
      collector: "web",
      source,
      listingUrl,
      stage,
      postUrl,
      error,
    },
    "collector failure",
  );
}

interface ProcessSourceResult {
  items: RawItemInsert[];
  failures: CollectorFailure[];
  sourceFailed: boolean;
}

export async function processOnePost(
  post: DiscoveredPost,
  fetchFn: typeof fetch,
  llmModel: LanguageModel,
  signal?: AbortSignal,
): Promise<RawItemInsert> {
  let markdown: string;
  try {
    markdown = await fetchMarkdown(post.url, { fetchFn });
  } catch (err) {
    throw new CollectorError("detail-fetch", truncateError(err));
  }

  let fields: ExtractedFields;
  try {
    fields = await extractPostFields(post.url, markdown, llmModel);
  } catch (err) {
    throw new CollectorError("detail-llm", truncateError(err));
  }

  const mergedFields: ExtractedFields = {
    title: fields.title.trim() || post.title.trim(),
    author: fields.author,
    published_at: fields.published_at.trim() || post.published_at,
    image_url: fields.image_url,
  };

  if (!mergedFields.title) {
    throw new CollectorError("validate", "empty title");
  }

  let imageUrl: string | null = null;
  const llmImage = mergedFields.image_url.trim();
  if (llmImage.startsWith("http")) {
    imageUrl = llmImage;
  } else {
    try {
      const response = await fetchFn(post.url, { signal });
      if (response.ok) {
        const html = await response.text();
        imageUrl = extractFallbackImage(html, post.url);
      }
    } catch {
      // Best-effort; leave imageUrl null.
    }
  }

  return buildRawItem(post.url, markdown, { ...mergedFields, image_url: imageUrl ?? "" });
}

export async function processSource(
  source: BlogSource,
  config: WebCollectConfig,
  deps: {
    rawItemsRepo: RawItemsRepo;
    fetchFn: typeof fetch;
    llmModel: LanguageModel;
  },
): Promise<ProcessSourceResult> {
  let listingMarkdown: string;
  try {
    listingMarkdown = await fetchMarkdown(source.listingUrl, { fetchFn: deps.fetchFn });
  } catch (err) {
    const error = truncateError(err);
    logFailure(source.name, source.listingUrl, "discovery-fetch", error);
    return {
      items: [],
      failures: [{ source: source.name, error }],
      sourceFailed: true,
    };
  }

  let discovered: DiscoveredPost[];
  try {
    discovered = await discoverPostUrls(source.listingUrl, listingMarkdown, deps.llmModel);
  } catch (err) {
    const error = truncateError(err);
    logFailure(source.name, source.listingUrl, "discovery-llm", error);
    return {
      items: [],
      failures: [{ source: source.name, error }],
      sourceFailed: true,
    };
  }

  const validated = validateDiscoveredUrls(discovered, listingMarkdown);
  const sorted = sortPostsByPublishedAtDesc(validated);
  const filtered = applySinceDays(sorted, config.sinceDays);
  const capped = filtered.slice(0, config.maxItems);

  if (capped.length === 0) {
    const error = "no posts after filter";
    logFailure(source.name, source.listingUrl, "discovery-empty", error);
    return {
      items: [],
      failures: [{ source: source.name, error }],
      sourceFailed: true,
    };
  }

  const existing = await deps.rawItemsRepo.findExistingExternalIds(
    "blog",
    capped.map((p) => p.url),
  );
  const newPosts = capped.filter((p) => !existing.has(p.url));

  if (newPosts.length === 0) {
    return { items: [], failures: [], sourceFailed: false };
  }

  const limit = pLimit(config.postConcurrency ?? DEFAULT_POST_CONCURRENCY);
  const settled = await Promise.allSettled(
    newPosts.map((p) => limit(() => processOnePost(p, deps.fetchFn, deps.llmModel))),
  );

  const items: RawItemInsert[] = [];
  const failures: CollectorFailure[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const post = newPosts[i];
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      const err: unknown = result.reason;
      const stage: FailureStage = err instanceof CollectorError ? err.stage : "detail-llm";
      const error = truncateError(err instanceof Error ? err.message : String(err));
      logFailure(source.name, source.listingUrl, stage, error, post.url);
      failures.push({ source: source.name, postUrl: post.url, error });
    }
  }

  return { items, failures, sourceFailed: false };
}

export interface WebCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  llmModel?: LanguageModel;
  signal?: AbortSignal;
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
  const baseFetch = deps.fetchFn ?? globalThis.fetch;
  const fetchFn = deps.signal ? withAbortSignal(baseFetch, deps.signal) : baseFetch;
  const llmModel = deps.llmModel ?? (await resolveDefaultModel());

  logger.info(
    {
      sourceCount: config.sources.length,
      maxItems: config.maxItems,
      sinceDays: config.sinceDays,
    },
    "collection started",
  );

  const results = await Promise.all(
    config.sources.map((source) =>
      processSource(source, config, {
        rawItemsRepo: deps.rawItemsRepo,
        fetchFn,
        llmModel,
      }),
    ),
  );

  const allItems: RawItemInsert[] = [];
  const allFailures: CollectorFailure[] = [];
  for (const r of results) {
    allItems.push(...r.items);
    allFailures.push(...r.failures);
  }

  if (config.sources.length > 0 && results.every((r) => r.sourceFailed)) {
    throw new Error("all sources failed");
  }

  if (allItems.length > 0) {
    await deps.rawItemsRepo.upsertItems(allItems);
  }

  const durationMs = Date.now() - startTime;
  const result: WebCollectorResult = {
    itemsFetched: allItems.length,
    itemsStored: allItems.length,
    commentsFetched: 0,
    durationMs,
    failures: allFailures.length > 0 ? allFailures : undefined,
  };

  logger.info(
    {
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

// ── Single-post fetch (add-post flow) ────────────────────────────────────────

export interface FetchWebPostDeps {
  fetchMarkdownFn?: typeof fetchMarkdown;
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
  const fetchMarkdownFn = deps.fetchMarkdownFn ?? fetchMarkdown;

  logger.info({ event: "web.single.fetch", url }, "web.single.fetch");

  const markdown = await fetchMarkdownFn(url, {
    signal: deps.signal,
    fetchFn: deps.fetchFn,
  });
  const title = extractTitle(markdown, url);
  const now = new Date();

  return {
    sourceType: "blog",
    externalId: url,
    title,
    url,
    sourceUrl: url,
    author: null,
    content: markdown,
    publishedAt: null,
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    updatedAt: now,
  };
}
