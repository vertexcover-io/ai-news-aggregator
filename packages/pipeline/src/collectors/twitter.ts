import type { RawItemInsert } from "@newsletter/shared/db";
import type {
  CollectorResult,
  RawItemTwitterMetadata,
  RawItemTwitterOrigin,
} from "@newsletter/shared/types";
import { createLogger } from "@newsletter/shared/logger";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { delay } from "@pipeline/lib/delay.js";
import type { TwitterCollectConfig } from "@pipeline/types.js";

const logger = createLogger("collector:twitter");

const RATE_LIMIT_MS = 1000;

// ---------------------------------------------------------------------------
// Library shape — narrow interface so we can mock without pulling the lib
// ---------------------------------------------------------------------------

export interface TwitterTweet {
  id?: string;
  text?: string;
  permanentUrl?: string;
  username?: string;
  name?: string;
  timeParsed?: Date;
  likes?: number;
  replies?: number;
  retweets?: number;
  views?: number;
  isRetweet?: boolean;
  isReply?: boolean;
  photos?: { id: string; url: string; alt_text?: string }[];
  quotedStatus?: TwitterTweet;
}

export interface TwitterClient {
  setCookies(cookies: unknown[]): Promise<void>;
  isLoggedIn?(): Promise<boolean>;
  me?(): Promise<{ username?: string } | null | undefined>;
  getTweets(handle: string, max: number): AsyncIterable<TwitterTweet> | Promise<TwitterTweet[]>;
  fetchListTweets(
    listId: string,
    max: number,
  ): Promise<{ tweets: TwitterTweet[] } | TwitterTweet[]>;
}

export type TwitterClientFactory = () => TwitterClient;

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class TwitterAuthError extends Error {
  override name = "TwitterAuthError" as const;
}

export class TwitterRateLimitError extends Error {
  override name = "TwitterRateLimitError" as const;
  readonly partialItemCount: number;
  constructor(message: string, partialItemCount: number) {
    super(message);
    this.partialItemCount = partialItemCount;
  }
}

export class TwitterFetchError extends Error {
  override name = "TwitterFetchError" as const;
}

// ---------------------------------------------------------------------------
// Public deps
// ---------------------------------------------------------------------------

