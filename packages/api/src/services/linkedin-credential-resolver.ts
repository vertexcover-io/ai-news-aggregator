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
import type { SocialCredentialsRepo } from "@api/repositories/social-credentials.js";

export interface LinkedInClientCreds {
  clientId: string;
  clientSecret: string;
}

export interface ResolveLinkedInClientDeps {
  repo: SocialCredentialsRepo;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_LINKEDIN_API_VERSION = "202511";
const logger = createLogger("service:linkedin-credential-resolver");

function present(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export async function resolveLinkedInClient(
  deps: ResolveLinkedInClientDeps,
): Promise<LinkedInClientCreds | null> {
  // DB-first.
  try {
    const record = await deps.repo.getLinkedIn();
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

export { DEFAULT_LINKEDIN_API_VERSION };
