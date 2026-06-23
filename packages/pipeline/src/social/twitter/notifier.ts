import type { Logger } from "@newsletter/shared/logger";
import { withUtmSource } from "@newsletter/shared/utils";

import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

import { composePosts, type RankedStory } from "../compose.js";
import type { SocialResult } from "../types.js";
import { truncate } from "../utils.js";
import type { TwitterApiClient } from "./types.js";
import { createTwitterOAuth2ApiClient } from "./api-client.js";
import { refreshTwitterToken } from "./oauth.js";

const AUTH_RETRY_STATUSES = new Set([401, 403]);
const REFRESH_SKEW_MS = 60_000;

export interface TwitterNotifierConfig {
  publicArchiveBaseUrl: string;
  twitterIsPremium?: boolean;
}

/**
 * Per-tenant OAuth2 posting (P13, REQ-081): the tenant's token row (keyed
 * `(tenant_id, 'twitter')`) is acquired under a `FOR UPDATE` lock and
 * refreshed via the SHARED app client (`refreshTwitterToken`) when expired —
 * mirror of the D-109 LinkedIn token-refresh pattern.
 */
export interface TwitterOAuth2NotifierDeps {
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  /** Shared Twitter OAuth2 app client (app_credentials, never tenant rows). */
  clientId: string;
  clientSecret: string;
  refreshFn?: typeof refreshTwitterToken;
  /** Injectable for tests. Defaults to `createTwitterOAuth2ApiClient`. */
  clientFactory?: (accessToken: string) => TwitterApiClient;
}

export interface TwitterNotifierDeps {
  /** OAuth1 static client (legacy manual posting keys). Ignored when `oauth2` is set. */
  apiClient?: TwitterApiClient;
  /** Per-tenant OAuth2 token posting (P13, REQ-081). Takes precedence over `apiClient`. */
  oauth2?: TwitterOAuth2NotifierDeps;
  archives: Pick<
    RunArchivesRepo,
    "findById" | "markTwitterPosted" | "recordSocialFailure"
  >;
  rawItems: Pick<RawItemsRepo, "findByIds">;
  config: TwitterNotifierConfig;
  logger: Logger;
  now?: () => Date;
}

type ClientAcquireResult =
  | { ok: true; client: TwitterApiClient }
  | { ok: false; result: SocialResult };

export interface NotifyArchiveReadyInput {
  runId: string;
}

export interface TwitterNotifier {
  notifyArchiveReady(input: NotifyArchiveReadyInput): Promise<SocialResult>;
}

function postFailureReason(status: number): string {
  if (AUTH_RETRY_STATUSES.has(status)) return "auth_failed";
  return `http_${status}`;
}

function stripTrailingSlash(value: string): string {
  if (value.endsWith("/")) return value.slice(0, -1);
  return value;
}

interface ArchiveLike {
  rankedItems: { rawItemId: number; title?: string; summary?: string }[];
}

async function buildStories(
  archive: ArchiveLike,
  rawItems: Pick<RawItemsRepo, "findByIds">,
): Promise<RankedStory[]> {
  const ids = archive.rankedItems.map((r) => r.rawItemId);
  if (ids.length === 0) return [];
  const rows = await rawItems.findByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return archive.rankedItems
    .map((ref) => {
      const raw = byId.get(ref.rawItemId);
      const recap = raw?.metadata.recap;
      return {
        title: ref.title ?? recap?.title ?? raw?.title ?? "",
        summary: ref.summary ?? recap?.summary ?? "",
      };
    })
    .filter((story) => story.title.trim() !== "");
}

