/**
 * YouTube collector — channel discovery via YouTube's public RSS feeds
 * (`/feeds/videos.xml?channel_id=`, no API key) + transcript fetch via the
 * keyless `youtube-transcript` package.
 *
 * Relevance filtering is intentionally NOT done here. Per the design
 * decision behind this collector: a video's transcript is stored as
 * `content` (exactly like the blog collector stores scraped markdown), so
 * the item flows through the SAME dedup → shortlist → rank pipeline as
 * every other source. The rank stage already sees full item content and
 * scores/selects the topN — reusing that existing mechanism instead of
 * inventing a bespoke keyword/LLM pre-filter for YouTube specifically.
 * Recap generation only ever runs on the items that make the final topN cut
 * (see rank.ts), so an irrelevant video is never summarized.
 */
import { XMLParser } from "fast-xml-parser";
import { fetchTranscript as defaultFetchTranscript } from "youtube-transcript";
import type { RawItemInsert } from "@newsletter/shared/db";
import type { CollectorResult, SourceUnitResult } from "@newsletter/shared/types";
import type { YoutubeChannelSource, YoutubeCollectConfig } from "@pipeline/types.js";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import { withAbortSignal } from "@pipeline/lib/abortable-fetch.js";
import { UrlParseError } from "@pipeline/collectors/hn.js";

const logger = createLogger("collector:youtube");

const RSS_BASE = "https://www.youtube.com/feeds/videos.xml";
const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;
const USER_AGENT =
  "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)";

const RATE_LIMIT_MS = 500;
const TRANSCRIPT_RATE_LIMIT_MS = 400;
const MAX_RETRIES = 3;
// Storage ceiling for a transcript — multi-hour podcasts can produce very
// long transcripts; rank.ts already token-truncates per-item bodies before
// they reach the LLM, this is just a sane cap on what raw_items.content holds.
const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_ERROR_LENGTH = 200;

function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > MAX_ERROR_LENGTH ? `${msg.slice(0, MAX_ERROR_LENGTH - 3)}...` : msg;
}

// ── Channel ID resolution (keyless) ───────────────────────────────────────────

/**
 * Extract a canonical channel ID from a value that's already ID-shaped (a
 * bare `UC…` id, or a URL containing `/channel/UC…`). No network call.
 */
export function extractChannelIdFromRef(input: string): string | null {
  const trimmed = input.trim();
  if (CHANNEL_ID_RE.test(trimmed)) return trimmed;
  const match = /\/channel\/(UC[0-9A-Za-z_-]{22})/.exec(trimmed);
  return match?.[1] ?? null;
}

/** Extract the channel ID YouTube embeds in a channel/handle page's HTML. */
export function extractChannelIdFromHtml(html: string): string | null {
  const canonical =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})"/.exec(
      html,
    );
  if (canonical?.[1]) return canonical[1];
  const externalId = /"externalId":"(UC[0-9A-Za-z_-]{22})"/.exec(html);
  return externalId?.[1] ?? null;
}

function toChannelPageUrl(ref: string): string {
  const trimmed = ref.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("@")
    ? `https://www.youtube.com/${trimmed}`
    : `https://www.youtube.com/@${trimmed}`;
}

/**
 * Resolve a channel ID, @handle, or channel/handle/custom URL to a
 * canonical `UC…` channel ID. The RSS feed endpoint only accepts a real
 * channel ID, so handles/custom URLs need a one-time keyless resolution via
 * the public channel page's HTML (no YouTube Data API, no key).
 */
export async function resolveChannelId(
  channelRef: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const direct = extractChannelIdFromRef(channelRef);
  if (direct) return direct;

  const pageUrl = toChannelPageUrl(channelRef);
  const response = await fetchFn(pageUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(
      `failed to resolve YouTube channel "${channelRef}": HTTP ${response.status}`,
    );
  }
  const html = await response.text();
  const id = extractChannelIdFromHtml(html);
  if (!id) {
    throw new Error(`could not resolve a channel id from "${channelRef}"`);
  }
  return id;
}

// ── RSS feed parsing ───────────────────────────────────────────────────────────

