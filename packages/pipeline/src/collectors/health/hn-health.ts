import type { HealthCheckResult } from "@newsletter/shared/types";

const HN_HEALTH_URL = "https://hn.algolia.com/api/v1/search_by_date?hitsPerPage=1&tags=story";

export interface HnHealthDeps {
  fetchFn?: typeof fetch;
}

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
}

function isAlgoliaResponse(value: unknown): { hits: AlgoliaHit[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const hits = (value as Record<string, unknown>).hits;
  if (!Array.isArray(hits)) return null;
  return { hits: hits.filter((h): h is AlgoliaHit => typeof h === "object" && h !== null) };
}

function hasValidStory(hit: AlgoliaHit): boolean {
  return typeof hit.objectID === "string" && typeof hit.title === "string" && hit.title !== "";
}

export function classifyHnError(err: unknown): string {
  if (typeof err === "string") return err;
  if (!(err instanceof Error)) return String(err);

  const msg = err.message;
  if (/4(?:0[13]|01)/.test(msg) || msg.includes("Non-retryable")) {
    return "HN API access denied (invalid credentials or IP blocked)";
  }
  if (msg.includes("429") || /rate.?limit/i.test(msg)) {
    return "HN API rate limit exceeded — try again later";
  }
  if (/5\d\d/.test(msg)) {
    return "HN API returned a server error (5xx) — service may be unreachable";
  }
  if (/timeout|aborted/i.test(msg)) {
    return "HN API request timed out — network or service issue";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(msg)) {
    return `HN API unreachable — network error`;
  }
  if (err instanceof SyntaxError || /JSON|parse/i.test(msg)) {
    return "HN API returned an invalid response — parse failure";
  }
  return msg;
}

export async function checkHnHealth(deps: HnHealthDeps = {}): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const res = await fetchFn(HN_HEALTH_URL);
    if (!res.ok) {
      const status = res.status;
      if (status >= 400 && status < 500 && status !== 429) {
        throw new Error(`Non-retryable HTTP error: ${status}`);
      }
      throw new Error(`HTTP error: ${status}`);
    }
    const body: unknown = await res.json();
    const parsed = isAlgoliaResponse(body);
    if (parsed === null) {
      throw new Error("response schema changed — no hits array");
    }
    const valid = parsed.hits.filter(hasValidStory);
    if (valid.length === 0) {
      throw new Error("no valid stories with required fields returned");
    }
    return {
      collector: "hn",
      status: "healthy",
      durationMs: Date.now() - start,
      itemsFound: valid.length,
    };
  } catch (err) {
    return {
      collector: "hn",
      status: "failed",
      durationMs: Date.now() - start,
      error: classifyHnError(err),
    };
  }
}
