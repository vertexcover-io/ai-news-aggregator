/**
 * Builds the default RedditCollectorDeps for production use.
 *
 * The collector itself is db-free; token resolution is wired here using the
 * shared app_credentials repo (DB-first, APIFY_API_KEY env fallback).
 *
 * Kept as a lazy dynamic-import factory (matching the twitter pattern in
 * add-post/dispatch.ts) so that the collector module remains free of
 * direct db/cipher imports (enforced by newsletter/enforce-repository-access).
 */

export interface RedditTokenResult {
  apiToken: string;
  source: "db" | "env";
}

let cachedResolveToken: (() => Promise<RedditTokenResult | null>) | null = null;

/**
 * Returns a resolveToken function wired to the shared app_credentials repo.
 * The result is cached so repo/cipher setup happens once per process.
 */
export async function buildRedditResolveToken(): Promise<
  () => Promise<RedditTokenResult | null>
> {
  if (cachedResolveToken) return cachedResolveToken;

  const [
    { resolveApifyApiToken },
    { createAppCredentialsRepo },
    { getDb },
    { getCredentialCipher },
  ] = await Promise.all([
    import("@pipeline/services/credential-resolver.js"),
    import("@pipeline/repositories/app-credentials.js"),
    import("@newsletter/shared/db"),
    import("@newsletter/shared/services/credential-cipher"),
  ]);

  const repo = createAppCredentialsRepo(getDb(), getCredentialCipher());

  cachedResolveToken = () =>
    resolveApifyApiToken({ appRepo: repo, env: process.env });

  return cachedResolveToken;
}