export interface YoutubeFeedEntry {
  videoId: string;
  title: string;
  publishedAt: Date | null;
  channelTitle: string;
  viewCount: number;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function parseDateOrNull(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw === "") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t);
}

function readViewCount(entry: Record<string, unknown>): number {
  const group = entry["media:group"];
  if (typeof group !== "object" || group === null) return 0;
  const community = (group as Record<string, unknown>)["media:community"];
  if (typeof community !== "object" || community === null) return 0;
  const stats = (community as Record<string, unknown>)["media:statistics"];
  if (typeof stats !== "object" || stats === null) return 0;
  const views = (stats as Record<string, unknown>)["@_views"];
  const n = typeof views === "string" ? Number.parseInt(views, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Parse a YouTube channel RSS/Atom feed into normalized entries. */
export function parseYoutubeFeedXml(xml: string): YoutubeFeedEntry[] {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const feed = (parsed as Record<string, unknown>).feed;
  if (typeof feed !== "object" || feed === null) return [];
  const feedObj = feed as Record<string, unknown>;
  const channelTitle = typeof feedObj.title === "string" ? feedObj.title : "";
  const rawEntries = feedObj.entry;
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries !== undefined
      ? [rawEntries]
      : [];

  const out: YoutubeFeedEntry[] = [];
  for (const e of entries) {
    if (typeof e !== "object" || e === null) continue;
    const entry = e as Record<string, unknown>;
    const videoId = entry["yt:videoId"];
    const title = entry.title;
    if (typeof videoId !== "string" || videoId === "") continue;
    if (typeof title !== "string" || title === "") continue;
    out.push({
      videoId,
      title,
      publishedAt: parseDateOrNull(entry.published),
      channelTitle,
      viewCount: readViewCount(entry),
    });
  }
  return out;
}

async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  retries: number = MAX_RETRIES,
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetchFn(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) {
        if (response.status === 404 || response.status === 401 || response.status === 403) {
          throw new Error(`Non-retryable HTTP error: ${response.status}`);
        }
        throw new Error(`HTTP error: ${response.status}`);
      }
      return await response.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) throw lastError;
      if (attempt < retries - 1) {
        await delay(Math.pow(2, attempt) * 1000);
      }
    }
  }
  throw lastError ?? new Error("fetch failed after retries");
}

async function fetchChannelFeed(
  channelId: string,
  fetchFn: typeof fetch,
): Promise<YoutubeFeedEntry[]> {
  const url = `${RSS_BASE}?channel_id=${encodeURIComponent(channelId)}`;
  const xml = await fetchWithRetry(fetchFn, url);
  return parseYoutubeFeedXml(xml);
}

function applySinceDays(
  entries: YoutubeFeedEntry[],
  sinceDays: number | undefined,
  referenceDate: Date = new Date(),
): YoutubeFeedEntry[] {
  if (sinceDays === undefined || sinceDays <= 0) return entries;
  const cutoff = referenceDate.getTime() - sinceDays * 86_400_000;
  return entries.filter((e) => e.publishedAt === null || e.publishedAt.getTime() >= cutoff);
}

// ── Transcript fetch ──────────────────────────────────────────────────────────

export interface TranscriptSegment {
  text: string;
  duration: number;
  offset: number;
  lang?: string;
}

export type FetchTranscriptFn = (videoId: string) => Promise<TranscriptSegment[]>;

