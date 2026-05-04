import type { CollectorResult } from "@newsletter/shared/types";
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

const logger = createLogger("collector:twitter");

const DEFAULT_MAX_TWEETS_PER_SOURCE = 200;
const RETRY_DELAYS_MS = [250, 1000, 4000] as const;

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

  while (all.length < max) {
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
        const tweetTime = new Date(t.createdAt).getTime();
        if (!Number.isNaN(tweetTime) && tweetTime < cutoff) {
          return { tweets: all, pagesFetched };
        }
      }
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
    };
  }

  if (config.listIds.length === 0 && config.users.length === 0) {
    logger.info(
      { event: "collector.twitter.no_lists_configured" },
      "no twitter sources configured",
    );
    return {
      itemsFetched: 0,
      commentsFetched: 0,
      itemsStored: 0,
      durationMs: now().getTime() - startMs,
    };
  }

  logger.info(
    {
      event: "collector.twitter.started",
      listCount: config.listIds.length,
      userCount: config.users.length,
    },
    "twitter collector started",
  );

  const sources: Source[] = [
    ...config.listIds.map((id): Source => ({ kind: "list", id })),
    ...config.users.map((u): Source => ({ kind: "user", id: u.userId })),
  ];

  const batch: RawItemInsert[] = [];
  const failures: TwitterCollectorFailure[] = [];

  for (const source of sources) {
    checkAborted(deps.signal);

    try {
      const outcome = await fetchSource(source, deps, config, sleep, now);
      const rows = outcome.tweets.map(tweetToRawItem);
      batch.push(...rows);
      logger.info(
        {
          event:
            source.kind === "list"
              ? "collector.twitter.list_completed"
              : "collector.twitter.user_completed",
          kind: source.kind,
          sourceId: source.id,
          tweetsFetched: outcome.tweets.length,
          pagesFetched: outcome.pagesFetched,
        },
        "twitter source completed",
      );
    } catch (err) {
      if (err instanceof AbortError) throw err;
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
      logger.warn(
        {
          event:
            source.kind === "list"
              ? "collector.twitter.list_failed"
              : "collector.twitter.user_failed",
          kind: source.kind,
          sourceId: source.id,
          code,
          error: errorObj.message,
        },
        "twitter source failed",
      );
    }
  }

  const deduped = dedupByExternalId(batch);
  if (deduped.length > 0) {
    await deps.rawItemsRepo.upsertItems(deduped);
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
  };
}
