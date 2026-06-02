import type { HealthCheckResult } from "@newsletter/shared/types";

const DEFAULT_SUBREDDIT = "programming";
const REDDIT_RSS_URL = "https://www.reddit.com/r/{subreddit}/hot.rss?limit=1";

export interface RedditHealthDeps {
  fetchFn?: typeof fetch;
  subreddit?: string;
}

export function classifyRedditError(err: unknown): string {
  if (typeof err === "string") return err;
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;
  if (/4(?:0[13]|01)/.test(msg) || msg.includes("Non-retryable")) {
    return "Reddit RSS access denied (IP blocked or rate limited)";
  }
  if (msg.includes("429") || /rate.?limit/i.test(msg)) {
    return "Reddit rate limit exceeded — try again later";
  }
  if (/5\d\d/.test(msg)) {
    return "Reddit RSS returned a server error (5xx) — service may be unreachable";
  }
  if (/timeout|aborted/i.test(msg)) {
    return "Reddit RSS request timed out — network or service issue";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(msg)) {
    return "Reddit RSS unreachable — network error";
  }
  if (/parsererror|invalid XML/i.test(msg)) {
    return "Reddit RSS XML structure changed — no valid post entries found";
  }
  return msg;
}

function extractEntryIds(xml: string): string[] {
  const ids: string[] = [];
  // Simple regex-based extraction to avoid jsdom import for health check
  const entryRegex = /<entry[^>]*>[\s\S]*?<\/entry>/gi;
  const idRegex = /<id[^>]*>(.*?)<\/id>/i;
  const titleRegex = /<title[^>]*>(.*?)<\/title>/i;

  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entry = entryMatch[0];
    const idMatch = idRegex.exec(entry);
    const titleMatch = titleRegex.exec(entry);
    const id = idMatch?.[1] ?? "";
    const title = titleMatch?.[1] ?? "";
    // Reddit post entries have t3_-prefixed IDs
    if (id.startsWith("t3_") && title !== "") {
      ids.push(id);
    }
  }
  return ids;
}

function hasParserError(xml: string): boolean {
  return /<parsererror[^>]*>/.test(xml);
}

export async function checkRedditHealth(deps: RedditHealthDeps = {}): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const subreddit = deps.subreddit ?? DEFAULT_SUBREDDIT;
    const url = REDDIT_RSS_URL.replace("{subreddit}", subreddit);

    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsletterBot/1.0; +https://vertexcover.io)",
        Accept: "application/atom+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) {
      const status = res.status;
      if (status >= 400 && status < 500 && status !== 429) {
        throw new Error(`Non-retryable HTTP error: ${status}`);
      }
      throw new Error(`HTTP error: ${status}`);
    }
    const xml = await res.text();

    if (hasParserError(xml)) {
      throw new Error("Reddit RSS returned parsererror — XML structure changed");
    }

    const ids = extractEntryIds(xml);
    if (ids.length === 0) {
      throw new Error("no valid Reddit post entries with t3_-prefixed IDs found");
    }

    return {
      collector: "reddit",
      status: "healthy",
      durationMs: Date.now() - start,
      itemsFound: ids.length,
    };
  } catch (err) {
    return {
      collector: "reddit",
      status: "failed",
      durationMs: Date.now() - start,
      error: classifyRedditError(err),
    };
  }
}