function truncateTranscript(text: string): string {
  return text.length > MAX_TRANSCRIPT_CHARS
    ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}…`
    : text;
}

/**
 * Fetch and join a video's transcript. Never throws — a missing/disabled
 * transcript (common: auto-captions off, or the "too many requests" error
 * from this unofficial/keyless API) degrades to `null` content rather than
 * failing the whole video, matching how other collectors treat a failed
 * per-item body fetch (see rank-body-loader.ts's body_fetch_failed).
 */
export async function fetchVideoTranscript(
  videoId: string,
  fetchTranscriptFn: FetchTranscriptFn,
): Promise<string | null> {
  try {
    const segments = await fetchTranscriptFn(videoId);
    const joined = segments
      .map((s) => s.text.trim())
      .filter((t) => t.length > 0)
      .join(" ");
    return joined.length > 0 ? truncateTranscript(joined) : null;
  } catch (err) {
    logger.warn(
      {
        event: "collector.youtube.transcript_failed",
        videoId,
        error: truncateError(err),
      },
      "transcript fetch failed",
    );
    return null;
  }
}

// ── Item building ──────────────────────────────────────────────────────────────

export function buildYoutubeRawItem(
  entry: YoutubeFeedEntry,
  channel: YoutubeChannelSource,
  channelId: string,
  transcript: string | null,
): RawItemInsert {
  const now = new Date();
  const url = `https://www.youtube.com/watch?v=${entry.videoId}`;
  return {
    sourceType: "youtube",
    externalId: entry.videoId,
    title: entry.title,
    url,
    sourceUrl: url,
    author: channel.name || entry.channelTitle || null,
    content: transcript,
    publishedAt: entry.publishedAt,
    collectedAt: now,
    engagement: { points: entry.viewCount, commentCount: 0 },
    metadata: { comments: [], channelId },
    updatedAt: now,
  };
}

// ── Batch collection ────────────────────────────────────────────────────────────

export interface YoutubeCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  fetchTranscriptFn?: FetchTranscriptFn;
  signal?: AbortSignal;
}

function channelUnitId(channelId: string): string {
  return `youtube:${channelId}`;
}

export async function collectYoutube(
  deps: YoutubeCollectorDeps,
  config: YoutubeCollectConfig,
): Promise<CollectorResult> {
  const startTime = Date.now();
  const baseFetch = deps.fetchFn ?? fetch;
  const fetchFn = deps.signal ? withAbortSignal(baseFetch, deps.signal) : baseFetch;
  const fetchTranscriptFn = deps.fetchTranscriptFn ?? defaultFetchTranscript;
  const maxItems = config.maxItems;

  if (config.channels.length === 0) {
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: Date.now() - startTime,
      unitResults: [],
    };
  }

  logger.info(
    {
      event: "collector.youtube.started",
      channelCount: config.channels.length,
      maxItems,
      sinceDays: config.sinceDays,
    },
    "youtube collector started",
  );

  const unitResults: SourceUnitResult[] = [];
  const allItems: RawItemInsert[] = [];
  let successfulChannels = 0;

  for (let i = 0; i < config.channels.length; i++) {
    if (deps.signal?.aborted) {
      throw deps.signal.reason instanceof Error
        ? deps.signal.reason
        : new Error("aborted");
    }
    const channel = config.channels[i];
    const channelStart = Date.now();
    try {
      const channelId = await resolveChannelId(channel.channelRef, fetchFn);
      const entries = applySinceDays(
        await fetchChannelFeed(channelId, fetchFn),
        config.sinceDays,
      ).slice(0, maxItems);

      const videoIds = entries.map((e) => e.videoId);
      const existing =
        videoIds.length > 0
          ? await deps.rawItemsRepo.findExistingExternalIds("youtube", videoIds)
          : new Set<string>();
      const newEntries = entries.filter((e) => !existing.has(e.videoId));

      const items: RawItemInsert[] = [];
      for (let j = 0; j < newEntries.length; j++) {
        if (deps.signal?.aborted) break;
        if (j > 0) await delay(TRANSCRIPT_RATE_LIMIT_MS, deps.signal);
        const entry = newEntries[j];
        const transcript = await fetchVideoTranscript(entry.videoId, fetchTranscriptFn);
        items.push(buildYoutubeRawItem(entry, channel, channelId, transcript));
      }

      allItems.push(...items);
      unitResults.push({
        identifier: channelUnitId(channelId),
        displayName: channel.name,
        itemsFetched: items.length,
        status: "completed",
        errors: [],
        durationMs: Date.now() - channelStart,
      });
      successfulChannels += 1;
      logger.info(
        {
          event: "collector.youtube.channel_completed",
          channel: channel.name,
          channelId,
          discovered: entries.length,
          new: newEntries.length,
          withTranscript: items.filter((it) => it.content !== null).length,
          durationMs: Date.now() - channelStart,
        },
        "youtube channel processed",
      );
    } catch (err) {
      if (deps.signal?.aborted) throw err;
      const error = truncateError(err);
      logger.warn(
        {
          event: "collector.youtube.channel_failed",
          channel: channel.name,
          channelRef: channel.channelRef,
          error,
        },
        "youtube channel failed",
      );
      unitResults.push({
        identifier: channel.channelRef,
        displayName: channel.name,
        itemsFetched: 0,
        status: "failed",
        errors: [error],
        durationMs: Date.now() - channelStart,
      });
    }
    if (i !== config.channels.length - 1) {
      await delay(RATE_LIMIT_MS, deps.signal);
    }
  }

  if (successfulChannels === 0) {
    const reasons = unitResults.map((u) => u.errors[0] ?? "unknown").join("; ");
    throw new Error(`all YouTube channels failed: ${reasons}`);
  }

  let itemsStored = 0;
  if (allItems.length > 0) {
    await deps.rawItemsRepo.upsertItems(allItems);
    itemsStored = allItems.length;
  }

  const result: CollectorResult = {
    itemsFetched: allItems.length,
    commentsFetched: 0,
    itemsStored,
    durationMs: Date.now() - startTime,
    unitResults,
  };
  logger.info(
    { event: "collector.youtube.completed", ...result, unitResults: undefined },
    "collection completed",
  );
  return result;
}