export interface TwitterCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  signal?: AbortSignal;
  clientFactory?: TwitterClientFactory;
  envCookies?: string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseCookieEnv(raw: string | undefined): unknown[] {
  if (!raw || raw.length === 0) {
    throw new TwitterAuthError("TWITTER_COOKIES_JSON not set");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new TwitterAuthError(
      `invalid TWITTER_COOKIES_JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new TwitterAuthError("invalid cookie shape");
  }
  for (const c of parsed) {
    if (typeof c !== "object" || c === null) {
      throw new TwitterAuthError("invalid cookie shape");
    }
    const rec = c as Record<string, unknown>;
    if (typeof rec.name !== "string") {
      throw new TwitterAuthError("invalid cookie shape");
    }
    if (typeof rec.value !== "string") {
      throw new TwitterAuthError("invalid cookie shape");
    }
  }
  return parsed as unknown[];
}

export function buildTitle(text: string): string {
  if (text.length === 0) return "[media]";
  if (text.length <= 200) return text;
  return text.slice(0, 199) + "…";
}

export function buildContent(text: string, quoted?: TwitterTweet): string {
  if (!quoted) return text;
  return `${text}\n\n> ${quoted.text ?? ""}`;
}

export function pickImageUrl(tweet: TwitterTweet): string | null {
  return tweet.photos?.[0]?.url ?? null;
}

export function toRawItem(
  tweet: TwitterTweet,
  origin: RawItemTwitterOrigin,
): RawItemInsert | null {
  if (!tweet.id) {
    logger.warn({ origin }, "tweet missing id; dropping");
    return null;
  }

  const text = tweet.text ?? "";
  const username = tweet.username ?? "unknown";
  const permanentUrl =
    tweet.permanentUrl ?? `https://x.com/${username}/status/${tweet.id}`;

  let publishedAt: Date;
  if (tweet.timeParsed) {
    publishedAt = tweet.timeParsed;
  } else {
    logger.warn({ tweetId: tweet.id }, "tweet missing timeParsed; using now");
    publishedAt = new Date();
  }

  const twitterMeta: RawItemTwitterMetadata = {
    origin,
    retweetCount: tweet.retweets ?? 0,
    viewCount: tweet.views ?? null,
    displayName: tweet.name ?? null,
    isReply: tweet.isReply ?? false,
  };

  return {
    sourceType: "twitter",
    externalId: tweet.id,
    title: buildTitle(text),
    url: permanentUrl,
    sourceUrl: permanentUrl,
    author: username,
    content: buildContent(text, tweet.quotedStatus),
    publishedAt,
    collectedAt: new Date(),
    engagement: { points: tweet.likes ?? 0, commentCount: tweet.replies ?? 0 },
    metadata: {
      comments: [],
      twitter: twitterMeta,
    },
    imageUrl: pickImageUrl(tweet),
    updatedAt: new Date(),
  };
}

async function asArray<T>(
  v: AsyncIterable<T> | Promise<T[]> | T[],
): Promise<T[]> {
  if (Array.isArray(v)) return v;
  if (v instanceof Promise) return v;
  const result: T[] = [];
  for await (const item of v) {
    result.push(item);
  }
  return result;
}

async function unwrapListResult(
  v: Promise<{ tweets: TwitterTweet[] } | TwitterTweet[]>,
): Promise<TwitterTweet[]> {
  const result = await v;
  if (Array.isArray(result)) return result;
  return result.tweets;
}

async function probeAuth(client: TwitterClient): Promise<boolean> {
  try {
    if (client.isLoggedIn) {
      return await client.isLoggedIn();
    }
    if (client.me) {
      const profile = await client.me();
      return profile != null;
    }
    // No probe method available — assume logged in
    return true;
  } catch {
    return false;
  }
}

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("too many requests")
  );
}

// ---------------------------------------------------------------------------
// X GraphQL client — direct fetch against x.com's internal API. Replaces the
// stale agent-twitter-client whose hardcoded bearer + queryIds returned 401.
// Bearer is the public X webapp token; override via TWITTER_BEARER if X rotates.
// QueryIds are extracted from main.js on first call and cached per process.
// ---------------------------------------------------------------------------

const X_BEARER =
  process.env.TWITTER_BEARER ??
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const X_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const X_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_analysis_button_from_backend: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
} as const;

interface CookieRecord {
  name: string;
  value: string;
}

interface XQueryIds {
  UserByScreenName: string;
  UserTweets: string;
  ListLatestTweetsTimeline: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function getPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const k of path) {
    const r = asRecord(cur);
    if (!r) return undefined;
    cur = r[k];
  }
  return cur;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function extractQueryId(js: string, op: string): string | null {
  const re1 = new RegExp(`queryId:"([a-zA-Z0-9_-]{20,})",operationName:"${op}"`);
  const re2 = new RegExp(`operationName:"${op}"[^}]{0,200}queryId:"([a-zA-Z0-9_-]{20,})"`);
  const m1 = re1.exec(js);
  if (m1?.[1]) return m1[1];
  const m2 = re2.exec(js);
  if (m2?.[1]) return m2[1];
  return null;
}

