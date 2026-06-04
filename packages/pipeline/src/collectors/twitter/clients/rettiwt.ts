import { MediaType } from "rettiwt-api";
import type {
  NormalizedTweet,
  QuotedTweet,
  TwitterClient,
  TwitterClientFetchOptions,
  TwitterClientFetchResult,
} from "@pipeline/collectors/twitter/types.js";

// Narrowed projection of rettiwt-api's Tweet — only the fields the adapter reads.
// The real `Tweet` class is structurally assignable to this interface, so consumers
// can pass real Rettiwt instances without casts.
export interface RettiwtRawMedia {
  type: MediaType;
  url: string;
}

export interface RettiwtRawUser {
  userName: string;
}

export interface RettiwtRawEntities {
  urls?: string[];
}

export interface RettiwtRawTweet {
  id: string;
  fullText?: string;
  createdAt: string;
  tweetBy?: RettiwtRawUser;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  media?: RettiwtRawMedia[];
  entities?: RettiwtRawEntities;
  retweetedTweet?: RettiwtRawTweet;
  quoted?: RettiwtRawTweet;
}

const SAME_PLATFORM_URL_RE = /^https?:\/\/(?:[^/]*\.)?(?:x\.com|twitter\.com|t\.co)\//i;

function pickExternalUrl(entities: RettiwtRawEntities | undefined): string | undefined {
  const urls = entities?.urls ?? [];
  for (const u of urls) {
    if (typeof u !== "string") continue;
    if (SAME_PLATFORM_URL_RE.test(u)) continue;
    return u;
  }
  return undefined;
}

// The published rettiwt types declare `CursoredData.next: string`, but the live runtime
// emits either a string or `{ value: string }` (observed in the probe at
// docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-pagination.mjs). We accept
// either shape via a relaxed page type rather than narrowing to the published declaration.
export interface RettiwtCursoredPage {
  list: RettiwtRawTweet[];
  next: string | { value: string } | null;
}

export interface RettiwtFacade {
  list: { tweets(id: string, count?: number, cursor?: string): Promise<RettiwtCursoredPage> };
  user: { timeline(id: string, count?: number, cursor?: string): Promise<RettiwtCursoredPage> };
}

interface CreateRettiwtClientDeps {
  rettiwt: RettiwtFacade;
  auth?: RettiwtAuthRefresher;
}

interface RettiwtAuthRefresher {
  refreshCsrfToken(): Promise<boolean>;
}

function extractCursor(next: RettiwtCursoredPage["next"]): string | null {
  if (next === null) return null;
  if (typeof next === "string") return next.length > 0 ? next : null;
  return next.value.length > 0 ? next.value : null;
}

function pickPhotoUrls(media: RettiwtRawMedia[] | undefined): string[] {
  return (media ?? [])
    .filter((m) => m.type === MediaType.PHOTO)
    .map((m) => m.url)
    .filter((u): u is string => typeof u === "string");
}

export function denormalize(t: RettiwtRawTweet): NormalizedTweet {
  const inner = t.retweetedTweet ?? t;
  const handle = inner.tweetBy?.userName ?? "i";
  const photoUrls = pickPhotoUrls(inner.media);

  let quotedTweet: QuotedTweet | undefined;
  if (inner.quoted) {
    const q = inner.quoted;
    const qHandle = q.tweetBy?.userName ?? "i";
    quotedTweet = {
      id: q.id,
      authorHandle: qHandle,
      fullText: q.fullText ?? "",
      url: `https://x.com/${qHandle}/status/${q.id}`,
      createdAt: q.createdAt,
      photoUrls: pickPhotoUrls(q.media),
    };
  }

  return {
    id: inner.id,
    authorHandle: handle,
    fullText: inner.fullText ?? "",
    createdAt: inner.createdAt,
    eventCreatedAt: t.createdAt,
    url: `https://x.com/${handle}/status/${inner.id}`,
    likeCount: inner.likeCount ?? 0,
    retweetCount: inner.retweetCount ?? 0,
    replyCount: inner.replyCount ?? 0,
    quoteCount: inner.quoteCount ?? 0,
    photoUrls,
    isRetweet: !!t.retweetedTweet,
    isQuote: !!t.quoted,
    externalUrl: pickExternalUrl(inner.entities),
    quotedTweet,
  };
}

export function abortRace<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    return Promise.reject(makeAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(makeAbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function makeAbortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function hasTwitterErrorCode(err: unknown, code: number): boolean {
  if (typeof err !== "object" || err === null || !("details" in err)) {
    return false;
  }
  const details = (err as { details: unknown }).details;
  if (!Array.isArray(details)) return false;
  return details.some((detail) => {
    if (typeof detail !== "object" || detail === null || !("code" in detail)) {
      return false;
    }
    return (detail as { code: unknown }).code === code;
  });
}

function hasCsrfMismatchMessage(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("details" in err)) {
    return false;
  }
  const details = (err as { details: unknown }).details;
  if (!Array.isArray(details)) return false;
  return details.some((detail) => {
    if (typeof detail !== "object" || detail === null || !("message" in detail)) {
      return false;
    }
    const message = (detail as { message: unknown }).message;
    return (
      typeof message === "string" &&
      /matching csrf cookie and header/i.test(message)
    );
  });
}

export function isCsrfMismatchError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const status = "status" in err ? (err as { status: unknown }).status : undefined;
  return status === 403 && (hasTwitterErrorCode(err, 353) || hasCsrfMismatchMessage(err));
}

async function withCsrfRefreshRetry<T>(
  operation: () => Promise<T>,
  auth: RettiwtAuthRefresher | undefined,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (!auth || !isCsrfMismatchError(err)) {
      throw err;
    }
    const refreshed = await auth.refreshCsrfToken();
    if (!refreshed) {
      throw err;
    }
    return operation();
  }
}

function toResult(page: RettiwtCursoredPage): TwitterClientFetchResult {
  return {
    tweets: page.list.map(denormalize),
    nextCursor: extractCursor(page.next),
  };
}

export function createRettiwtClient(deps: CreateRettiwtClientDeps): TwitterClient {
  const { auth, rettiwt } = deps;
  return {
    async fetchListTweets(
      listId: string,
      opts: TwitterClientFetchOptions = {},
    ): Promise<TwitterClientFetchResult> {
      const page = await withCsrfRefreshRetry(
        () =>
          abortRace(
            rettiwt.list.tweets(listId, opts.maxTweets, opts.cursor),
            opts.signal,
          ),
        auth,
      );
      return toResult(page);
    },
    async fetchUserTimeline(
      userId: string,
      opts: TwitterClientFetchOptions = {},
    ): Promise<TwitterClientFetchResult> {
      const page = await withCsrfRefreshRetry(
        () =>
          abortRace(
            rettiwt.user.timeline(userId, opts.maxTweets, opts.cursor),
            opts.signal,
          ),
        auth,
      );
      return toResult(page);
    },
  };
}
