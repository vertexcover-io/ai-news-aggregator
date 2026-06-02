import type { HealthCheckResult } from "@newsletter/shared/types";
import type { TwitterCollectorCookie } from "@pipeline/services/credential-resolver.js";
import type { TwitterClient, NormalizedTweet } from "@pipeline/collectors/twitter/types.js";

const DEFAULT_USER_ID = "44196397"; // @elonmusk — widely available public timeline

export interface TwitterHealthDeps {
  /** Resolver that checks social_credentials DB first, then env var. */
  resolveCookie: () => Promise<TwitterCollectorCookie | null>;
  /** Factory that creates a TwitterClient from a resolved cookie. */
  createClient: (cookie: TwitterCollectorCookie) => TwitterClient;
}

export function classifyTwitterError(err: unknown): string {
  if (typeof err === "string") return err;
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;
  if (/not authorized|forbidden|4(?:0[13]|01)/i.test(msg)) {
    return "Twitter API access denied — cookie may be expired, refresh at /admin/settings";
  }
  if (msg.includes("429") || /rate.?limit/i.test(msg)) {
    return "Twitter API rate limit exceeded — try again later";
  }
  if (/timeout|aborted|ETIMEDOUT/i.test(msg)) {
    return "Twitter API request timed out — network or service issue";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(msg)) {
    return "Twitter API unreachable — network error";
  }
  return msg;
}

function hasValidId(tweet: NormalizedTweet): boolean {
  return tweet.id !== "" && tweet.id !== "undefined";
}

export async function checkTwitterHealth(deps: TwitterHealthDeps): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const cookie = await deps.resolveCookie();
    if (cookie === null) {
      return {
        collector: "twitter",
        status: "skipped",
        durationMs: Date.now() - start,
        reason: "API key not configured — set Twitter cookies at /admin/settings",
      };
    }

    const client = deps.createClient(cookie);
    const result = await client.fetchUserTimeline(DEFAULT_USER_ID, { maxTweets: 1 });

    const validTweets = result.tweets.filter(hasValidId);
    if (validTweets.length === 0) {
      throw new Error("no tweets with valid IDs returned");
    }

    return {
      collector: "twitter",
      status: "healthy",
      durationMs: Date.now() - start,
      itemsFound: validTweets.length,
    };
  } catch (err) {
    // Distinguish resolution errors (skip) from client errors (fail)
    if (err instanceof Error && err.message.includes("decrypt")) {
      return {
        collector: "twitter",
        status: "skipped",
        durationMs: Date.now() - start,
        reason: "Twitter credentials could not be read — database error",
      };
    }
    return {
      collector: "twitter",
      status: "failed",
      durationMs: Date.now() - start,
      error: classifyTwitterError(err),
    };
  }
}
