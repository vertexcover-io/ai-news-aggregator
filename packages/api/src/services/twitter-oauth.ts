/**
 * Pure Twitter OAuth2 helpers for the API layer.
 *
 * These are intentional API-local — the API must NOT import from
 * @newsletter/pipeline (enforced by eslint no-restricted-imports).
 *
 * Uses twitter-api-v2 directly for OAuth2 3-legged flow.
 * Confirmed by library-probe (2026-06-10):
 *   generateOAuth2AuthLink → loginWithOAuth2 → refreshOAuth2Token → v2.tweet
 */

import { TwitterApi } from "twitter-api-v2";

export interface BuildTwitterOAuth2AuthLinkInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  TwitterApiCtor?: typeof TwitterApi;
}

export interface TwitterOAuth2AuthLink {
  url: string;
  codeVerifier: string;
  state: string;
  twitterApi: TwitterApi;
}

export interface ParsedTwitterToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

export interface TwitterOAuth2LoginInput {
  twitterApi: TwitterApi;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

const TWITTER_OAUTH2_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
];

export function buildTwitterOAuth2AuthLink(
  input: BuildTwitterOAuth2AuthLinkInput,
): TwitterOAuth2AuthLink {
  const Ctor = input.TwitterApiCtor ?? TwitterApi;
  const twitterApi = new Ctor({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });

  const { url, codeVerifier, state } = twitterApi.generateOAuth2AuthLink(
    input.redirectUri,
    { scope: TWITTER_OAUTH2_SCOPES },
  );

  return { url, codeVerifier, state, twitterApi };
}

export function parseTwitterTokenResponse(raw: {
  client: TwitterApi;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}): ParsedTwitterToken {
  return {
    accessToken: raw.accessToken,
    refreshToken: typeof raw.refreshToken === "string" && raw.refreshToken !== ""
      ? raw.refreshToken
      : null,
    expiresAt: new Date(Date.now() + raw.expiresIn * 1000),
  };
}