function parseTweetResult(result: unknown): TwitterTweet | null {
  const r = asRecord(result);
  if (!r) return null;
  const inner = asRecord(r.tweet) ?? r;
  const typename = asString(inner.__typename);
  if (typename !== "Tweet" && typename !== "TweetWithVisibilityResults") return null;
  const legacy = asRecord(inner.legacy);
  if (!legacy) return null;
  const restId = asString(inner.rest_id) ?? asString(legacy.id_str);
  if (!restId) return null;
  const note = getPath(inner, ["note_tweet", "note_tweet_results", "result"]);
  const text = asString(asRecord(note)?.text) ?? asString(legacy.full_text) ?? "";
  const userResult = asRecord(getPath(inner, ["core", "user_results", "result"]));
  const screen =
    asString(asRecord(userResult?.legacy)?.screen_name) ??
    asString(asRecord(userResult?.core)?.screen_name);
  const name =
    asString(asRecord(userResult?.legacy)?.name) ??
    asString(asRecord(userResult?.core)?.name);
  const photos: { id: string; url: string }[] = [];
  const media = toArray(
    asRecord(legacy.entities)?.media ?? asRecord(legacy.extended_entities)?.media,
  );
  for (const m of media) {
    const mr = asRecord(m);
    if (asString(mr?.type) === "photo") {
      const url = asString(mr?.media_url_https);
      const id = asString(mr?.id_str) ?? url;
      if (url && id) photos.push({ id, url });
    }
  }
  const quotedRaw = getPath(legacy, ["quoted_status_result", "result"]);
  const quoted = quotedRaw ? parseTweetResult(quotedRaw) ?? undefined : undefined;
  const created = asString(legacy.created_at);
  const timeParsed = created ? new Date(created) : undefined;
  const viewCount = asString(asRecord(inner.views)?.count);
  return {
    id: restId,
    text,
    permanentUrl: screen ? `https://x.com/${screen}/status/${restId}` : undefined,
    username: screen,
    name,
    timeParsed,
    likes: asNumber(legacy.favorite_count) ?? 0,
    replies: asNumber(legacy.reply_count) ?? 0,
    retweets: asNumber(legacy.retweet_count) ?? 0,
    views: viewCount ? Number(viewCount) : undefined,
    isRetweet: asRecord(legacy.retweeted_status_result) !== null,
    isReply: typeof legacy.in_reply_to_status_id_str === "string",
    photos,
    quotedStatus: quoted,
  };
}

function walkTimelineInstructions(instructions: unknown): TwitterTweet[] {
  const out: TwitterTweet[] = [];
  for (const ins of toArray(instructions)) {
    const r = asRecord(ins);
    if (!r) continue;
    if (r.type === "TimelineAddEntries") {
      for (const e of toArray(r.entries)) {
        const result = getPath(e, ["content", "itemContent", "tweet_results", "result"]);
        const t = parseTweetResult(result);
        if (t) out.push(t);
      }
    } else if (r.type === "TimelinePinEntry") {
      const result = getPath(r, ["entry", "content", "itemContent", "tweet_results", "result"]);
      const t = parseTweetResult(result);
      if (t) out.push(t);
    }
  }
  return out;
}

class XGraphQLClient implements TwitterClient {
  private cookieHeader = "";
  private csrf = "";
  private queryIds: XQueryIds | null = null;

  setCookies(cookies: unknown[]): Promise<void> {
    const records: CookieRecord[] = cookies.map((c) => {
      const r = asRecord(c);
      return {
        name: asString(r?.name) ?? "",
        value: asString(r?.value) ?? "",
      };
    });
    this.cookieHeader = records.map((c) => `${c.name}=${c.value}`).join("; ");
    const ct0 = records.find((c) => c.name === "ct0");
    if (!ct0 || ct0.value === "") {
      throw new TwitterAuthError("ct0 cookie missing — re-export TWITTER_COOKIES_JSON");
    }
    this.csrf = ct0.value;
    return Promise.resolve();
  }

