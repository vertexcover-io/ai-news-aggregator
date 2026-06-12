import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import type { Logger } from "@newsletter/shared/logger";

import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";
import {
  resolveTwitterOAuth1Credentials,
  type TwitterOAuth1Creds,
} from "@pipeline/services/credential-resolver.js";

import { createTwitterApiClient } from "./api-client.js";
import {
  createOAuth2TwitterApiClient,
  type OAuth2TwitterClientDeps,
  type TwitterOAuth2AppClient,
} from "./oauth2-client.js";
import type { TwitterApiClient } from "./types.js";

/** Shared Twitter OAuth2 app client (app-level secret, REQ-082). */
export function readTwitterOAuth2AppClient(
  env: NodeJS.ProcessEnv,
): TwitterOAuth2AppClient | null {
  const clientId = env.TWITTER_OAUTH_CLIENT_ID;
  const clientSecret = env.TWITTER_OAUTH_CLIENT_SECRET;
  if (clientId === undefined || clientId === "") return null;
  if (clientSecret === undefined || clientSecret === "") return null;
  return { clientId, clientSecret };
}

const TWITTER_OAUTH1_ENV_KEYS = [
  "TWITTER_API_KEY",
  "TWITTER_API_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_TOKEN_SECRET",
] as const;

function warnPartialOAuth1Env(env: NodeJS.ProcessEnv, logger: Logger): void {
  const missing = TWITTER_OAUTH1_ENV_KEYS.filter(
    (key) => env[key] === undefined || env[key] === "",
  );
  if (missing.length === 0 || missing.length === TWITTER_OAUTH1_ENV_KEYS.length) {
    return;
  }
  logger.warn(
    { event: "social.twitter.invalid_config", missing: [...missing] },
    "twitter notifier disabled: incomplete OAuth1 configuration",
  );
}

export interface BuildTenantTwitterClientDeps {
  tenantId: string;
  /** Tenant-scoped social-tokens repo. */
  tokens: Pick<SocialTokensRepo, "getToken" | "withTokenLock">;
  /** Tenant-scoped social-credentials repo (legacy manual keys, tenant 0 only). */
  credentials: SocialCredentialsRepo;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
  oauth1Factory?: (creds: TwitterOAuth1Creds) => TwitterApiClient;
  oauth2Factory?: (deps: OAuth2TwitterClientDeps) => TwitterApiClient;
  refreshFn?: OAuth2TwitterClientDeps["refreshFn"];
  now?: () => Date;
}

/**
 * Resolve the Twitter posting client for a tenant:
 *
 * 1. OAuth2 token row under (tenantId, 'twitter') → per-tenant OAuth2 client
 *    with refresh rotation (REQ-081).
 * 2. No row + tenant 0 → legacy OAuth1.0a manual keys (DB row first, then
 *    env TWITTER_API_KEY/... — NF3 backwards compatibility, tenant 0 ONLY).
 * 3. Otherwise null (tenant not connected → posting skips).
 */
export async function buildTenantTwitterApiClient(
  deps: BuildTenantTwitterClientDeps,
): Promise<TwitterApiClient | null> {
  const env = deps.env ?? process.env;

  const row = await deps.tokens.getToken("twitter");
  if (row !== null) {
    const appClient = readTwitterOAuth2AppClient(env);
    if (appClient === null) {
      deps.logger.warn(
        { event: "social.twitter.oauth2_app_client_unset", tenantId: deps.tenantId },
        "TWITTER_OAUTH_CLIENT_ID/SECRET unset: oauth2 token refresh disabled",
      );
    }
    const factory = deps.oauth2Factory ?? createOAuth2TwitterApiClient;
    return factory({
      tokens: deps.tokens,
      appClient,
      logger: deps.logger,
      refreshFn: deps.refreshFn,
      now: deps.now,
    });
  }

  // NF3: env/manual-key fallback is strictly tenant 0 — other tenants must
  // never inherit the operator's personal posting credentials.
  if (deps.tenantId !== TENANT_ZERO_ID) return null;

  const creds = await resolveTwitterOAuth1Credentials({
    repo: deps.credentials,
    env,
  });
  if (creds === null) {
    warnPartialOAuth1Env(env, deps.logger);
    return null;
  }
  const factory = deps.oauth1Factory ?? createTwitterApiClient;
  return factory(creds);
}
