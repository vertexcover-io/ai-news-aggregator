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

const logger = createLogger("collector:web");

const JINA_BASE_URL = "https://r.jina.ai/";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_ERROR_LENGTH = 200;
const DEFAULT_POST_CONCURRENCY = 3;

export async function fetchMarkdown(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const headers: Record<string, string> = { Accept: "text/plain" };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchFn(jinaUrl, { headers });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP ${status} for ${url}`);
        }
        throw new Error(`HTTP ${status} for ${url}`);
      }
      const raw = await response.text();
      return raw.trim();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) throw lastError;
      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * RETRY_BASE_DELAY_MS);
      }
    }
  }

  throw lastError ?? new Error(`fetchMarkdown failed after ${MAX_RETRIES} retries`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      `Extract title, author, and publish date from this blog post markdown. ` +
      `The source URL is ${postUrl}. ` +
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
  return msg.length > MAX_ERROR_LENGTH ? msg.slice(0, MAX_ERROR_LENGTH) : msg;
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
): Promise<RawItemInsert> {
  let markdown: string;
  try {
    markdown = await fetchMarkdown(post.url, fetchFn);
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
  };

  if (!mergedFields.title) {
    throw new CollectorError("validate", "empty title");
  }

  return buildRawItem(post.url, markdown, mergedFields);
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
    listingMarkdown = await fetchMarkdown(source.listingUrl, deps.fetchFn);
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
}

let cachedDefaultModel: LanguageModel | null = null;

async function resolveDefaultModel(): Promise<LanguageModel> {
  if (cachedDefaultModel) return cachedDefaultModel;
  const { google } = await import("@ai-sdk/google");
  cachedDefaultModel = google("gemini-2.5-flash");
  return cachedDefaultModel;
}

export async function collectWeb(
  deps: WebCollectorDeps,
  config: WebCollectConfig,
): Promise<WebCollectorResult> {
  const startTime = Date.now();
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
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
    updatedAt: now,
  };
}