export function createTwitterNotifier(
  deps: TwitterNotifierDeps,
): TwitterNotifier {
  const { apiClient, oauth2, archives, rawItems, config, logger } = deps;
  if (apiClient === undefined && oauth2 === undefined) {
    throw new Error(
      "createTwitterNotifier requires either apiClient (OAuth1) or oauth2 (per-tenant tokens)",
    );
  }
  const now = deps.now ?? ((): Date => new Date());

  // Acquire a posting client. OAuth1 → the static client. OAuth2 (P13) →
  // read the tenant's token row under the FOR UPDATE lock; refresh when
  // expired (or when forced by a reactive auth retry) and persist the rotated
  // tokens inside the same transaction — mirror of the LinkedIn D-109 flow.
  const acquireClient = (
    runId: string,
    forceRefresh: boolean,
  ): Promise<ClientAcquireResult> => {
    if (oauth2 === undefined) {
      if (apiClient === undefined) {
        // Unreachable: the constructor guard above requires one of the two.
        throw new Error("twitter notifier has neither apiClient nor oauth2");
      }
      return Promise.resolve({ ok: true, client: apiClient });
    }
    const refreshFn = oauth2.refreshFn ?? refreshTwitterToken;
    const clientFactory = oauth2.clientFactory ?? createTwitterOAuth2ApiClient;
    return oauth2.tokens.withTokenLock<ClientAcquireResult>(
      "twitter",
      async (row, tx) => {
        if (row === null) {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_token", runId },
            "twitter oauth2 token row missing",
          );
          return {
            ok: false,
            result: { status: "skipped", reason: "no_token" },
          };
        }

        const expiredPerDb =
          row.expiresAt.getTime() <= now().getTime() + REFRESH_SKEW_MS;
        if (!forceRefresh && !expiredPerDb) {
          return { ok: true, client: clientFactory(row.accessToken) };
        }

        // Empty-string sentinel: no refresh token was issued.
        if (row.refreshToken === "") {
          logger.error(
            { event: "social.twitter.refresh_unavailable", runId },
            "twitter oauth2 token expired and no refresh_token is stored (reconnect Twitter from /admin/settings)",
          );
          return {
            ok: false,
            result: { status: "failed", reason: "refresh_unavailable" },
          };
        }

        const refreshed = await refreshFn({
          clientId: oauth2.clientId,
          clientSecret: oauth2.clientSecret,
          refreshToken: row.refreshToken,
        });
        if (!refreshed.ok) {
          logger.error(
            {
              event: "social.twitter.refresh_failed",
              runId,
              status: refreshed.status,
              forced: forceRefresh,
            },
            "twitter oauth2 token refresh failed",
          );
          return {
            ok: false,
            result: { status: "failed", reason: "refresh_failed" },
          };
        }
        await tx.saveToken("twitter", {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          metadata: row.metadata,
        });
        return { ok: true, client: clientFactory(refreshed.accessToken) };
      },
    );
  };

  return {
    async notifyArchiveReady(
      input: NotifyArchiveReadyInput,
    ): Promise<SocialResult> {
      const { runId } = input;
      try {
        const archive = await archives.findById(runId);
        if (archive === null) {
          logger.error(
            { event: "social.twitter.archive_missing", runId },
            "twitter archive missing",
          );
          return { status: "failed", reason: "archive_missing" };
        }

        if (archive.twitterPostedAt !== null) {
          logger.info(
            {
              event: "social.twitter.skipped",
              reason: "already_posted",
              runId,
            },
            "twitter notification skipped (already posted)",
          );
          return { status: "skipped", reason: "already_posted" };
        }

        const socialSummary = archive.twitterSummary ?? archive.hook;
        if (socialSummary === null || socialSummary.trim() === "") {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (no twitter summary)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const stories = config.twitterIsPremium === true
          ? await buildStories(archive, rawItems)
          : [];
        const archiveUrl = withUtmSource(`${stripTrailingSlash(config.publicArchiveBaseUrl)}/archive/${runId}`, "twitter");
        const composed = composePosts({
          heading: archive.digestHeadline,
          hook: archive.hook,
          twitterSummary: archive.twitterSummary,
          twitterIsPremium: config.twitterIsPremium === true,
          stories,
        });
        if (composed === null) {
          logger.warn(
            { event: "social.twitter.skipped", reason: "no_headline", runId },
            "twitter notification skipped (compose returned null)",
          );
          return { status: "skipped", reason: "no_headline" };
        }
        if (!composed.twitter.ok) {
          await archives.recordSocialFailure(
            runId,
            "twitter",
            composed.twitter.reason,
          );
          logger.warn(
            {
              event: "social.twitter.skipped",
              reason: composed.twitter.reason,
              runId,
            },
            "twitter notification skipped (composition invalid)",
          );
          return { status: "failed", reason: composed.twitter.reason };
        }

        const acquired = await acquireClient(runId, false);
        if (!acquired.ok) {
          return acquired.result;
        }
        let activeClient = acquired.client;

        let headResult = await activeClient.createPost({
          text: composed.twitter.text,
        });

        // Reactive refresh (OAuth2 only): if Twitter rejects on auth
        // (401/403), force a refresh under the lock and retry once — guards
        // against silent token invalidation that bypassed the TTL check.
        if (
          !headResult.ok &&
          AUTH_RETRY_STATUSES.has(headResult.status) &&
          oauth2 !== undefined
        ) {
          logger.warn(
            {
              event: "social.twitter.auth_retry",
              runId,
              status: headResult.status,
            },
            "twitter post got auth error; forcing refresh and retrying once",
          );
          const reacquired = await acquireClient(runId, true);
          if (!reacquired.ok) {
            await archives.recordSocialFailure(
              runId,
              "twitter",
              `${headResult.status}:${truncate(headResult.body)}`,
            );
            return reacquired.result;
          }
          activeClient = reacquired.client;
          headResult = await activeClient.createPost({
            text: composed.twitter.text,
          });
        }

        if (!headResult.ok) {
          const reason = postFailureReason(headResult.status);
          await archives.recordSocialFailure(
            runId,
            "twitter",
            `${headResult.status}:${truncate(headResult.body)}`,
          );
          logger.error(
            {
              event: "social.twitter.post_failed",
              runId,
              status: headResult.status,
            },
            "twitter post failed",
          );
          return { status: "failed", reason };
        }

        const tweetIds: string[] = [headResult.tweetId];
        const replyResult = await activeClient.createPost({
          text: archiveUrl,
          replyToTweetId: headResult.tweetId,
        });
        if (replyResult.ok) {
          tweetIds.push(replyResult.tweetId);
          logger.info(
            {
              event: "social.twitter.reply_sent",
              runId,
              replyId: replyResult.tweetId,
            },
            "twitter link reply created",
          );
        } else {
          logger.warn(
            {
              event: "social.twitter.reply_failed",
              runId,
              status: replyResult.status,
              body: truncate(replyResult.body),
            },
            "twitter post created but link reply failed",
          );
        }

        await archives.markTwitterPosted(
          runId,
          now(),
          headResult.tweetUrl,
          tweetIds,
        );
        logger.info(
          {
            event: "social.twitter.sent",
            runId,
            permalink: headResult.tweetUrl,
            tweetCount: tweetIds.length,
          },
          "twitter post created",
        );
        return { status: "posted", permalink: headResult.tweetUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { event: "social.twitter.unexpected", runId, error: message },
          "twitter notifier threw unexpectedly",
        );
        return { status: "failed", reason: "unexpected" };
      }
    },
  };
}