  private async ensureQueryIds(): Promise<XQueryIds> {
    if (this.queryIds) return this.queryIds;
    const homeRes = await fetch("https://x.com/", {
      headers: { "user-agent": X_USER_AGENT, cookie: this.cookieHeader },
    });
    const html = await homeRes.text();
    const m = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-z0-9]+\.js/.exec(html);
    if (!m) throw new TwitterFetchError("could not locate main.js URL on x.com");
    const jsRes = await fetch(m[0], { headers: { "user-agent": X_USER_AGENT } });
    const js = await jsRes.text();
    const ids: Partial<XQueryIds> = {
      UserByScreenName: extractQueryId(js, "UserByScreenName") ?? undefined,
      UserTweets: extractQueryId(js, "UserTweets") ?? undefined,
      ListLatestTweetsTimeline: extractQueryId(js, "ListLatestTweetsTimeline") ?? undefined,
    };
    if (!ids.UserByScreenName || !ids.UserTweets || !ids.ListLatestTweetsTimeline) {
      throw new TwitterFetchError(`failed to extract queryIds from main.js: ${JSON.stringify(ids)}`);
    }
    this.queryIds = {
      UserByScreenName: ids.UserByScreenName,
      UserTweets: ids.UserTweets,
      ListLatestTweetsTimeline: ids.ListLatestTweetsTimeline,
    };
    logger.info({ queryIds: this.queryIds }, "extracted X graphql queryIds from main.js");
    return this.queryIds;
  }

  // Calls X's internal GraphQL with the cached queryId for `op`. On HTTP 404
  // the queryId has rotated since extraction; we invalidate the cache,
  // re-extract from main.js, and retry the same call once with the fresh id.
  // Bounded by `_retried` to prevent loops on persistent 404s.
  private async gql(
    op: keyof XQueryIds,
    variables: object,
    _retried = false,
  ): Promise<unknown> {
    const ids = await this.ensureQueryIds();
    const qid = ids[op];
    const url =
      `https://x.com/i/api/graphql/${qid}/${op}` +
      `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
      `&features=${encodeURIComponent(JSON.stringify(X_FEATURES))}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${X_BEARER}`,
        "x-csrf-token": this.csrf,
        cookie: this.cookieHeader,
        "user-agent": X_USER_AGENT,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        origin: "https://x.com",
        referer: "https://x.com/",
      },
    });
    const text = await res.text();
    if (res.status === 404 && !_retried) {
      logger.warn({ op, qid }, "graphql 404 — queryId rotated, refreshing and retrying once");
      this.queryIds = null;
      return this.gql(op, variables, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new TwitterAuthError(`${op} ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 429) {
      throw new Error(`429 rate limit on ${op}`);
    }
    if (res.status !== 200) {
      throw new TwitterFetchError(`${op} ${res.status}: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text);
  }

  async getTweets(handle: string, max: number): Promise<TwitterTweet[]> {
    const u = await this.gql("UserByScreenName", {
      screen_name: handle,
      withSafetyModeUserFields: true,
    });
    const restId = asString(getPath(u, ["data", "user", "result", "rest_id"]));
    if (!restId) throw new TwitterFetchError(`no rest_id for handle "${handle}"`);
    const t = await this.gql("UserTweets", {
      userId: restId,
      count: max,
      includePromotedContent: false,
      withVoice: true,
      withV2Timeline: true,
    });
    const inst = getPath(t, ["data", "user", "result", "timeline", "timeline", "instructions"]);
    return walkTimelineInstructions(inst);
  }

  async fetchListTweets(listId: string, max: number): Promise<{ tweets: TwitterTweet[] }> {
    const r = await this.gql("ListLatestTweetsTimeline", {
      listId,
      count: max,
    });
    const inst = getPath(r, ["data", "list", "tweets_timeline", "timeline", "instructions"]);
    return { tweets: walkTimelineInstructions(inst) };
  }
}

function defaultClientFactory(): TwitterClient {
  return new XGraphQLClient();
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

export async function collectTwitter(
  deps: TwitterCollectorDeps,
  config: TwitterCollectConfig,
): Promise<CollectorResult> {
  const start = Date.now();

  const cookies = parseCookieEnv(deps.envCookies ?? process.env.TWITTER_COOKIES_JSON);

  if (config.users.length + config.listIds.length === 0) {
    return {
      itemsFetched: 0,
      itemsStored: 0,
      commentsFetched: 0,
      durationMs: Date.now() - start,
    };
  }

  const client = (deps.clientFactory ?? defaultClientFactory)();
  await client.setCookies(cookies);

  // Auth probe is a SOFT signal: agent-twitter-client@0.0.18 calls a deprecated
  // X v1.1 endpoint (verify_credentials.json) that now 404s for everyone, so
  // isLoggedIn() returns false even on valid sessions. Log the result, but let
  // the real work (getTweets/fetchListTweets) be the authoritative auth test —
  // on bad cookies those throw 401, which the per-source catch surfaces.
  try {
    const loggedIn = await probeAuth(client);
    if (!loggedIn) {
      logger.warn(
        { event: "twitter.probe.soft_fail" },
        "isLoggedIn returned false; continuing — getTweets is the authoritative auth check",
      );
    }
  } catch (err) {
    logger.warn(
      {
        event: "twitter.probe.error",
        error: err instanceof Error ? err.message : String(err),
      },
      "isLoggedIn threw; continuing — getTweets is the authoritative auth check",
    );
  }

  const items: RawItemInsert[] = [];

  interface SourceDef {
    run: () => Promise<TwitterTweet[]>;
    origin: RawItemTwitterOrigin;
    label: string;
  }

  const allSources: SourceDef[] = [
    ...config.users.map((handle) => ({
      run: () => asArray(client.getTweets(handle, config.maxPerSource)),
      origin: { kind: "user" as const, handle },
      label: `user:${handle}`,
    })),
    ...config.listIds.map((listId) => ({
      run: () => unwrapListResult(client.fetchListTweets(listId, config.maxPerSource)),
      origin: { kind: "list" as const, listId },
      label: `list:${listId}`,
    })),
  ];

  let isFirst = true;
  for (const src of allSources) {
    if (deps.signal?.aborted) break;
    if (!isFirst) {
      await delay(RATE_LIMIT_MS, deps.signal).catch(() => {
        // signal was aborted during delay — break on next iteration check
      });
    }
    isFirst = false;
    if (deps.signal?.aborted) break;

    try {
      const tweets = await src.run();
      for (const t of tweets) {
        if (t.isRetweet) continue;
        const item = toRawItem(t, src.origin);
        if (item) items.push(item);
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        logger.warn({ source: src.label }, "twitter rate-limited; stopping");
        // Upsert whatever items were already collected before the rate-limit hit
        const cutoffPartial = Date.now() - config.sinceDays * 86_400_000;
        const partialFiltered = items.filter(
          (it) => it.publishedAt && it.publishedAt.getTime() >= cutoffPartial,
        );
        if (partialFiltered.length > 0) {
          await deps.rawItemsRepo.upsertItems(partialFiltered);
        }
        throw new TwitterRateLimitError(
          `rate-limited at ${src.label}`,
          partialFiltered.length,
        );
      }
      logger.warn(
        {
          source: src.label,
          error: err instanceof Error ? err.message : String(err),
        },
        "twitter source failed",
      );
    }
  }

  const cutoff = Date.now() - config.sinceDays * 86_400_000;
  const filtered = items.filter(
    (it) => it.publishedAt && it.publishedAt.getTime() >= cutoff,
  );

  let itemsStored = 0;
  if (filtered.length > 0) {
    await deps.rawItemsRepo.upsertItems(filtered);
    itemsStored = filtered.length;
  }

  const result: CollectorResult = {
    itemsFetched: filtered.length,
    commentsFetched: 0,
    itemsStored,
    durationMs: Date.now() - start,
  };

  logger.info(result, "twitter collection completed");

  return result;
}
