import type { Logger } from "@newsletter/shared/logger";
import { withUtmSource } from "@newsletter/shared/utils";

import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

import { composePosts, type RankedStory } from "../compose.js";
import type { SocialResult } from "../types.js";
import { truncate } from "../utils.js";
import type { LinkedInApiClient } from "./types.js";
import { refreshLinkedInToken } from "./oauth.js";

const REFRESH_SKEW_MS = 60_000;
const AUTH_RETRY_STATUSES = new Set([401, 403]);

export interface LinkedInNotifierConfig {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
  publicArchiveBaseUrl: string;
}

export interface LinkedInNotifierDeps {
  apiClient: LinkedInApiClient;
  archives: Pick<
    RunArchivesRepo,
    "findById" | "markLinkedInPosted" | "recordSocialFailure"
  >;
  rawItems: Pick<RawItemsRepo, "findByIds">;
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  refreshFn?: typeof refreshLinkedInToken;
  config: LinkedInNotifierConfig;
  logger: Logger;
  now?: () => Date;
}

interface ArchiveLike {
  rankedItems: { rawItemId: number; title?: string; summary?: string }[];
  hook: string | null;
}

async function buildStories(
  archive: ArchiveLike,
  rawItems: Pick<RawItemsRepo, "findByIds">,
): Promise<RankedStory[]> {
  const ids = archive.rankedItems.map((r) => r.rawItemId);
  if (ids.length === 0) return [];
  const rows = await rawItems.findByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stories: RankedStory[] = [];
  for (const ref of archive.rankedItems) {
    const raw = byId.get(ref.rawItemId);
    const recap = raw?.metadata.recap;
    const title = ref.title ?? recap?.title ?? raw?.title ?? "";
    const summary = ref.summary ?? recap?.summary ?? "";
    if (title.trim() === "" || summary.trim() === "") continue;
    stories.push({ title, summary });
  }
  return stories;
}

export interface NotifyArchiveReadyInput {
  runId: string;
}

export interface LinkedInNotifier {
  notifyArchiveReady(input: NotifyArchiveReadyInput): Promise<SocialResult>;
}

interface AcquiredToken {
  accessToken: string;
  personUrn: string;
}

type AcquireResult =
  | { ok: true; token: AcquiredToken }
  | { ok: false; result: SocialResult };

function stripTrailingSlash(value: string): string {
  if (value.endsWith("/")) return value.slice(0, -1);
  return value;
}

