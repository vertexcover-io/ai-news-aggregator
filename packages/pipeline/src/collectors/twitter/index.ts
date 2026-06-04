import type { CollectorResult, SourceUnitResult } from "@newsletter/shared/types";
import type { RawItemInsert } from "@newsletter/shared/db";
import { createLogger } from "@newsletter/shared/logger";
import type {
  NormalizedTweet,
  TwitterClientFetchOptions,
  TwitterClientFetchResult,
  TwitterCollectorDeps,
  TwitterCollectorFailure,
} from "@pipeline/collectors/twitter/types.js";
import { tweetToRawItem } from "@pipeline/collectors/twitter/map.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";
import { enrichRawItems } from "@pipeline/services/link-enrichment/index.js";
import {
  abortRace,
  denormalize,
  isCsrfMismatchError,
  type RettiwtRawTweet,
} from "@pipeline/collectors/twitter/clients/rettiwt.js";

const logger = createLogger("collector:twitter");

const DEFAULT_MAX_TWEETS_PER_SOURCE = 200;
const RETRY_DELAYS_MS = [250, 1000, 4000] as const;
const OUT_OF_WINDOW_STREAK_LIMIT = 30;
const MAX_PAGES = 10;

type SourceKind = "list" | "user";

interface Source {
  kind: SourceKind;
  id: string;
}

type ErrorCode = "not_found" | "rate_limit" | "schema" | "auth" | "unknown";

class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function errStatus(err: unknown): number | undefined {
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return undefined;
}

function isAuthError(err: unknown): boolean {
  const msg = errMessage(err);
  if (msg.includes("Not authorized to access requested resource")) return true;
  if (/not authorized/i.test(msg)) return true;
  const status = errStatus(err);
  if (status === 401 || status === 403) return true;
  return false;
}

function is429(err: unknown): boolean {
  if (errStatus(err) === 429) return true;
  const msg = errMessage(err);
  if (msg.includes("429")) return true;
  if (/rate.?limit/i.test(msg)) return true;
  return false;
}

function is404(err: unknown): boolean {
  if (errStatus(err) === 404) return true;
  const msg = errMessage(err);
  if (msg.includes("404")) return true;
  if (/not found/i.test(msg)) return true;
  return false;
}

function isSchemaError(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "ZodError"
  ) {
    return true;
  }
  const msg = errMessage(err);
  return /schema|invalid (?:shape|payload|response)/i.test(msg);
}

function classifyError(err: unknown): ErrorCode {
  if (isAuthError(err)) return "auth";
  if (is429(err)) return "rate_limit";
  if (is404(err)) return "not_found";
  if (isSchemaError(err)) return "schema";
  return "unknown";
}

async function retryOn429<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let lastErr: unknown;
  for (const delayMs of RETRY_DELAYS_MS) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!is429(err)) throw err;
      await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface FetchSourceOutcome {
  tweets: NormalizedTweet[];
  pagesFetched: number;
}

