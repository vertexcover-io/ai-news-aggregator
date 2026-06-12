import type { SocialTokensRepo } from "@pipeline/repositories/social-tokens.js";
import type { TwitterApiClient } from "@pipeline/social/twitter/types.js";
import { truncate } from "@pipeline/social/utils.js";

export type SocialHealthPlatform = "linkedin" | "twitter";

export interface SocialHealthIssue {
  platform: SocialHealthPlatform;
  reason: string;
  status?: number;
  detail?: string;
}

export interface SocialHealthReport {
  /** Platforms that were actually checked (connected for this tenant). */
  checkedPlatforms: SocialHealthPlatform[];
  issues: SocialHealthIssue[];
}

export interface CheckTenantSocialHealthDeps {
  tokens: Pick<SocialTokensRepo, "getToken">;
  /**
   * The Twitter posting client this tenant's publish jobs would use
   * (per-tenant OAuth2, or tenant-0 OAuth1 env/manual fallback), or null
   * when the tenant has no Twitter posting configured.
   */
  twitterClient: TwitterApiClient | null;
  now?: () => Date;
}

/**
 * Per-tenant social credential health (Phase 6 deferred fix): checks only
 * THIS tenant's connected platforms. A tenant with nothing connected yields
 * an empty report — a healthy no-op, never an alert.
 */
export async function checkTenantSocialHealth(
  deps: CheckTenantSocialHealthDeps,
): Promise<SocialHealthReport> {
  const now = deps.now ?? ((): Date => new Date());
  const checkedPlatforms: SocialHealthPlatform[] = [];
  const issues: SocialHealthIssue[] = [];

  if (deps.twitterClient !== null) {
    checkedPlatforms.push("twitter");
    const result = await deps.twitterClient.validateCredentials();
    if (!result.ok) {
      issues.push({
        platform: "twitter",
        reason: "credentials_invalid",
        status: result.status,
        detail: truncate(result.body),
      });
    }
  }

  const linkedin = await deps.tokens.getToken("linkedin");
  if (linkedin !== null) {
    checkedPlatforms.push("linkedin");
    const expired = linkedin.expiresAt.getTime() <= now().getTime();
    if (expired && linkedin.refreshToken === "") {
      issues.push({ platform: "linkedin", reason: "token_expired" });
    }
  }

  return { checkedPlatforms, issues };
}
