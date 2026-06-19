/**
 * Resolves LinkedIn client credentials DB-first, env-fallback.
 *
 * Mirror of the pipeline's credential-resolver.ts pattern. The API must NOT
 * import @newsletter/pipeline, so this is an independent copy.
 *
 * When the DB row is present but unreadable (rotated SESSION_SECRET), we return
 * null and log rather than silently falling through to env — an unreadable row
 * signals operator intent to use the admin UI, so env-fallback would be
 * confusing.
 */
import { createLogger } from "@newsletter/shared/logger";
import type { AppCredentialsRepo } from "@api/repositories/app-credentials.js";

export interface LinkedInClientCreds {
  clientId: string;
  clientSecret: string;
}

/**
 * P12 (REQ-080/082): the LinkedIn OAuth client is an APP-LEVEL shared secret
 * — resolved from the super-admin `app_credentials` store, never from any
 * tenant's rows.
 */
export interface ResolveLinkedInClientDeps {
  repo: Pick<AppCredentialsRepo, "getLinkedInClient">;
  env?: NodeJS.ProcessEnv;
}

const logger = createLogger("service:linkedin-credential-resolver");

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export async function resolveLinkedInClient(
  deps: ResolveLinkedInClientDeps,
): Promise<LinkedInClientCreds | null> {
  // DB-first.
  try {
    const record = await deps.repo.getLinkedInClient();
    if (record !== null) {
      return { clientId: record.clientId, clientSecret: record.clientSecret };
    }
  } catch (error: unknown) {
    logger.error(
      {
        event: "linkedin.credential.resolver.db_read_failed",
        err: error instanceof Error ? error.message : String(error),
      },
      "linkedin credential resolver: DB row unreadable (rotated SESSION_SECRET / schema drift); platform will be skipped",
    );
    return null;
  }

  // Env fallback.
  const env = deps.env ?? {};
  const clientId = env.LINKEDIN_CLIENT_ID;
  const clientSecret = env.LINKEDIN_CLIENT_SECRET;
  if (!present(clientId) || !present(clientSecret)) return null;
  return { clientId, clientSecret };
}
