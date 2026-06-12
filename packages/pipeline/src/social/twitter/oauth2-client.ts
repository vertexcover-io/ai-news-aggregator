import type { Logger } from "@newsletter/shared/logger";

import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

import { createBearerTwitterApiClient } from "./api-client.js";
import { refreshTwitterToken } from "./oauth.js";
import type {
  TwitterApiClient,
  TwitterCreatePostInput,
  TwitterCreatePostResult,
  TwitterCredentialValidationResult,
} from "./types.js";

const REFRESH_SKEW_MS = 60_000;

export interface TwitterOAuth2AppClient {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2TwitterClientDeps {
  /** Tenant-scoped social-tokens repo (token row under (tenantId, 'twitter')). */
  tokens: Pick<SocialTokensRepo, "withTokenLock">;
  /** Shared Twitter OAuth2 app client; null disables refresh (token usable until expiry). */
  appClient: TwitterOAuth2AppClient | null;
  logger: Logger;
  clientFactory?: (accessToken: string) => TwitterApiClient;
  refreshFn?: typeof refreshTwitterToken;
  now?: () => Date;
}

type AcquireResult =
  | { ok: true; accessToken: string }
  | { ok: false; status: number; body: string };

/**
 * TwitterApiClient backed by a per-tenant OAuth2 user token (REQ-081).
 *
 * Each call acquires a valid access token under the social_tokens row lock
 * (SELECT ... FOR UPDATE via withTokenLock — same idiom as the LinkedIn
 * notifier): an expired token is refreshed and the ROTATED refresh token is
 * persisted atomically in the same transaction, so concurrent jobs never
 * burn the same single-use refresh token twice.
 */
export function createOAuth2TwitterApiClient(
  deps: OAuth2TwitterClientDeps,
): TwitterApiClient {
  const clientFactory = deps.clientFactory ?? createBearerTwitterApiClient;
  const refreshFn = deps.refreshFn ?? refreshTwitterToken;
  const now = deps.now ?? ((): Date => new Date());
  const { tokens, appClient, logger } = deps;

  const acquire = (): Promise<AcquireResult> =>
    tokens.withTokenLock<AcquireResult>("twitter", async (row, tx) => {
      if (row === null) {
        logger.error(
          { event: "social.twitter.oauth2_no_token" },
          "twitter oauth2 token row missing",
        );
        return { ok: false, status: 401, body: "no_token" };
      }

      const expired =
        row.expiresAt.getTime() <= now().getTime() + REFRESH_SKEW_MS;
      if (!expired) return { ok: true, accessToken: row.accessToken };

      if (row.refreshToken === "" || appClient === null) {
        logger.error(
          {
            event: "social.twitter.oauth2_refresh_unavailable",
            hasRefreshToken: row.refreshToken !== "",
            hasAppClient: appClient !== null,
          },
          "twitter oauth2 token expired and cannot be refreshed (missing refresh token or TWITTER_OAUTH_CLIENT_ID/SECRET)",
        );
        return { ok: false, status: 401, body: "refresh_unavailable" };
      }

      const refreshed = await refreshFn({
        clientId: appClient.clientId,
        clientSecret: appClient.clientSecret,
        refreshToken: row.refreshToken,
      });
      if (!refreshed.ok) {
        logger.error(
          {
            event: "social.twitter.oauth2_refresh_failed",
            status: refreshed.status,
          },
          "twitter oauth2 token refresh failed",
        );
        return { ok: false, status: refreshed.status, body: "refresh_failed" };
      }

      await tx.saveToken("twitter", {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        metadata: row.metadata,
      });
      return { ok: true, accessToken: refreshed.accessToken };
    });

  return {
    async createPost(
      input: TwitterCreatePostInput,
    ): Promise<TwitterCreatePostResult> {
      const acquired = await acquire();
      if (!acquired.ok) return acquired;
      return clientFactory(acquired.accessToken).createPost(input);
    },

    async validateCredentials(): Promise<TwitterCredentialValidationResult> {
      const acquired = await acquire();
      if (!acquired.ok) return acquired;
      return clientFactory(acquired.accessToken).validateCredentials();
    },
  };
}
