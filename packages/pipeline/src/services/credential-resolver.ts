import { createLogger } from "@newsletter/shared/logger";
import type { SocialCredentialsRepo } from "@pipeline/repositories/social-credentials.js";

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

export interface CredentialResolverDeps {
  repo: SocialCredentialsRepo;
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
  platform: "linkedin" | "twitter",
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
  const dbRead = await safeGetDbRow(() => deps.repo.getLinkedIn(), "linkedin");
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
  const dbRead = await safeGetDbRow(() => deps.repo.getTwitter(), "twitter");
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
