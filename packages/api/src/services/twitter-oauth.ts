/**
 * Twitter OAuth2 provider wrapper (P13, REQ-081).
 *
 * Thin adapter over `twitter-api-v2` so the route stays testable without the
 * live 3-legged flow: tests inject a fake `TwitterOAuthProvider`; production
 * uses `createTwitterOAuthProvider()` which delegates to
 * `generateOAuth2AuthLink` → `loginWithOAuth2` (probe-confirmed call shapes).
 */
import { TwitterApi } from "twitter-api-v2";
import { createLogger } from "@newsletter/shared/logger";

/** OAuth2 scopes for per-tenant posting: read+write tweets, identify the user, refresh offline. */
export const TWITTER_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const;

export interface TwitterAuthLink {
  url: string;
  codeVerifier: string;
  state: string;
}

export interface TwitterClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TwitterExchangeInput extends TwitterClientCredentials {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export type TwitterExchangeResult =
  | {
      ok: true;
      accessToken: string;
      /** null when Twitter did not return a refresh token. */
      refreshToken: string | null;
      expiresAt: Date;
      /** Connected account handle from v2 /users/me — best-effort, null on failure. */
      username: string | null;
    }
  | { ok: false };

export interface TwitterOAuthProvider {
  generateAuthLink(
    input: TwitterClientCredentials & { redirectUri: string },
  ): TwitterAuthLink;
  exchangeCode(input: TwitterExchangeInput): Promise<TwitterExchangeResult>;
}

const logger = createLogger("service:twitter-oauth");

export function createTwitterOAuthProvider(
  options: { TwitterApiCtor?: typeof TwitterApi; now?: () => Date } = {},
): TwitterOAuthProvider {
  const Ctor = options.TwitterApiCtor ?? TwitterApi;
  const now = options.now ?? ((): Date => new Date());

  return {
    generateAuthLink(input): TwitterAuthLink {
      const client = new Ctor({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      });
      const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
        input.redirectUri,
        { scope: [...TWITTER_OAUTH_SCOPES] },
      );
      return { url, codeVerifier, state };
    },

    async exchangeCode(input): Promise<TwitterExchangeResult> {
      const client = new Ctor({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      });
      try {
        const { client: loggedClient, accessToken, refreshToken, expiresIn } =
          await client.loginWithOAuth2({
            code: input.code,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
          });

        // Best-effort identity lookup for the settings "connected as" label —
        // a failure here must not lose the freshly-issued tokens.
        let username: string | null = null;
        try {
          const me = await loggedClient.v2.me();
          username = me.data.username;
        } catch {
          username = null;
        }

        return {
          ok: true,
          accessToken,
          refreshToken: refreshToken ?? null,
          expiresAt: new Date(now().getTime() + expiresIn * 1000),
          username,
        };
      } catch (error: unknown) {
        logger.error(
          {
            event: "twitter.oauth.exchange_failed",
            err: error instanceof Error ? error.message : String(error),
          },
          "twitter oauth2 code exchange failed",
        );
        return { ok: false };
      }
    },
  };
}