async function fetchSource(
  source: Source,
  deps: TwitterCollectorDeps,
  config: TwitterCollectConfig,
  sleep: (ms: number) => Promise<void>,
  now: () => Date,
): Promise<FetchSourceOutcome> {
  const max = config.maxTweetsPerSource ?? DEFAULT_MAX_TWEETS_PER_SOURCE;
  const cutoff =
    config.sinceHours !== undefined && config.sinceHours > 0
      ? now().getTime() - config.sinceHours * 60 * 60 * 1000
      : null;

  const all: NormalizedTweet[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let outOfWindowStreak = 0;

  while (all.length < max && pagesFetched < MAX_PAGES) {
    if (deps.signal?.aborted) throw new AbortError();
    const opts: TwitterClientFetchOptions = {
      maxTweets: max,
      cursor,
      signal: deps.signal,
    };
    const res: TwitterClientFetchResult = await retryOn429(
      () =>
        source.kind === "list"
          ? deps.client.fetchListTweets(source.id, opts)
          : deps.client.fetchUserTimeline(source.id, opts),
      sleep,
    );
    pagesFetched += 1;

    for (const t of res.tweets) {
      if (cutoff !== null) {
        const eventTime = new Date(t.eventCreatedAt).getTime();
        if (!Number.isNaN(eventTime) && eventTime < cutoff) {
          outOfWindowStreak += 1;
          if (outOfWindowStreak >= OUT_OF_WINDOW_STREAK_LIMIT) {
            return { tweets: all, pagesFetched };
          }
          continue;
        }
      }
      outOfWindowStreak = 0;
      all.push(t);
      if (all.length >= max) return { tweets: all, pagesFetched };
    }

    if (!res.nextCursor) return { tweets: all, pagesFetched };
    cursor = res.nextCursor;
  }

  return { tweets: all, pagesFetched };
}

function dedupByExternalId(items: RawItemInsert[]): RawItemInsert[] {
  const seen = new Set<string>();
  const out: RawItemInsert[] = [];
  for (const item of items) {
    if (seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    out.push(item);
  }
  return out;
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}

interface SourceMeta {
  identifier: string;
  displayName: string;
}

function buildSourceMeta(source: Source, userIdToHandle: Map<string, string>): SourceMeta {
  return {
    identifier: source.kind === "list" ? `list:${source.id}` : `user:${source.id}`,
    displayName: source.kind === "list" ? `Twitter list ${source.id}` : `@${userIdToHandle.get(source.id) ?? source.id}`,
  };
}

async function enrichAndStoreItems(
  items: RawItemInsert[],
  deps: TwitterCollectorDeps,
): Promise<void> {
  if (deps.enrichment) {
    await enrichRawItems(items, deps.enrichment);
    for (const item of items) {
      if (item.imageUrl != null) continue;
      const enriched = item.metadata?.enrichedLink;
      if (enriched?.status === "ok" && enriched.imageUrl) {
        item.imageUrl = enriched.imageUrl;
      }
    }
  }
  await deps.rawItemsRepo.upsertItems(items);
}

export async function collectTwitter(
  deps: TwitterCollectorDeps,
  config: TwitterCollectConfig,
): Promise<CollectorResult> {
  const now = deps.now ?? ((): Date => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const startMs = now().getTime();

  const apiKey = process.env.RETTIWT_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    logger.error(
      { event: "collector.twitter.missing_api_key" },
      "RETTIWT_API_KEY is missing",
    );
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: now().getTime() - startMs,
      unitResults: [],
    };
  }

  if (config.listIds.length === 0 && config.users.length === 0) {
    logger.info(
      {
        event: "collector.twitter.no_lists_configured",
        sinceHours: config.sinceHours,
        maxTweetsPerSource: config.maxTweetsPerSource,
        listIds: config.listIds,
        users: config.users,
      },
      "no twitter sources configured",
    );
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: now().getTime() - startMs,
      unitResults: [],
    };
  }

  logger.info(
    {
      event: "collector.twitter.started",
      listCount: config.listIds.length,
      userCount: config.users.length,
      sinceHours: config.sinceHours,
      maxTweetsPerSource: config.maxTweetsPerSource,
      listIds: config.listIds,
      users: config.users.map((user) => ({
        handle: user.handle,
        userId: user.userId,
      })),
    },
    "twitter collector started",
  );

  const sources: Source[] = [
    ...config.listIds.map((id): Source => ({ kind: "list", id })),
    ...config.users.map((u): Source => ({ kind: "user", id: u.userId })),
  ];

  const userIdToHandle = new Map<string, string>();
  for (const u of config.users) {
    userIdToHandle.set(u.userId, u.handle);
  }

  const batch: RawItemInsert[] = [];
  const failures: TwitterCollectorFailure[] = [];
  const unitResults: SourceUnitResult[] = [];

  for (const source of sources) {
    checkAborted(deps.signal);
    const sourceStart = now().getTime();
    const { identifier, displayName } = buildSourceMeta(source, userIdToHandle);

    try {
      const outcome = await fetchSource(source, deps, config, sleep, now);
      const rows = outcome.tweets.map((t) =>
        tweetToRawItem(t, { identifier, displayName }),
      );
      batch.push(...rows);
      unitResults.push({
        identifier,
        displayName,
        itemsFetched: outcome.tweets.length,
        status: "completed",
        errors: [],
        durationMs: now().getTime() - sourceStart,
      });
      logger.info(
        {
          event:
            source.kind === "list"
              ? "collector.twitter.list_completed"
              : "collector.twitter.user_completed",
          kind: source.kind,
          sourceId: source.id,
          displayName,
          sinceHours: config.sinceHours,
          tweetsFetched: outcome.tweets.length,
          pagesFetched: outcome.pagesFetched,
        },
        "twitter source completed",
      );
    } catch (err) {
      if (err instanceof AbortError) throw err;
      // If the signal is aborted, the library may surface a generic Error
      // (e.g. rettiwt-api throws `Error("Aborted")`). Propagate the signal's
      // reason so the worker can map it to `cancelled` status — the worker
      // attaches a CancelledError as the abort reason via controller.abort(reason).
      if (deps.signal?.aborted) {
        throw deps.signal.reason ?? new AbortError();
      }
      if (isAuthError(err)) {
        logger.error(
          {
            event: "collector.twitter.auth_failed",
            kind: source.kind,
            sourceId: source.id,
            error: errMessage(err),
          },
          "twitter auth failed",
        );
        throw new Error("twitter auth failed", { cause: err });
      }
      const code = classifyError(err);
      const errorObj = err instanceof Error ? err : new Error(errMessage(err));
      failures.push({ source: source.id, error: errorObj });
      unitResults.push({
        identifier,
        displayName,
        itemsFetched: 0,
        status: "failed",
        errors: [errorObj.message],
        durationMs: now().getTime() - sourceStart,
      });
      logger.warn(
        {
          event:
            source.kind === "list"
              ? "collector.twitter.list_failed"
              : "collector.twitter.user_failed",
          kind: source.kind,
          sourceId: source.id,
          displayName,
          sinceHours: config.sinceHours,
          code,
          error: errorObj.message,
        },
        "twitter source failed",
      );
    }
  }

  const deduped = dedupByExternalId(batch);
  if (deduped.length > 0) {
    await enrichAndStoreItems(deduped, deps);
  }

  if (failures.length === sources.length && sources.length > 0) {
    const ids = failures.map((f) => f.source).join(", ");
    throw new Error(`all twitter sources failed: ${ids}`);
  }

  const durationMs = now().getTime() - startMs;
  logger.info(
    {
      event: "collector.twitter.completed",
      itemsFetched: batch.length,
      itemsStored: deduped.length,
      failureCount: failures.length,
      durationMs,
    },
    "twitter collector completed",
  );

  return {
    itemsFetched: batch.length,
    commentsFetched: 0,
    itemsStored: deduped.length,
    durationMs,
    unitResults,
  };
}