export function createLinkedInNotifier(
  deps: LinkedInNotifierDeps,
): LinkedInNotifier {
  const { apiClient, archives, tokens, config, logger } = deps;
  const refreshFn = deps.refreshFn ?? refreshLinkedInToken;
  const now = deps.now ?? ((): Date => new Date());

  return {
    async notifyArchiveReady(
      input: NotifyArchiveReadyInput,
    ): Promise<SocialResult> {
      const { runId } = input;
      try {
        const archive = await archives.findById(runId);
        if (archive === null) {
          logger.error(
            { event: "social.linkedin.archive_missing", runId },
            "linkedin archive missing",
          );
          return { status: "failed", reason: "archive_missing" };
        }

        if (archive.linkedinPostedAt !== null) {
          logger.info(
            {
              event: "social.linkedin.skipped",
              reason: "already_posted",
              runId,
            },
            "linkedin notification skipped (already posted)",
          );
          return { status: "skipped", reason: "already_posted" };
        }

        const hook = archive.hook;
        const linkedinPostBody = archive.linkedinPostBody;
        const stories = await buildStories(archive, deps.rawItems);
        if (stories.length === 0 && (linkedinPostBody ?? "").trim() === "") {
          logger.warn(
            { event: "social.linkedin.skipped", reason: "no_headline", runId },
            "linkedin notification skipped (no stories)",
          );
          return { status: "skipped", reason: "no_headline" };
        }
        const archiveUrl = withUtmSource(`${stripTrailingSlash(config.publicArchiveBaseUrl)}/archive/${runId}`, "linkedin");
        const composed = composePosts({
          hook,
          linkedinPostBody,
          stories,
        });
        if (composed === null) {
          logger.warn(
            { event: "social.linkedin.skipped", reason: "no_headline", runId },
            "linkedin notification skipped (compose returned null)",
          );
          return { status: "skipped", reason: "no_headline" };
        }
        if (composed.linkedinText === null) {
          logger.warn(
            { event: "social.linkedin.skipped", reason: "no_headline", runId },
            "linkedin notification skipped (compose returned no linkedin text)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const acquire = (forceRefresh: boolean): Promise<AcquireResult> =>
          tokens.withTokenLock<AcquireResult>("linkedin", async (row, tx) => {
            if (row === null) {
              logger.warn(
                { event: "social.linkedin.skipped", reason: "no_token", runId },
                "linkedin token row missing",
              );
              return {
                ok: false,
                result: { status: "skipped", reason: "no_token" },
              };
            }

            const personUrn = row.metadata?.personUrn;
            if (typeof personUrn !== "string" || personUrn === "") {
              logger.error(
                { event: "social.linkedin.no_person_urn", runId },
                "linkedin person urn missing in token metadata",
              );
              return {
                ok: false,
                result: { status: "failed", reason: "no_person_urn" },
              };
            }

            const expiredPerDb =
              row.expiresAt.getTime() <= now().getTime() + REFRESH_SKEW_MS;
            if (!forceRefresh && !expiredPerDb) {
              return {
                ok: true,
                token: { accessToken: row.accessToken, personUrn },
              };
            }

            // LinkedIn apps without "Programmatic refresh tokens" enabled
            // never get a refresh_token. In that case we can't refresh; bail
            // with a clear reason rather than calling the refresh endpoint
            // with an empty string.
            if (row.refreshToken === "") {
              logger.error(
                { event: "social.linkedin.refresh_unavailable", runId },
                "linkedin token expired and no refresh_token is stored (enable Programmatic refresh tokens on the app and re-run auth-linkedin.ts)",
              );
              return {
                ok: false,
                result: { status: "failed", reason: "refresh_unavailable" },
              };
            }

            const refreshed = await refreshFn({
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              refreshToken: row.refreshToken,
            });
            if (!refreshed.ok) {
              logger.error(
                {
                  event: "social.linkedin.refresh_failed",
                  runId,
                  status: refreshed.status,
                  forced: forceRefresh,
                },
                "linkedin token refresh failed",
              );
              return {
                ok: false,
                result: { status: "failed", reason: "refresh_failed" },
              };
            }
            await tx.saveToken("linkedin", {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
              metadata: row.metadata,
            });
            return {
              ok: true,
              token: { accessToken: refreshed.accessToken, personUrn },
            };
          });

        const acquired = await acquire(false);
        if (!acquired.ok) {
          return acquired.result;
        }

        let postResult = await apiClient.createPost({
          accessToken: acquired.token.accessToken,
          personUrn: acquired.token.personUrn,
          text: composed.linkedinText,
          apiVersion: config.apiVersion,
        });

        // Reactive refresh: if LinkedIn rejects on auth (401/403), force a
        // refresh and retry once. Guards against silent token invalidation
        // that bypassed our TTL check.
        if (!postResult.ok && AUTH_RETRY_STATUSES.has(postResult.status)) {
          logger.warn(
            {
              event: "social.linkedin.auth_retry",
              runId,
              status: postResult.status,
            },
            "linkedin post got auth error; forcing refresh and retrying once",
          );
          const reacquired = await acquire(true);
          if (!reacquired.ok) {
            await archives.recordSocialFailure(
              runId,
              "linkedin",
              `${postResult.status}:${truncate(postResult.body)}`,
            );
            return reacquired.result;
          }
          postResult = await apiClient.createPost({
            accessToken: reacquired.token.accessToken,
            personUrn: reacquired.token.personUrn,
            text: composed.linkedinText,
            apiVersion: config.apiVersion,
          });
        }

        if (postResult.ok) {
          // Body ends with "Full breakdown ↓" pointing here; comment is just
          // the URL so it renders as a clickable preview without extra prose.
          const commentResult = await apiClient.createComment({
            accessToken: acquired.token.accessToken,
            personUrn: acquired.token.personUrn,
            postUrn: postResult.postUrn,
            text: archiveUrl,
            apiVersion: config.apiVersion,
          });
          if (!commentResult.ok) {
            logger.warn(
              {
                event: "social.linkedin.comment_failed",
                runId,
                postUrn: postResult.postUrn,
                status: commentResult.status,
                body: truncate(commentResult.body),
              },
              "linkedin post created but link comment failed",
            );
          } else {
            logger.info(
              {
                event: "social.linkedin.comment_sent",
                runId,
                postUrn: postResult.postUrn,
              },
              "linkedin link comment created",
            );
          }
          await archives.markLinkedInPosted(runId, now(), postResult.postUrn);
          logger.info(
            {
              event: "social.linkedin.sent",
              runId,
              permalink: postResult.postUrn,
            },
            "linkedin post created",
          );
          return { status: "posted", permalink: postResult.postUrn };
        }

        if (
          postResult.status === 422 &&
          postResult.errorCode === "DUPLICATE_POST"
        ) {
          await archives.markLinkedInPosted(runId, now(), null);
          logger.warn(
            {
              event: "social.linkedin.duplicate_treated_as_success",
              runId,
            },
            "linkedin returned DUPLICATE_POST; marking as posted with null permalink",
          );
          return { status: "posted", permalink: null };
        }

        await archives.recordSocialFailure(
          runId,
          "linkedin",
          `${postResult.status}:${truncate(postResult.body)}`,
        );
        logger.error(
          {
            event: "social.linkedin.post_failed",
            runId,
            status: postResult.status,
            errorCode: postResult.errorCode,
          },
          "linkedin post failed",
        );
        return { status: "failed", reason: `http_${postResult.status}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { event: "social.linkedin.unexpected", runId, error: message },
          "linkedin notifier threw unexpectedly",
        );
        return { status: "failed", reason: "unexpected" };
      }
    },
  };
}
