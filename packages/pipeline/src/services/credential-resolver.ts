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

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export async function resolveLinkedInCredentials(
  deps: CredentialResolverDeps,
): Promise<LinkedInCreds | null> {
  const dbRow = await deps.repo.getLinkedIn();
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
  const dbRow = await deps.repo.getTwitter();
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
