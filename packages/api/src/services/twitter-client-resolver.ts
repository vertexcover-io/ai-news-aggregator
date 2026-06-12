/**
 * Resolves the shared Twitter OAuth2 app client DB-first, env-fallback
 * (P13, REQ-081). Mirror of linkedin-credential-resolver.ts.
 *
 * The client is an APP-LEVEL shared secret — resolved from the super-admin
 * `app_credentials` store (`twitter_client` key), never from any tenant's
 * rows. When the DB row is present but unreadable (rotated SESSION_SECRET) we
 * return null and log rather than silently falling through to env.
 */
import { createLogger } from "@newsletter/shared/logger";
import type { AppCredentialsRepo } from "@api/repositories/app-credentials.js";
import type { TwitterClientCredentials } from "@api/services/twitter-oauth.js";

export interface ResolveTwitterClientDeps {
  repo: Pick<AppCredentialsRepo, "getTwitterClient">;
  env?: NodeJS.ProcessEnv;
}

const logger = createLogger("service:twitter-client-resolver");

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export async function resolveTwitterClient(
  deps: ResolveTwitterClientDeps,
): Promise<TwitterClientCredentials | null> {
  // DB-first.
  try {
    const record = await deps.repo.getTwitterClient();
    if (record !== null) {
      return { clientId: record.clientId, clientSecret: record.clientSecret };
    }
  } catch (error: unknown) {
    logger.error(
      {
        event: "twitter.client.resolver.db_read_failed",
        err: error instanceof Error ? error.message : String(error),
      },
      "twitter client resolver: DB row unreadable (rotated SESSION_SECRET / schema drift); platform will be skipped",
    );
    return null;
  }

  // Env fallback.
  const env = deps.env ?? {};
  const clientId = env.TWITTER_OAUTH2_CLIENT_ID;
  const clientSecret = env.TWITTER_OAUTH2_CLIENT_SECRET;
  if (!present(clientId) || !present(clientSecret)) return null;
  return { clientId, clientSecret };
}
