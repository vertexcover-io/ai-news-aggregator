import type { Logger } from "@newsletter/shared/logger";

import type { RunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

import { composePosts } from "../compose.js";
import type { SocialResult } from "../types.js";
import type { LinkedInApiClient } from "./types.js";
import { refreshLinkedInToken } from "./oauth.js";

const REFRESH_SKEW_MS = 60_000;
const FAILURE_BODY_MAX = 500;

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
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  refreshFn?: typeof refreshLinkedInToken;
  config: LinkedInNotifierConfig;
  logger: Logger;
  now?: () => Date;
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

function truncate(value: string): string {
  if (value.length <= FAILURE_BODY_MAX) return value;
  return `${value.slice(0, FAILURE_BODY_MAX)}…`;
}

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

        const headline = archive.digestHeadline;
        if (headline === null || headline.trim() === "") {
          logger.warn(
            { event: "social.linkedin.skipped", reason: "no_headline", runId },
            "linkedin notification skipped (no headline)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const archiveUrl = `${stripTrailingSlash(config.publicArchiveBaseUrl)}/archive/${runId}`;
        const composed = composePosts({
          digestHeadline: headline,
          digestSummary: archive.digestSummary,
          archiveUrl,
        });
        if (composed === null) {
          logger.warn(
            { event: "social.linkedin.skipped", reason: "no_headline", runId },
            "linkedin notification skipped (compose returned null)",
          );
          return { status: "skipped", reason: "no_headline" };
        }

        const acquired = await tokens.withTokenLock<AcquireResult>(
          "linkedin",
          async (row, tx) => {
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

            let accessToken = row.accessToken;
            const needsRefresh =
              row.expiresAt.getTime() <= now().getTime() + REFRESH_SKEW_MS;

            if (needsRefresh) {
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
                  },
                  "linkedin token refresh failed",
                );
                return {
                  ok: false,
                  result: { status: "failed", reason: "refresh_failed" },
                };
              }
              accessToken = refreshed.accessToken;
              await tx.saveToken("linkedin", {
                accessToken: refreshed.accessToken,
                refreshToken: refreshed.refreshToken,
                expiresAt: refreshed.expiresAt,
                metadata: row.metadata,
              });
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

            return { ok: true, token: { accessToken, personUrn } };
          },
        );

        if (!acquired.ok) {
          return acquired.result;
        }

        const postResult = await apiClient.createPost({
          accessToken: acquired.token.accessToken,
          personUrn: acquired.token.personUrn,
          text: composed.linkedinText,
          apiVersion: config.apiVersion,
        });

        if (postResult.ok) {
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

