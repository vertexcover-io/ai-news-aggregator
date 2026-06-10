import { createLogger } from "@newsletter/shared/logger";
import type { AppCredentialsRepo } from "@pipeline/repositories/app-credentials.js";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";
import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";

export interface LinkedInCreds {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

export interface TwitterOAuth1Creds {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

export interface TwitterOAuth2AppCreds {
  clientId: string;
  clientSecret: string;
}

export interface TwitterOAuth2Token {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TwitterCollectorCookie {
  apiKey: string;
  source: "db" | "env";
}

export interface CredentialResolverDeps {
  /** App-level secrets (LinkedIn client id/secret, Twitter collector cookie, Twitter OAuth2 app) */
  appRepo: AppCredentialsRepo;
  /** Tenant-level OAuth tokens (per-tenant social_credentials rows) */
  socialRepo: SocialCredentialsRepo;
  /** Tenant-level OAuth2 social tokens (per-tenant social_tokens rows) */
  tokensRepo?: SocialTokensRepo;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_LINKEDIN_API_VERSION = "202511";

const logger = createLogger("service:credential-resolver");

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

// Per spec.md ## Edge cases: when the cipher cannot decrypt the row (rotated
// SESSION_SECRET, schema drift, malformed JSON), the resolver MUST log a clear
// error and return null. The corresponding platform SHALL be skipped for that
// run; the pipeline run SHALL NOT fail. We do NOT fall through to env in this
// case — a present-but-undecryptable DB row signals operator intent to use the
// admin UI, and silently using env values would be confusing.
//
// Returns: { ok: row | null } when the read+decrypt succeeds (null = no row),
//          { ok: "decrypt_failed" } when the row exists but cannot be read.
type DbRead<T> = { ok: T | null } | { ok: "decrypt_failed" };

async function safeGetDbRow<T>(
  fetch: () => Promise<T | null>,
  platform: "linkedin" | "twitter" | "twitter_collector",
): Promise<DbRead<T>> {
  try {
    return { ok: await fetch() };
  } catch (error: unknown) {
    logger.error(
      {
        event: "credential.resolver.db_read_failed",
        platform,
        err: error instanceof Error ? error.message : String(error),
      },
      "credential resolver: DB row unreadable (rotated SESSION_SECRET / schema drift); platform will be skipped for this run",
    );
    return { ok: "decrypt_failed" };
  }
}

export async function resolveLinkedInCredentials(
  deps: CredentialResolverDeps,
): Promise<LinkedInCreds | null> {
  // LinkedIn client credentials are app-level → read from app_credentials
  const dbRead = await safeGetDbRow(() => deps.appRepo.getLinkedIn(), "linkedin");
  if (dbRead.ok === "decrypt_failed") return null;
  const dbRow = dbRead.ok;
  if (dbRow) {
    return {
      clientId: dbRow.clientId,
      clientSecret: dbRow.clientSecret,
      apiVersion: dbRow.apiVersion ?? DEFAULT_LINKEDIN_API_VERSION,
    };
  }
  const env = deps.env ?? {};
  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  if (!present(clientId) || !present(clientSecret)) return null;
  return {
    clientId,
    clientSecret,
    apiVersion: present(env.LINKEDIN_API_VERSION)
      ? env.LINKEDIN_API_VERSION
      : DEFAULT_LINKEDIN_API_VERSION,
  };
}

export async function resolveTwitterOAuth1Credentials(
  deps: CredentialResolverDeps,
): Promise<TwitterOAuth1Creds | null> {
  // Twitter OAuth 1.0a tokens are tenant-level → read from social_credentials
  const dbRead = await safeGetDbRow(() => deps.socialRepo.getTwitter(), "twitter");
  if (dbRead.ok === "decrypt_failed") return null;
  const dbRow = dbRead.ok;
  if (dbRow) {
    return {
      appKey: dbRow.apiKey,
      appSecret: dbRow.apiSecret,
      accessToken: dbRow.accessToken,
      accessSecret: dbRow.accessTokenSecret,
    };
  }
  const env = deps.env ?? {};
  const apiKey = env.TWITTER_API_KEY;
  const apiSecret = env.TWITTER_API_SECRET;
  const accessToken = env.TWITTER_ACCESS_TOKEN;
  const accessTokenSecret = env.TWITTER_ACCESS_TOKEN_SECRET;
  if (
    !present(apiKey) ||
    !present(apiSecret) ||
    !present(accessToken) ||
    !present(accessTokenSecret)
  ) {
    return null;
  }
  return {
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken,
    accessSecret: accessTokenSecret,
  };
}

export async function resolveTwitterCollectorCookie(
  deps: CredentialResolverDeps,
): Promise<TwitterCollectorCookie | null> {
  // Twitter collector cookie is app-level → read from app_credentials
  const dbRead = await safeGetDbRow(
    () => deps.appRepo.getTwitterCollector(),
    "twitter_collector",
  );
  if (dbRead.ok === "decrypt_failed") return null;
  const dbRow = dbRead.ok;
  if (dbRow) {
    return { apiKey: dbRow.apiKey, source: "db" };
  }
  const env = deps.env ?? {};
  const apiKey = env.RETTIWT_API_KEY;
  if (!present(apiKey)) return null;
  return { apiKey, source: "env" };
}

/**
 * Resolve app-level Twitter OAuth2 client credentials (client id/secret).
 * These are super-admin managed, stored in app_credentials platform="twitter".
 * Env fallback: TWITTER_OAUTH2_CLIENT_ID / TWITTER_OAUTH2_CLIENT_SECRET.
 */
export async function resolveTwitterOAuth2App(
  deps: CredentialResolverDeps,
): Promise<TwitterOAuth2AppCreds | null> {
  const dbRead = await safeGetDbRow(() => deps.appRepo.getTwitter(), "twitter");
  if (dbRead.ok === "decrypt_failed") return null;
  const dbRow = dbRead.ok;
  if (dbRow) {
    return { clientId: dbRow.clientId, clientSecret: dbRow.clientSecret };
  }
  const env = deps.env ?? {};
  const clientId = env.TWITTER_OAUTH2_CLIENT_ID;
  const clientSecret = env.TWITTER_OAUTH2_CLIENT_SECRET;
  if (!present(clientId) || !present(clientSecret)) return null;
  return { clientId, clientSecret };
}

/**
 * Resolve per-tenant OAuth2 token from social_tokens.
 * If expired and a refresh token is available, refreshes via
 * refreshOAuth2Token with FOR UPDATE lock (mirrors LinkedIn D-109).
 */
export async function resolveTwitterOAuth2Token(
  deps: CredentialResolverDeps,
): Promise<TwitterOAuth2Token | null> {
  const tokensRepo = deps.tokensRepo;
  if (!tokensRepo) return null;

  const appCreds = await resolveTwitterOAuth2App(deps);
  if (!appCreds) return null;

  const REFRESH_SKEW_MS = 5 * 60 * 1000; // 5 minutes

  return tokensRepo.withTokenLock("twitter", async (row, tx) => {
    if (!row) return null;

    const nowEpoch = Date.now();
    const expired = row.expiresAt.getTime() <= nowEpoch + REFRESH_SKEW_MS;
    if (!expired) {
      return { accessToken: row.accessToken, refreshToken: row.refreshToken, expiresAt: row.expiresAt };
    }

    if (row.refreshToken === "") {
      logger.error(
        { event: "social.twitter.refresh_unavailable" },
        "twitter oauth2 token expired and no refresh_token stored",
      );
      return null;
    }

    // Refresh via twitter-api-v2
    const { TwitterApi } = await import("twitter-api-v2");
    const refreshClient = new TwitterApi({
      clientId: appCreds.clientId,
      clientSecret: appCreds.clientSecret,
    });
    const refreshed = await refreshClient.refreshOAuth2Token(row.refreshToken);

    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    await tx.saveToken("twitter", {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? row.refreshToken,
      expiresAt: newExpiresAt,
      metadata: row.metadata,
    });

    return {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? row.refreshToken,
      expiresAt: newExpiresAt,
    };
  });
}
