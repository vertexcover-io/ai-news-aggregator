import type { HealthCheckResult } from "@newsletter/shared/types";
import type { WebSearchProvider } from "@pipeline/collectors/web-search/providers/index.js";

const HEALTH_CHECK_QUERY = "latest developments in artificial intelligence 2026";

export interface WebSearchHealthDeps {
  /** Returns the WebSearchProvider or undefined if not configured. */
  getProvider: () => WebSearchProvider | undefined;
}

export function classifyWebSearchError(err: unknown): string {
  if (typeof err === "string") return err;
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;
  if (/4(?:0[13]|01)|unauthorized|forbidden/i.test(msg)) {
    return "Web Search API key invalid or unauthorized";
  }
  if (msg.includes("429") || /rate.?limit/i.test(msg)) {
    return "Web Search API rate limit exceeded — try again later";
  }
  if (/5\d\d/.test(msg)) {
    return "Web Search API returned a server error (5xx) — service may be unreachable";
  }
  if (/timeout|aborted|ETIMEDOUT/i.test(msg)) {
    return "Web Search API request timed out — network or service issue";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(msg)) {
    return "Web Search API unreachable — network error";
  }
  return msg;
}

export async function checkWebSearchHealth(deps: WebSearchHealthDeps): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const provider = deps.getProvider();
    if (provider === undefined) {
      return {
        collector: "web_search",
        status: "skipped",
        durationMs: Date.now() - start,
        reason: "API key not configured — set TAVILY_API_KEY in environment",
      };
    }

    const results = await provider.search({
      query: HEALTH_CHECK_QUERY,
      sinceDays: 7,
      maxItems: 1,
    });

    const validResults = results.filter((r) => r.url && r.url !== "");
    if (validResults.length === 0) {
      throw new Error("no results with valid URLs returned");
    }

    return {
      collector: "web_search",
      status: "healthy",
      durationMs: Date.now() - start,
      itemsFound: validResults.length,
    };
  } catch (err) {
    return {
      collector: "web_search",
      status: "failed",
      durationMs: Date.now() - start,
      error: classifyWebSearchError(err),
    };
  }
}
