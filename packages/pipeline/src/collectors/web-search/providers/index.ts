import type { WebSearchProviderName } from "@newsletter/shared/types";
import type { WebSearchProvider } from "./types.js";
import { TavilyProvider } from "./tavily.js";

export type { WebSearchProvider, WebSearchResult } from "./types.js";

export function createWebSearchProvider(
  _name: WebSearchProviderName,
  env: { tavilyApiKey?: string },
): WebSearchProvider {
  // "tavily" is the only provider today; _name is kept for the exhaustive-check pattern
  // as future providers widen WebSearchProviderName.
  if (!env.tavilyApiKey) {
    throw new Error(
      "TAVILY_API_KEY is required for the tavily web-search provider",
    );
  }
  return new TavilyProvider({ apiKey: env.tavilyApiKey });
}