// ── Single-video fetch (add-post flow) ──────────────────────────────────────────

const WATCH_ID_RE = /^[0-9A-Za-z_-]{11}$/;

/** Parse a video ID out of a youtube.com/watch, youtu.be, or /shorts/ URL. */
export function parseYoutubeVideoIdFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.split("/").find((segment) => segment.length > 0);
    return id && WATCH_ID_RE.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v");
      return id && WATCH_ID_RE.test(id) ? id : null;
    }
    const shortsMatch = /^\/shorts\/([0-9A-Za-z_-]{11})/.exec(u.pathname);
    if (shortsMatch) return shortsMatch[1];
    return null;
  }

  return null;
}

export interface FetchYoutubePostDeps {
  fetchFn?: typeof fetch;
  fetchTranscriptFn?: FetchTranscriptFn;
  signal?: AbortSignal;
}

export async function fetchYoutubePost(
  url: string,
  deps: FetchYoutubePostDeps = {},
): Promise<RawItemInsert> {
  const videoId = parseYoutubeVideoIdFromUrl(url);
  if (!videoId) {
    throw new UrlParseError(`not a recognized YouTube video URL: ${url}`);
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const fetchTranscriptFn = deps.fetchTranscriptFn ?? defaultFetchTranscript;

  logger.info({ event: "youtube.single.fetch", videoId, url }, "youtube.single.fetch");

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetchFn(watchUrl, { headers: { "User-Agent": USER_AGENT }, signal: deps.signal });
  if (!response.ok) {
    throw new Error(`failed to fetch video page: HTTP ${response.status}`);
  }
  const html = await response.text();

  const titleMatch = /<title>([^<]*)<\/title>/.exec(html);
  const rawTitle = titleMatch?.[1]?.replace(/\s*-\s*YouTube\s*$/, "").trim();
  if (!rawTitle) {
    throw new Error(`YouTube video ${videoId} has no title`);
  }
  const authorMatch = /"author":"([^"]*)"/.exec(html);
  const channelId = extractChannelIdFromHtml(html);

  const transcript = await fetchVideoTranscript(videoId, fetchTranscriptFn);

  const now = new Date();
  return {
    sourceType: "youtube",
    externalId: videoId,
    title: decodeHtmlEntities(rawTitle),
    url: watchUrl,
    sourceUrl: watchUrl,
    author: authorMatch?.[1] ? decodeHtmlEntities(authorMatch[1]) : null,
    content: transcript,
    publishedAt: null,
    collectedAt: now,
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [], ...(channelId ? { channelId } : {}) },
    updatedAt: now,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