// -----------------------------------------------------------------------------
// Single-tweet fetch path (Add Post feature)
//
// Exposed via the add-post helper. The helper wires the default cookie
// resolver, Rettiwt factory, and CSRF refresher so this file stays free of
// repository / DB / SDK imports (per package-boundary rules).
// -----------------------------------------------------------------------------

const TWEET_URL_RE =
  /^https?:\/\/(?:[a-z0-9-]+\.)?(?:x|twitter)\.com\/(?:[^/]+)\/status\/(\d+)(?:[/?#].*)?$/i;

export function parseTweetIdFromUrl(url: string): string | null {
  const m = TWEET_URL_RE.exec(url);
  return m ? m[1] : null;
}

export interface TwitterCookie {
  apiKey: string;
  source: "db" | "env";
}

export interface SingleTweetClient {
  fetchTweetById(
    id: string,
    signal?: AbortSignal,
  ): Promise<RettiwtRawTweet | null | undefined>;
}

export interface RettiwtTweetFacade {
  tweet: {
    details(id: string): Promise<RettiwtRawTweet | null | undefined>;
  };
}

export interface FetchTwitterPostDeps {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  client?: SingleTweetClient;
  resolveCookie?: () => Promise<TwitterCookie | null>;
  rettiwtFactory?: (apiKey: string) => RettiwtTweetFacade;
  refreshCsrf?: (apiKey: string, source: "db" | "env") => Promise<string | null>;
}

const COOKIES_MISSING_MSG =
  "Twitter cookies not configured — set them at /admin/settings";
const AUTH_FAILED_MSG =
  "Twitter auth failed — rotate cookies at /admin/settings";

function tweetNotFoundMsg(id: string): string {
  return `Tweet not found, deleted, or protected: ${id}`;
}

async function callDetailsWithRetry(
  details: (id: string) => Promise<RettiwtRawTweet | null | undefined>,
  buildDetails: (apiKey: string) => (
    id: string,
  ) => Promise<RettiwtRawTweet | null | undefined>,
  cookie: TwitterCookie,
  id: string,
  signal: AbortSignal | undefined,
  refreshCsrf: FetchTwitterPostDeps["refreshCsrf"],
): Promise<RettiwtRawTweet | null | undefined> {
  try {
    return await abortRace(details(id), signal);
  } catch (err) {
    if (!isCsrfMismatchError(err) || !refreshCsrf) throw err;
    const rotated = await refreshCsrf(cookie.apiKey, cookie.source);
    if (!rotated) throw err;
    const retried = buildDetails(rotated);
    return abortRace(retried(id), signal);
  }
}

function isAuthClass(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: unknown }).status;
    if (status === 401 || status === 403) return true;
    if (err instanceof Error) {
      const msg = err.message;
      if (/not authorized/i.test(msg)) return true;
      if (/invalid authentication/i.test(msg)) return true;
    }
  }
  return false;
}

/**
 * Fetch a single tweet by its public URL. Used by the Add Post feature.
 *
 * @throws Error("not a twitter status URL: <url>") if the URL does not match a
 *   Twitter/X /status/<id> pattern.
 * @throws Error("Twitter cookies not configured — set them at /admin/settings")
 *   if no client seam is provided and `resolveCookie()` returns null.
 * @throws Error("Twitter auth failed — rotate cookies at /admin/settings") if
 *   the underlying SDK throws an auth-class error (synchronously at
 *   construction OR after the CSRF refresh + retry attempt).
 * @throws Error("Tweet not found, deleted, or protected: <id>") if the
 *   underlying SDK returns null/undefined for the tweet ID.
 */
export async function fetchTwitterPost(
  url: string,
  deps: FetchTwitterPostDeps = {},
): Promise<RawItemInsert> {
  const id = parseTweetIdFromUrl(url);
  if (id === null) {
    throw new Error(`not a twitter status URL: ${url}`);
  }

  if (deps.signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  let raw: RettiwtRawTweet | null | undefined;

  if (deps.client) {
    raw = await deps.client.fetchTweetById(id, deps.signal);
  } else {
    if (!deps.resolveCookie) {
      throw new Error(
        "fetchTwitterPost requires either deps.client or deps.resolveCookie",
      );
    }
    const cookie = await deps.resolveCookie();
    if (!cookie) {
      throw new Error(COOKIES_MISSING_MSG);
    }
    if (!deps.rettiwtFactory) {
      throw new Error(
        "fetchTwitterPost requires deps.rettiwtFactory when deps.client is not provided",
      );
    }

    const rettiwtFactory = deps.rettiwtFactory;
    const buildDetails = (
      apiKey: string,
    ): ((id: string) => Promise<RettiwtRawTweet | null | undefined>) => {
      let facade: RettiwtTweetFacade;
      try {
        facade = rettiwtFactory(apiKey);
      } catch {
        throw new Error(AUTH_FAILED_MSG);
      }
      return (tweetId) => facade.tweet.details(tweetId);
    };

    const initialDetails = buildDetails(cookie.apiKey);
    try {
      raw = await callDetailsWithRetry(
        initialDetails,
        buildDetails,
        cookie,
        id,
        deps.signal,
        deps.refreshCsrf,
      );
    } catch (err) {
      if (isAuthClass(err)) {
        throw new Error(AUTH_FAILED_MSG, { cause: err });
      }
      throw err;
    }
  }

  if (raw == null) {
    throw new Error(tweetNotFoundMsg(id));
  }

  return tweetToRawItem(denormalize(raw));
}
